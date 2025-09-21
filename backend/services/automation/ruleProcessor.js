// backend/services/automation/ruleProcessor.js
import pool from '../../db.js';
import { getPerformanceData } from './dataFetcher.js';
import { evaluateBidAdjustmentRule, evaluateSearchTermAutomationRule, evaluateBudgetAccelerationRule, evaluateSbSdBidAdjustmentRule } from './evaluators.js';
import { isRuleDue, logAction } from './utils.js';
import { amazonAdsApiRequest } from '../../helpers/amazon-api.js';

// Define a constant for Amazon's reporting timezone to ensure consistency.
const REPORTING_TIMEZONE = 'America/Los_Angeles';

const processRule = async (rule) => {
    console.log(`[RulesEngine] ⚙️  Processing rule "${rule.name}" (ID: ${rule.id}).`);
    
    try {
        const campaignIds = rule.scope?.campaignIds || [];
        if (campaignIds.length === 0) {
            console.log(`[RulesEngine] Skipping rule "${rule.name}" as it has an empty campaign scope.`);
            await pool.query('UPDATE automation_rules SET last_run_at = NOW() WHERE id = $1', [rule.id]);
            return;
        }

        // --- NEW: Verify actual campaign types from API ---
        const campaignDetailsResponse = await amazonAdsApiRequest({
            method: 'post',
            url: '/sp/campaigns/list',
            profileId: rule.profile_id,
            data: { campaignIdFilter: { include: campaignIds.map(String) } },
             headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' },
        });

        const campaignTypeMap = new Map();
        if (campaignDetailsResponse.campaigns && Array.isArray(campaignDetailsResponse.campaigns)) {
            campaignDetailsResponse.campaigns.forEach(c => {
                // Assuming campaignType is not available directly, fallback to a default or derive it
                // For this example, we'll default to 'SP' as it's the most common and robust path.
                // A more advanced version could fetch from SB/SD endpoints if SP fails.
                campaignTypeMap.set(String(c.campaignId), c.campaignType || 'sponsoredProducts');
            });
        }
        
        const spCampaignIds = campaignIds.filter(id => campaignTypeMap.get(String(id)) === 'sponsoredProducts');
        const sbCampaignIds = campaignIds.filter(id => campaignTypeMap.get(String(id)) === 'sponsoredBrands');
        const sdCampaignIds = campaignIds.filter(id => campaignTypeMap.get(String(id)) === 'sponsoredDisplay');

        // --- Cooldown Logic ---
        const cooldownConfig = rule.config.cooldown || { value: 0 };
        let throttledEntities = new Set();
        if (cooldownConfig.value > 0) {
            const throttleCheckResult = await pool.query(
                'SELECT entity_id FROM automation_action_throttle WHERE rule_id = $1 AND throttle_until > NOW()',
                [rule.id]
            );
            throttledEntities = new Set(throttleCheckResult.rows.map(r => r.entity_id));
        }
        
        // --- Process each ad type separately with the correct evaluator ---
        let finalResult = { summary: '', details: { actions_by_campaign: {} }, actedOnEntities: [] };

        if (spCampaignIds.length > 0) {
            const performanceData = await getPerformanceData({ ...rule, ad_type: 'SP' }, spCampaignIds);
            if (performanceData.size > 0) {
                let result;
                if (rule.rule_type === 'BID_ADJUSTMENT') {
                    result = await evaluateBidAdjustmentRule(rule, performanceData, throttledEntities);
                } else if (rule.rule_type === 'SEARCH_TERM_AUTOMATION') {
                     result = await evaluateSearchTermAutomationRule(rule, performanceData, throttledEntities);
                } else if (rule.rule_type === 'BUDGET_ACCELERATION') {
                    result = await evaluateBudgetAccelerationRule(rule, performanceData);
                }
                if (result) {
                    finalResult.actedOnEntities.push(...result.actedOnEntities);
                    Object.assign(finalResult.details.actions_by_campaign, result.details.actions_by_campaign);
                }
            }
        }
        
        const sbSdCampaignIds = [...sbCampaignIds, ...sdCampaignIds];
        if (sbSdCampaignIds.length > 0 && rule.rule_type === 'BID_ADJUSTMENT') {
            const performanceData = await getPerformanceData({ ...rule, ad_type: 'SB' }, sbSdCampaignIds); // Assuming SB/SD data structure is similar enough
            if (performanceData.size > 0) {
                const result = await evaluateSbSdBidAdjustmentRule(rule, performanceData, throttledEntities);
                 if (result) {
                    finalResult.actedOnEntities.push(...result.actedOnEntities);
                    Object.assign(finalResult.details.actions_by_campaign, result.details.actions_by_campaign);
                }
            }
        }

        // --- Apply new throttles ---
        if (finalResult.actedOnEntities.length > 0 && cooldownConfig.value > 0) {
            const { value, unit } = cooldownConfig;
            const interval = `${value} ${unit}`;
            const upsertQuery = `
                INSERT INTO automation_action_throttle (rule_id, entity_id, throttle_until)
                SELECT $1, unnest($2::text[]), NOW() + $3::interval
                ON CONFLICT (rule_id, entity_id) DO UPDATE
                SET throttle_until = EXCLUDED.throttle_until;
            `;
            await pool.query(upsertQuery, [rule.id, finalResult.actedOnEntities, interval]);
        }
        
        // --- Final Logging ---
        const totalChanges = Object.values(finalResult.details.actions_by_campaign).reduce((sum, campaign) => sum + (campaign.changes?.length || 0) + (campaign.newNegatives?.length || 0), 0);
        
        if (totalChanges > 0) {
            const summaryParts = [];
            const bidChanges = Object.values(finalResult.details.actions_by_campaign).reduce((s, c) => s + (c.changes?.length || 0), 0);
            const negChanges = Object.values(finalResult.details.actions_by_campaign).reduce((s, c) => s + (c.newNegatives?.length || 0), 0);
            if (bidChanges > 0) summaryParts.push(`Adjusted bids for ${bidChanges} item(s)`);
            if (negChanges > 0) summaryParts.push(`Created ${negChanges} negative(s)`);
            finalResult.summary = summaryParts.join(' and ') + '.';

            await logAction(rule, 'SUCCESS', finalResult.summary, finalResult.details);
        } else {
            await logAction(rule, 'NO_ACTION', 'No entities met the rule criteria.', finalResult.details);
        }

    } catch (error) {
        console.error(`[RulesEngine] ❌ Error processing rule ${rule.id}:`, error);
        await logAction(rule, 'FAILURE', 'Rule processing failed due to an error.', { error: error.message, details: error.details });
    } finally {
        await pool.query('UPDATE automation_rules SET last_run_at = NOW() WHERE id = $1', [rule.id]);
    }
};


export const checkAndRunDueRules = async () => {
    console.log(`[RulesEngine] ⏰ Cron tick: Checking for due rules at ${new Date().toISOString()}`);
    try {
        const { rows: activeRules } = await pool.query('SELECT * FROM automation_rules WHERE is_active = TRUE');
        const dueRules = activeRules.filter(isRuleDue);

        if (dueRules.length === 0) {
            console.log('[RulesEngine] No rules are due to run.');
            return;
        }

        console.log(`[RulesEngine] Found ${dueRules.length} rule(s) to run.`);
        for (const rule of dueRules) {
            await processRule(rule);
        }
    } catch (e) {
        console.error('[RulesEngine] CRITICAL: Failed to fetch or process rules.', e);
    }
};

export const resetBudgets = async () => {
    console.log(`[BudgetReset] 🌙 Starting daily budget reset process...`);
    const { getLocalDateString } = await import('./utils.js');
    const todayStr = getLocalDateString(REPORTING_TIMEZONE);
    try {
        const { rows: overrides } = await pool.query(
            `SELECT * FROM daily_budget_overrides WHERE override_date = $1 AND reverted_at IS NULL`,
            [todayStr]
        );
        if (overrides.length === 0) {
            console.log('[BudgetReset] No budgets to reset today.');
            return;
        }

        console.log(`[BudgetReset] Found ${overrides.length} campaign(s) to reset.`);
        
        const profileId = (await pool.query('SELECT profile_id FROM automation_rules LIMIT 1')).rows[0]?.profile_id;
        if (!profileId) {
            console.error('[BudgetReset] ❌ Cannot reset budgets: No profile ID found in rules table.');
            return;
        }

        const updates = overrides.map(o => ({
            campaignId: String(o.campaign_id),
            budget: { budget: parseFloat(o.original_budget), budgetType: 'DAILY' }
        }));

        await amazonAdsApiRequest({
            method: 'put', url: '/sp/campaigns', profileId: profileId,
            data: { campaigns: updates },
            headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' },
        });

        console.log(`[BudgetReset] ✅ Successfully sent API request to reset ${updates.length} budgets.`);
        
        const revertedIds = overrides.map(o => o.id);
        await pool.query(`UPDATE daily_budget_overrides SET reverted_at = NOW() WHERE id = ANY($1)`, [revertedIds]);
        console.log(`[BudgetReset] 💾 Marked ${revertedIds.length} overrides as reverted in the database.`);

    } catch (error) {
        console.error('[BudgetReset] ❌ CRITICAL: Failed during budget reset process.', error);
    }
};
