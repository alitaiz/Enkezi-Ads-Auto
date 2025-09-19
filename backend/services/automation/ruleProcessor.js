// backend/services/automation/ruleProcessor.js
import pool from '../../db.js';
import { getPerformanceData } from './dataFetcher.js';
import { evaluateBidAdjustmentRule, evaluateSearchTermAutomationRule, evaluateBudgetAccelerationRule } from './evaluators.js';
import { isRuleDue, logAction } from './utils.js';
import { amazonAdsApiRequest } from '../../helpers/amazon-api.js';

// Define a constant for Amazon's reporting timezone to ensure consistency.
const REPORTING_TIMEZONE = 'America/Los_Angeles';

const processRule = async (rule) => {
    console.log(`[RulesEngine] ⚙️  Processing rule "${rule.name}" (ID: ${rule.id}).`);
    
    try {
        const campaignIds = rule.scope?.campaignIds || [];

        // --- Cooldown Logic: Check throttled entities (keywords/targets) at the individual level ---
        const cooldownConfig = rule.config.cooldown || { value: 0 };
        let throttledEntities = new Set();
        if (cooldownConfig.value > 0) {
            const throttleCheckResult = await pool.query(
                'SELECT entity_id FROM automation_action_throttle WHERE rule_id = $1 AND throttle_until > NOW()',
                [rule.id]
            );
            throttledEntities = new Set(throttleCheckResult.rows.map(r => r.entity_id));
            if (throttledEntities.size > 0) {
                console.log(`[RulesEngine] Found ${throttledEntities.size} individual entities (keywords/targets) on cooldown for rule "${rule.name}".`);
            }
        }
        
        const performanceData = await getPerformanceData(rule, campaignIds);
        
        if (performanceData.size === 0 && rule.rule_type !== 'BUDGET_ACCELERATION') {
            const emptyActionsDetails = {
                actions_by_campaign: campaignIds.reduce((acc, id) => { acc[id] = { changes: [], newNegatives: [] }; return acc; }, {})
            };
            await logAction(rule, 'NO_ACTION', 'No entities to process; scope may be empty or no data found.', emptyActionsDetails);
            await pool.query('UPDATE automation_rules SET last_run_at = NOW() WHERE id = $1', [rule.id]);
            return;
        }

        let result;
        if (rule.rule_type === 'BID_ADJUSTMENT') {
            if (rule.ad_type === 'SB' || rule.ad_type === 'SD') {
                console.log(`[RulesEngine] Skipping SB/SD Bid Adjustment rule "${rule.name}" as it is not yet implemented.`);
                await logAction(rule, 'NO_ACTION', 'SB/SD rule execution is not yet implemented.', {});
                await pool.query('UPDATE automation_rules SET last_run_at = NOW() WHERE id = $1', [rule.id]);
                return;
            }
            result = await evaluateBidAdjustmentRule(rule, performanceData, throttledEntities);
        } else if (rule.rule_type === 'SEARCH_TERM_AUTOMATION') {
            result = await evaluateSearchTermAutomationRule(rule, performanceData, throttledEntities);
        } else if (rule.rule_type === 'BUDGET_ACCELERATION') {
            result = await evaluateBudgetAccelerationRule(rule, performanceData);
        } else {
             throw new Error(`Unknown rule type: ${rule.rule_type}`);
        }

        // --- Cooldown Logic: Apply new throttles at the individual entity level ---
        if (result.actedOnEntities && result.actedOnEntities.length > 0 && cooldownConfig.value > 0) {
            const { value, unit } = cooldownConfig;
            const interval = `${value} ${unit}`;
            const upsertQuery = `
                INSERT INTO automation_action_throttle (rule_id, entity_id, throttle_until)
                SELECT $1, unnest($2::text[]), NOW() + $3::interval
                ON CONFLICT (rule_id, entity_id) DO UPDATE
                SET throttle_until = EXCLUDED.throttle_until;
            `;
            await pool.query(upsertQuery, [rule.id, result.actedOnEntities, interval]);
            console.log(`[RulesEngine] Applied cooldown to ${result.actedOnEntities.length} individual entities for rule "${rule.name}" for ${interval}.`);
        }

        const hasActions = result && result.details && Object.values(result.details.actions_by_campaign).some(c => c.changes.length > 0 || c.newNegatives.length > 0);
        if (hasActions) {
            await logAction(rule, 'SUCCESS', result.summary, result.details);
        } else {
            const emptyActionsDetails = {
                actions_by_campaign: campaignIds.reduce((acc, id) => { acc[id] = { changes: [], newNegatives: [] }; return acc; }, {})
            };
            await logAction(rule, 'NO_ACTION', 'No entities met the rule criteria.', emptyActionsDetails);
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