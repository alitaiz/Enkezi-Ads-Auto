// backend/services/rulesEngine.js
import cron from 'node-cron';
import pool from '../db.js';
import { amazonAdsApiRequest } from '../helpers/amazon-api.js';

// Define a constant for Amazon's reporting timezone to ensure consistency.
const REPORTING_TIMEZONE = 'America/Los_Angeles';
let mainTask = null;
let resetTask = null;


// --- Logging Helper ---
const logAction = async (rule, status, summary, details = {}) => {
  try {
    // Custom replacer to handle BigInts safely during JSON serialization for logging.
    const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
    const detailsJson = JSON.stringify(details, replacer);

    await pool.query(
      `INSERT INTO automation_logs (rule_id, status, summary, details) VALUES ($1, $2, $3, $4)`,
      [rule.id, status, summary, detailsJson]
    );
    console.log(`[RulesEngine] Logged action for rule "${rule.name}": ${summary}`);
  } catch (e) {
    console.error(`[RulesEngine] FATAL: Could not write to automation_logs table for rule ${rule.id}.`, e);
  }
};


/**
 * A robust way to get "today's date string" in a specific timezone.
 * Using 'en-CA' gives the desired YYYY-MM-DD format.
 * @param {string} timeZone - The IANA timezone string (e.g., 'America/Los_Angeles').
 * @returns {string} The local date string in YYYY-MM-DD format.
 */
const getLocalDateString = (timeZone) => {
    const today = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone,
    });
    return formatter.format(today);
};

/**
 * Calculates aggregated metrics from a list of daily data points for a specific lookback period.
 * This function is now timezone-aware and robust.
 * @param {Array<object>} dailyData - Array of { date, spend, sales, clicks, orders, impressions }.
 * @param {number | 'TODAY'} lookbackDays - The number of days to look back (e.g., 7 for "last 7 days").
 * @param {Date} referenceDate - The end date for the lookback window (inclusive).
 * @returns {object} An object with aggregated metrics { spend, sales, clicks, orders, impressions, acos }.
 */
const calculateMetricsForWindow = (dailyData, lookbackDays, referenceDate) => {
    if (lookbackDays === 'TODAY') {
        lookbackDays = 1;
    }
    const endDate = new Date(referenceDate);

    const startDate = new Date(endDate);
    // "in last N days" includes the reference day, so go back (N-1) days.
    startDate.setDate(endDate.getDate() - (lookbackDays - 1));

    const filteredData = dailyData.filter(d => {
        // d.date is already a Date object at UTC midnight. No need to modify it.
        return d.date >= startDate && d.date <= endDate;
    });

    const totals = filteredData.reduce((acc, day) => {
        acc.spend += day.spend;
        acc.sales += day.sales;
        acc.clicks += day.clicks;
        acc.orders += day.orders;
        acc.impressions += day.impressions;
        return acc;
    }, { spend: 0, sales: 0, clicks: 0, orders: 0, impressions: 0 });

    totals.acos = totals.sales > 0 ? totals.spend / totals.sales : 0;
    totals.roas = totals.spend > 0 ? totals.sales / totals.spend : 0;
    return totals;
};


// --- Data Fetching ---

/**
 * Fetches performance data for BID_ADJUSTMENT rules using a HYBRID model.
 * - Near real-time data (last 2 days) from `raw_stream_events`.
 * - Settled historical data (>2 days ago) from `sponsored_products_search_term_report`.
 */
const getBidAdjustmentPerformanceData = async (rule, campaignIds, maxLookbackDays, today) => {
    const streamStartDate = new Date(today);
    streamStartDate.setDate(today.getDate() - 1); // Covers today and yesterday.

    const historicalEndDate = new Date(today);
    historicalEndDate.setDate(today.getDate() - 2);

    const historicalStartDate = new Date(historicalEndDate);
    const historicalLookback = maxLookbackDays > 2 ? maxLookbackDays - 2 : 0;
    if (historicalLookback > 0) {
        historicalStartDate.setDate(historicalEndDate.getDate() - (historicalLookback - 1));
    }

    const params = [campaignIds.map(id => id.toString())];
    const campaignParamIndex = `$${params.length}`;
    
    const streamCampaignFilter = `AND (event_data->>'campaign_id') = ANY(${campaignParamIndex})`;
    const historicalCampaignFilter = `AND campaign_id::text = ANY(${campaignParamIndex})`;

    const query = `
        WITH stream_data AS (
            SELECT
                ((event_data->>'time_window_start')::timestamptz AT TIME ZONE '${REPORTING_TIMEZONE}')::date AS performance_date,
                COALESCE(event_data->>'keyword_id', event_data->>'target_id') AS entity_id_text,
                COALESCE(event_data->>'keyword_text', event_data->>'targeting') AS entity_text,
                (event_data->>'match_type') AS match_type,
                (event_data->>'campaign_id') AS campaign_id_text,
                (event_data->>'ad_group_id') AS ad_group_id_text,
                SUM(CASE WHEN event_type = 'sp-traffic' THEN (event_data->>'impressions')::bigint ELSE 0 END) AS impressions,
                SUM(CASE WHEN event_type = 'sp-traffic' THEN (event_data->>'cost')::numeric ELSE 0 END) AS spend,
                SUM(CASE WHEN event_type = 'sp-traffic' THEN (event_data->>'clicks')::bigint ELSE 0 END) AS clicks,
                SUM(CASE WHEN event_type = 'sp-conversion' THEN (event_data->>'attributed_sales_1d')::numeric ELSE 0 END) AS sales,
                SUM(CASE WHEN event_type = 'sp-conversion' THEN (event_data->>'attributed_conversions_1d')::bigint ELSE 0 END) AS orders
            FROM raw_stream_events
            WHERE event_type IN ('sp-traffic', 'sp-conversion')
              AND (event_data->>'time_window_start')::timestamptz >= '${streamStartDate.toISOString()}'
              AND COALESCE(event_data->>'keyword_id', event_data->>'target_id') IS NOT NULL
              ${streamCampaignFilter}
            GROUP BY 1, 2, 3, 4, 5, 6
        ),
        historical_data AS (
            SELECT
                report_date AS performance_date,
                keyword_id::text AS entity_id_text,
                COALESCE(keyword_text, targeting) AS entity_text,
                match_type,
                campaign_id::text AS campaign_id_text,
                ad_group_id::text AS ad_group_id_text,
                SUM(COALESCE(impressions, 0))::bigint AS impressions,
                SUM(COALESCE(cost, 0))::numeric AS spend,
                SUM(COALESCE(clicks, 0))::bigint AS clicks,
                SUM(COALESCE(sales_1d, 0))::numeric AS sales,
                SUM(COALESCE(purchases_1d, 0))::bigint AS orders
            FROM sponsored_products_search_term_report
            WHERE report_date >= '${historicalStartDate.toISOString().split('T')[0]}' AND report_date <= '${historicalEndDate.toISOString().split('T')[0]}'
              AND keyword_id IS NOT NULL
              ${historicalCampaignFilter}
            GROUP BY 1, 2, 3, 4, 5, 6
        )
        SELECT * FROM stream_data
        UNION ALL
        SELECT * FROM historical_data;
    `;
    
    const { rows } = await pool.query(query, params);
    
    const performanceMap = new Map();
    for (const row of rows) {
        const key = row.entity_id_text;
        if (!key) continue;

        if (!performanceMap.has(key)) {
             performanceMap.set(key, {
                entityId: row.entity_id_text,
                entityType: ['BROAD', 'PHRASE', 'EXACT'].includes(row.match_type) ? 'keyword' : 'target',
                entityText: row.entity_text,
                matchType: row.match_type,
                campaignId: row.campaign_id_text,
                adGroupId: row.ad_group_id_text,
                dailyData: []
            });
        }
        
        performanceMap.get(key).dailyData.push({
            date: new Date(row.performance_date),
            impressions: parseInt(row.impressions || 0, 10),
            spend: parseFloat(row.spend || 0),
            sales: parseFloat(row.sales || 0),
            clicks: parseInt(row.clicks || 0, 10),
            orders: parseInt(row.orders || 0, 10),
        });
    }

    return performanceMap;
};

/**
 * Fetches performance data for SEARCH_TERM_AUTOMATION rules.
 * Exclusively uses historical Search Term Report data with a 2-day delay.
 */
const getSearchTermAutomationPerformanceData = async (rule, campaignIds, maxLookbackDays, today) => {
    const endDate = new Date(today);
    endDate.setDate(today.getDate() - 2);

    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - (maxLookbackDays - 1));

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const params = [startDateStr, endDateStr, campaignIds.map(id => id.toString())];
    const campaignFilterClauseHistorical = `AND campaign_id::text = ANY($3)`;

    const query = `
        SELECT
            report_date AS performance_date, customer_search_term, campaign_id, ad_group_id,
            COALESCE(SUM(COALESCE(impressions, 0::bigint)), 0)::bigint AS impressions,
            COALESCE(SUM(COALESCE(cost, 0::numeric)), 0)::numeric AS spend,
            COALESCE(SUM(COALESCE(sales_1d, 0::numeric)), 0)::numeric AS sales,
            COALESCE(SUM(COALESCE(clicks, 0::bigint)), 0)::bigint AS clicks,
            COALESCE(SUM(COALESCE(purchases_1d, 0::bigint)), 0)::bigint AS orders
        FROM sponsored_products_search_term_report
        WHERE report_date >= $1 AND report_date <= $2
            AND customer_search_term IS NOT NULL
            ${campaignFilterClauseHistorical}
        GROUP BY 1, 2, 3, 4;
    `;
    
    const { rows } = await pool.query(query, params);
    
    const performanceMap = new Map();
    for (const row of rows) {
        const key = row.customer_search_term?.toString();
        if (!key) continue;

        if (!performanceMap.has(key)) {
             performanceMap.set(key, {
                campaignId: row.campaign_id, adGroupId: row.ad_group_id,
                entityText: row.customer_search_term,
                dailyData: []
            });
        }
        
        performanceMap.get(key).dailyData.push({
            date: new Date(row.performance_date),
            impressions: parseInt(row.impressions || 0, 10),
            spend: parseFloat(row.spend || 0),
            sales: parseFloat(row.sales || 0),
            clicks: parseInt(row.clicks || 0, 10),
            orders: parseInt(row.orders || 0, 10),
        });
    }

    return performanceMap;
};

/**
 * Fetches performance data for BUDGET_ACCELERATION rules.
 * Uses only real-time stream data for "today so far".
 */
const getBudgetAccelerationPerformanceData = async (rule, campaignIds, today) => {
    // 1. Fetch current budgets for all relevant campaigns from the API
    const campaignBudgets = new Map();
    try {
        let allCampaigns = [];
        let nextToken = null;
        const requestBody = {
            campaignIdFilter: { include: campaignIds.map(id => String(id)) },
            maxResults: 500,
        };
        do {
             if (nextToken) requestBody.nextToken = nextToken;
             const response = await amazonAdsApiRequest({
                method: 'post', url: '/sp/campaigns/list', profileId: rule.profile_id,
                data: requestBody,
                headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' },
            });
            if (response.campaigns) allCampaigns = allCampaigns.concat(response.campaigns);
            nextToken = response.nextToken;
        } while (nextToken);

        allCampaigns.forEach(c => {
            if (c.budget?.budget) {
                campaignBudgets.set(String(c.campaignId), c.budget.budget);
            }
        });
        console.log(`[RulesEngine] Fetched original budgets for ${campaignBudgets.size} campaigns.`);
    } catch (e) {
        console.error('[RulesEngine] Failed to fetch campaign budgets for Budget Acceleration rule.', e);
        return new Map();
    }
    
    // 2. Fetch today's performance from the stream
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const query = `
        SELECT
            (event_data->>'campaign_id') AS campaign_id_text,
            SUM(CASE WHEN event_type = 'sp-traffic' THEN (event_data->>'cost')::numeric ELSE 0 END) AS spend,
            SUM(CASE WHEN event_type = 'sp-conversion' THEN (event_data->>'attributed_sales_1d')::numeric ELSE 0 END) AS sales,
            SUM(CASE WHEN event_type = 'sp-conversion' THEN (event_data->>'attributed_conversions_1d')::bigint ELSE 0 END) AS orders
        FROM raw_stream_events
        WHERE event_type IN ('sp-traffic', 'sp-conversion')
          AND (event_data->>'time_window_start')::timestamptz >= $1
          AND (event_data->>'campaign_id') = ANY($2)
        GROUP BY 1;
    `;
    const { rows } = await pool.query(query, [todayStart, campaignIds.map(id => String(id))]);

    // 3. Combine and calculate final metrics
    const performanceMap = new Map();
    for (const campaignId of campaignIds) {
        const idStr = String(campaignId);
        const originalBudget = campaignBudgets.get(idStr);
        if (typeof originalBudget !== 'number') continue;

        const perf = rows.find(r => r.campaign_id_text === idStr) || {};
        const spend = parseFloat(perf.spend || 0);
        const sales = parseFloat(perf.sales || 0);
        const orders = parseInt(perf.orders || 0, 10);
        
        performanceMap.set(idStr, {
            campaignId: idStr,
            originalBudget,
            dailyData: [{ date: today, spend, sales, orders, impressions: 0, clicks: 0 }],
        });
    }

    return performanceMap;
};


/**
 * Main data fetching dispatcher. Determines which specialized function to call based on rule type.
 */
const getPerformanceData = async (rule, campaignIds) => {
    // CRITICAL FIX: If the scope is not defined or is an empty array, this rule should not
    // apply to any campaigns. Return an empty map immediately to prevent fetching data for the entire account.
    if (!campaignIds || !Array.isArray(campaignIds) || campaignIds.length === 0) {
        console.log(`[RulesEngine DBG] Rule "${rule.name}" has an empty campaign scope. Skipping data fetch.`);
        return new Map();
    }

    const allTimeWindows = rule.config.conditionGroups.flatMap(g => g.conditions.map(c => c.timeWindow).filter(tw => tw !== 'TODAY'));
    const maxLookbackDays = allTimeWindows.length > 0 ? Math.max(...allTimeWindows, 1) : 1;
    const todayStr = getLocalDateString(REPORTING_TIMEZONE);
    const today = new Date(todayStr);

    let performanceMap;
    if (rule.rule_type === 'BID_ADJUSTMENT') {
        performanceMap = await getBidAdjustmentPerformanceData(rule, campaignIds, maxLookbackDays, today);
    } else if (rule.rule_type === 'SEARCH_TERM_AUTOMATION') {
        performanceMap = await getSearchTermAutomationPerformanceData(rule, campaignIds, maxLookbackDays, today);
    } else if (rule.rule_type === 'BUDGET_ACCELERATION') {
        performanceMap = await getBudgetAccelerationPerformanceData(rule, campaignIds, today);
    } else {
        performanceMap = new Map();
    }
    
    console.log(`[RulesEngine DBG] Aggregated daily data for ${performanceMap.size} unique entities for rule "${rule.name}".`);
    return performanceMap;
};


// --- Rule Evaluation Logic ---
const checkCondition = (metricValue, operator, conditionValue) => {
    switch (operator) {
        case '>': return metricValue > conditionValue;
        case '<': return metricValue < conditionValue;
        case '=': return metricValue === conditionValue;
        default: return false;
    }
};

const evaluateBidAdjustmentRule = async (rule, performanceData, throttledEntities) => {
    const actionsByCampaign = {};
    const keywordsToUpdate = [];
    const targetsToUpdate = [];
    const referenceDate = new Date(getLocalDateString(REPORTING_TIMEZONE));

    const keywordsToProcess = new Map();
    const targetsToProcess = new Map();

    // Split entities into keywords and targets. All targets are now treated the same initially.
    for (const [entityId, data] of performanceData.entries()) {
        if (data.entityType === 'keyword') {
            keywordsToProcess.set(entityId, data);
        } else if (data.entityType === 'target') {
            targetsToProcess.set(entityId, data);
        }
    }
    
    const keywordsWithoutBids = [];
    const targetsWithoutBids = [];

    // Attempt to fetch specific bids for all keywords, in chunks.
    if (keywordsToProcess.size > 0) {
        try {
            const allKeywordIds = Array.from(keywordsToProcess.keys());
            const chunkSize = 100;
            const allFetchedKeywords = [];

            for (let i = 0; i < allKeywordIds.length; i += chunkSize) {
                const chunk = allKeywordIds.slice(i, i + chunkSize);
                const response = await amazonAdsApiRequest({
                    method: 'post', url: '/sp/keywords/list', profileId: rule.profile_id,
                    data: { keywordIdFilter: { include: chunk } },
                    headers: { 'Content-Type': 'application/vnd.spKeyword.v3+json', 'Accept': 'application/vnd.spKeyword.v3+json' }
                });
                if (response.keywords) {
                    allFetchedKeywords.push(...response.keywords);
                }
            }

            allFetchedKeywords.forEach(kw => {
                const perfData = keywordsToProcess.get(kw.keywordId.toString());
                if (perfData) {
                    if (typeof kw.bid === 'number') {
                        perfData.currentBid = kw.bid;
                    } else {
                        keywordsWithoutBids.push(perfData);
                    }
                }
            });

            const foundKeywordIds = new Set(allFetchedKeywords.map(kw => kw.keywordId.toString()));
            for (const [keywordId, perfData] of keywordsToProcess.entries()) {
                if (!foundKeywordIds.has(keywordId)) {
                    keywordsWithoutBids.push(perfData);
                }
            }
        } catch (e) {
            console.error('[RulesEngine] Failed to fetch current keyword bids. All keywords in this batch will fallback to default bid.', e);
            keywordsToProcess.forEach(perfData => keywordsWithoutBids.push(perfData));
        }
    }

    // Attempt to fetch specific bids for ALL targets, in chunks.
    if (targetsToProcess.size > 0) {
        try {
            const allTargetIds = Array.from(targetsToProcess.keys());
            const chunkSize = 100;
            const allFetchedTargets = [];
            
            for (let i = 0; i < allTargetIds.length; i += chunkSize) {
                const chunk = allTargetIds.slice(i, i + chunkSize);
                 const response = await amazonAdsApiRequest({
                    method: 'post', url: '/sp/targets/list', profileId: rule.profile_id,
                    data: { targetIdFilter: { include: chunk } },
                    headers: { 'Content-Type': 'application/vnd.spTargetingClause.v3+json', 'Accept': 'application/vnd.spTargetingClause.v3+json' }
                });
                
                // FIX: The Amazon API response for listing targets might use 'targetingClauses' as the key,
                // similar to update operations, not just 'targets'. This change checks for both keys to robustly
                // find the array of targets, preventing the system from incorrectly falling back to the ad group default bid.
                const targetsInResponse = response.targets || response.targetingClauses;
                if (targetsInResponse && Array.isArray(targetsInResponse)) {
                    allFetchedTargets.push(...targetsInResponse);
                }
            }

            allFetchedTargets.forEach(t => {
                const perfData = targetsToProcess.get(t.targetId.toString());
                if (perfData) {
                    if (typeof t.bid === 'number') {
                        perfData.currentBid = t.bid;
                    } else {
                        targetsWithoutBids.push(perfData);
                    }
                }
            });
            
            const foundTargetIds = new Set(allFetchedTargets.map(t => t.targetId.toString()));
            for (const [targetId, perfData] of targetsToProcess.entries()) {
                if (!foundTargetIds.has(targetId)) {
                    targetsWithoutBids.push(perfData);
                }
            }
        } catch (e) {
            console.error('[RulesEngine] Failed to fetch current target bids. All targets in this batch will fallback to default bid.', e);
            targetsToProcess.forEach(perfData => targetsWithoutBids.push(perfData));
        }
    }
    
    // Fallback: Fetch ad group default bids for any entity that didn't have a specific bid.
    const entitiesWithoutBids = [...keywordsWithoutBids, ...targetsWithoutBids];
    
    if (entitiesWithoutBids.length > 0) {
        console.log(`[RulesEngine] Found ${entitiesWithoutBids.length} entity/entities inheriting bids. Fetching ad group default bids...`);
        const adGroupIdsToFetch = [...new Set(entitiesWithoutBids.map(e => e.adGroupId).filter(id => id))];
        
        if (adGroupIdsToFetch.length > 0) {
            try {
                const adGroupResponse = await amazonAdsApiRequest({
                    method: 'post', url: '/sp/adGroups/list', profileId: rule.profile_id,
                    data: { adGroupIdFilter: { include: adGroupIdsToFetch } },
                    headers: { 'Content-Type': 'application/vnd.spAdGroup.v3+json', 'Accept': 'application/vnd.spAdGroup.v3+json' }
                });
        
                const adGroupBidMap = new Map();
                (adGroupResponse.adGroups || []).forEach(ag => {
                    adGroupBidMap.set(ag.adGroupId.toString(), ag.defaultBid);
                });
        
                entitiesWithoutBids.forEach(entity => {
                    const defaultBid = adGroupBidMap.get(entity.adGroupId.toString());
                    if (typeof defaultBid === 'number') {
                        entity.currentBid = defaultBid;
                    } else {
                         console.warn(`[RulesEngine] Could not find default bid for ad group ${entity.adGroupId} for entity ${entity.entityId}`);
                    }
                });
            } catch (e) {
                console.error('[RulesEngine] Failed to fetch ad group default bids.', e);
            }
        } else {
            console.log('[RulesEngine] No valid AdGroup IDs found for fetching default bids.');
        }
    }


    const allEntities = [...keywordsToProcess.values(), ...targetsToProcess.values()];
    for (const entity of allEntities) {
        // The core of granular cooldown: skip this specific entity if it's on cooldown, but continue to process others.
        if (throttledEntities.has(entity.entityId)) continue;
        if (typeof entity.currentBid !== 'number') continue;
        
        for (const group of rule.config.conditionGroups) {
            let allConditionsMet = true;
            for (const condition of group.conditions) {
                const metrics = calculateMetricsForWindow(entity.dailyData, condition.timeWindow, referenceDate);
                if (!checkCondition(metrics[condition.metric], condition.operator, condition.value)) {
                    allConditionsMet = false;
                    break;
                }
            }

            if (allConditionsMet) {
                const { type, value, minBid, maxBid } = group.action;
                if (type === 'adjustBidPercent') {
                    let newBid = entity.currentBid * (1 + (value / 100));

                    if (value < 0) {
                        newBid = Math.floor(newBid * 100) / 100;
                    } else {
                        newBid = Math.ceil(newBid * 100) / 100;
                    }

                    newBid = Math.max(0.02, newBid);

                    if (typeof minBid === 'number') newBid = Math.max(minBid, newBid);
                    if (typeof maxBid === 'number') newBid = Math.min(maxBid, newBid);
                    
                    newBid = parseFloat(newBid.toFixed(2));
                    
                    if (newBid !== entity.currentBid) {
                        const campaignId = entity.campaignId;
                        if (!actionsByCampaign[campaignId]) {
                            actionsByCampaign[campaignId] = { changes: [], newNegatives: [] };
                        }

                        const triggeringMetrics = group.conditions.map(c => {
                            const metrics = calculateMetricsForWindow(entity.dailyData, c.timeWindow, referenceDate);
                            return { metric: c.metric, timeWindow: c.timeWindow, value: metrics[c.metric], condition: `${c.operator} ${c.value}` };
                        });
                        
                        actionsByCampaign[campaignId].changes.push({
                           entityType: entity.entityType, entityId: entity.entityId, entityText: entity.entityText,
                           oldBid: entity.currentBid, newBid: newBid, triggeringMetrics
                        });

                         const updatePayload = {
                             [entity.entityType === 'keyword' ? 'keywordId' : 'targetId']: entity.entityId,
                             bid: newBid
                         };
                         if (entity.entityType === 'keyword') keywordsToUpdate.push(updatePayload);
                         else targetsToUpdate.push(updatePayload);
                    }
                }
                break;
            }
        }
    }

    if (keywordsToUpdate.length > 0) {
        try {
            await amazonAdsApiRequest({
                method: 'put', url: '/sp/keywords', profileId: rule.profile_id,
                data: { keywords: keywordsToUpdate },
                headers: {
                    'Content-Type': 'application/vnd.spKeyword.v3+json',
                    'Accept': 'application/vnd.spKeyword.v3+json'
                }
            });
        } catch(e) { console.error('[RulesEngine] Failed to apply keyword bid updates.', e); }
    }
     if (targetsToUpdate.length > 0) {
        try {
            await amazonAdsApiRequest({
                method: 'put', url: '/sp/targets', profileId: rule.profile_id,
                data: { targetingClauses: targetsToUpdate },
                headers: {
                    'Content-Type': 'application/vnd.spTargetingClause.v3+json',
                    'Accept': 'application/vnd.spTargetingClause.v3+json'
                }
            });
        } catch (e) { console.error('[RulesEngine] Failed to apply target bid updates.', e); }
    }

    const totalChanges = Object.values(actionsByCampaign).reduce((sum, campaign) => sum + campaign.changes.length, 0);
    return {
        summary: `Adjusted bids for ${totalChanges} target(s)/keyword(s).`,
        details: { actions_by_campaign: actionsByCampaign },
        actedOnEntities: [...keywordsToUpdate.map(k => k.keywordId), ...targetsToUpdate.map(t => t.targetId)]
    };
};

const evaluateSearchTermAutomationRule = async (rule, performanceData, throttledEntities) => {
    const negativeKeywordsToCreate = [];
    const negativeTargetsToCreate = [];
    const actionsByCampaign = {};
    const referenceDate = new Date(getLocalDateString(REPORTING_TIMEZONE));
    referenceDate.setDate(referenceDate.getDate() - 2);

    const asinRegex = /^b0[a-z0-9]{8}$/i;

    for (const entity of performanceData.values()) {
        if (throttledEntities.has(entity.entityText)) continue;

        for (const group of rule.config.conditionGroups) {
            let allConditionsMet = true;
            for (const condition of group.conditions) {
                const metrics = calculateMetricsForWindow(entity.dailyData, condition.timeWindow, referenceDate);
                if (!checkCondition(metrics[condition.metric], condition.operator, condition.value)) {
                    allConditionsMet = false;
                    break;
                }
            }

            if (allConditionsMet) {
                const { type, matchType } = group.action;
                if (type === 'negateSearchTerm') {
                    const searchTerm = entity.entityText;
                    const isAsin = asinRegex.test(searchTerm);

                    const campaignId = entity.campaignId;
                    if (!actionsByCampaign[campaignId]) {
                        actionsByCampaign[campaignId] = { changes: [], newNegatives: [] };
                    }

                    const triggeringMetrics = group.conditions.map(c => {
                        const metrics = calculateMetricsForWindow(entity.dailyData, c.timeWindow, referenceDate);
                        return { metric: c.metric, timeWindow: c.timeWindow, value: metrics[c.metric], condition: `${c.operator} ${c.value}` };
                    });

                    actionsByCampaign[campaignId].newNegatives.push({
                        searchTerm: searchTerm,
                        campaignId,
                        adGroupId: entity.adGroupId,
                        matchType: isAsin ? 'NEGATIVE_PRODUCT_TARGET' : matchType,
                        triggeringMetrics
                    });

                    if (isAsin) {
                        negativeTargetsToCreate.push({
                            campaignId: entity.campaignId,
                            adGroupId: entity.adGroupId,
                            expression: [{ type: 'ASIN_SAME_AS', value: searchTerm }]
                        });
                    } else {
                        negativeKeywordsToCreate.push({
                            campaignId: entity.campaignId,
                            adGroupId: entity.adGroupId,
                            keywordText: entity.entityText,
                            matchType: matchType
                        });
                    }
                }
                break;
            }
        }
    }

    if (negativeKeywordsToCreate.length > 0) {
        const apiPayload = negativeKeywordsToCreate.map(kw => ({
            ...kw,
            state: 'ENABLED'
        }));

        await amazonAdsApiRequest({
            method: 'post', url: '/sp/negativeKeywords', profileId: rule.profile_id,
            data: { negativeKeywords: apiPayload },
            headers: {
                'Content-Type': 'application/vnd.spNegativeKeyword.v3+json',
                'Accept': 'application/vnd.spNegativeKeyword.v3+json'
            }
        });
    }

    if (negativeTargetsToCreate.length > 0) {
        const apiPayload = negativeTargetsToCreate.map(target => ({
            ...target,
            state: 'ENABLED'
        }));
        await amazonAdsApiRequest({
            method: 'post',
            url: '/sp/negativeTargets',
            profileId: rule.profile_id,
            data: { negativeTargetingClauses: apiPayload },
            headers: {
                'Content-Type': 'application/vnd.spNegativeTargetingClause.v3+json',
                'Accept': 'application/vnd.spNegativeTargetingClause.v3+json',
            }
        });
    }

    const totalKeywords = negativeKeywordsToCreate.length;
    const totalTargets = negativeTargetsToCreate.length;
    const summaryParts = [];
    if (totalKeywords > 0) summaryParts.push(`Created ${totalKeywords} new negative keyword(s)`);
    if (totalTargets > 0) summaryParts.push(`Created ${totalTargets} new negative product target(s)`);
    
    return {
        summary: summaryParts.length > 0 ? summaryParts.join(' and ') + '.' : 'No search terms met the criteria for negation.',
        details: { actions_by_campaign: actionsByCampaign },
        actedOnEntities: [...negativeKeywordsToCreate.map(n => n.keywordText), ...negativeTargetsToCreate.map(n => n.expression[0].value)]
    };
};

const evaluateBudgetAccelerationRule = async (rule, performanceData) => {
    const actionsByCampaign = {};
    const campaignsToUpdate = [];
    const referenceDate = new Date(getLocalDateString(REPORTING_TIMEZONE));
    const todayDateStr = referenceDate.toISOString().split('T')[0];

    for (const campaignPerf of performanceData.values()) {
        const currentBudget = campaignPerf.originalBudget; // This is the current budget from the API

        for (const group of rule.config.conditionGroups) {
            let allConditionsMet = true;
            for (const condition of group.conditions) {
                const metrics = calculateMetricsForWindow(campaignPerf.dailyData, 'TODAY', referenceDate);
                
                let metricValue;
                if (condition.metric === 'budgetUtilization') {
                    metricValue = currentBudget > 0 ? (metrics.spend / currentBudget) * 100 : 0;
                } else {
                    metricValue = metrics[condition.metric];
                }
                
                if (!checkCondition(metricValue, condition.operator, condition.value)) {
                    allConditionsMet = false;
                    break;
                }
            }

            if (allConditionsMet) {
                const { type, value } = group.action;
                let newBudget;
                if (type === 'increaseBudgetPercent') {
                    newBudget = currentBudget * (1 + (value / 100));
                } else if (type === 'setBudgetAmount') {
                    newBudget = value;
                }
                newBudget = parseFloat(newBudget.toFixed(2));

                if (newBudget > currentBudget) {
                    // Atomically insert the original budget on the FIRST increase of the day.
                    // Subsequent attempts will be ignored due to the unique constraint,
                    // preserving the true original budget.
                    await pool.query(
                        `INSERT INTO daily_budget_overrides (campaign_id, original_budget, override_date) 
                         VALUES ($1, $2, $3) 
                         ON CONFLICT (campaign_id, override_date) DO NOTHING`,
                        [campaignPerf.campaignId, currentBudget, todayDateStr]
                    );

                    campaignsToUpdate.push({
                        campaignId: String(campaignPerf.campaignId),
                        budget: { budget: newBudget, budgetType: 'DAILY' }
                    });

                    if (!actionsByCampaign[campaignPerf.campaignId]) actionsByCampaign[campaignPerf.campaignId] = { changes: [] };
                    actionsByCampaign[campaignPerf.campaignId].changes.push({
                        entityType: 'campaign', entityId: campaignPerf.campaignId,
                        oldBudget: currentBudget, newBudget
                    });
                }
                break; // First match wins
            }
        }
    }

    if (campaignsToUpdate.length > 0) {
        await amazonAdsApiRequest({
            method: 'put', url: '/sp/campaigns', profileId: rule.profile_id,
            data: { campaigns: campaignsToUpdate },
            headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' },
        });
    }

    return {
        summary: `Accelerated budget for ${campaignsToUpdate.length} campaign(s).`,
        details: { actions_by_campaign: actionsByCampaign },
        actedOnEntities: [] // Cooldown not applicable here
    };
};

// --- Main Orchestration ---

const isRuleDue = (rule) => {
    const now = new Date();
    const lastRun = rule.last_run_at ? new Date(rule.last_run_at) : null;
    const frequency = rule.config.frequency;

    if (!frequency || !frequency.unit || !frequency.value) {
        console.warn(`[RulesEngine] Rule ${rule.id} has invalid frequency config.`);
        return false;
    }

    if (frequency.unit === 'minutes' || frequency.unit === 'hours') {
        if (!lastRun) return true;
        const diffMs = now.getTime() - lastRun.getTime();
        let requiredMs = 0;
        if (frequency.unit === 'minutes') requiredMs = frequency.value * 60 * 1000;
        else requiredMs = frequency.value * 60 * 60 * 1000;
        return diffMs >= requiredMs;
    }

    if (frequency.unit === 'days') {
        // If no specific start time, use old logic based on 24-hour intervals
        if (!frequency.startTime) {
            if (!lastRun) return true;
            const diffMs = now.getTime() - lastRun.getTime();
            const requiredMs = frequency.value * 24 * 60 * 60 * 1000;
            return diffMs >= requiredMs;
        }

        // Logic for 'days' with a specific start time in UTC-7
        const timeZone = 'America/Phoenix'; // UTC-7, no DST.

        const nowInTz = new Date(now.toLocaleString('en-US', { timeZone }));
        const [startHour, startMinute] = frequency.startTime.split(':').map(Number);
        
        const isPastScheduledTimeToday = (nowInTz.getHours() > startHour) || 
                                       (nowInTz.getHours() === startHour && nowInTz.getMinutes() >= startMinute);

        if (!isPastScheduledTimeToday) {
            return false; // Not time yet today.
        }

        if (!lastRun) {
            return true; // It's past the scheduled time and has never run. It's due.
        }

        const lastRunInTz = new Date(lastRun.toLocaleString('en-US', { timeZone }));

        // Calculate the difference in calendar days in the target timezone.
        const startOfTodayInTz = new Date(nowInTz);
        startOfTodayInTz.setHours(0, 0, 0, 0);
        
        const startOfLastRunDayInTz = new Date(lastRunInTz);
        startOfLastRunDayInTz.setHours(0, 0, 0, 0);

        const diffTime = startOfTodayInTz.getTime() - startOfLastRunDayInTz.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        // It's only due if enough full days have passed
        return diffDays >= frequency.value;
    }

    return false;
};

const processRule = async (rule) => {
    console.log(`[RulesEngine] ⚙️  Processing rule "${rule.name}" (ID: ${rule.id}).`);
    
    try {
        const campaignIds = rule.scope?.campaignIds || [];

        // --- Cooldown Logic: Check throttled entities (keywords/targets) at the individual level ---
        // This ensures that if an action was recently taken on a specific keyword, only that keyword is paused,
        // not the entire campaign.
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
            result = await evaluateBidAdjustmentRule(rule, performanceData, throttledEntities);
        } else if (rule.rule_type === 'SEARCH_TERM_AUTOMATION') {
            result = await evaluateSearchTermAutomationRule(rule, performanceData, throttledEntities);
        } else if (rule.rule_type === 'BUDGET_ACCELERATION') {
            result = await evaluateBudgetAccelerationRule(rule, performanceData);
        } else {
             throw new Error(`Unknown rule type: ${rule.rule_type}`);
        }

        // --- Cooldown Logic: Apply new throttles at the individual entity level ---
        // For each keyword or target that was acted upon, record its specific ID in the throttle table.
        if (result.actedOnEntities && result.actedOnEntities.length > 0 && cooldownConfig.value > 0) {
            const { value, unit } = cooldownConfig;
            const interval = `${value} ${unit}`;
            const upsertQuery = `
                INSERT INTO automation_action_throttle (rule_id, entity_id, throttle_until)
                SELECT $1, unnest($2::text[]), NOW() + $3::interval
                ON CONFLICT (rule_id, entity_id) DO UPDATE
                SET throttle_until = EXCLUDED.throttle_until;
            `;
            // The query's `unnest` function efficiently inserts or updates a row for each individual entity ID.
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

const checkAndRunDueRules = async () => {
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

const resetBudgets = async () => {
    console.log(`[BudgetReset] 🌙 Starting daily budget reset process...`);
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
        
        // This assumes all campaigns are under the same profile, which is current app behavior.
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
        
        // Mark as reverted in DB
        const revertedIds = overrides.map(o => o.id);
        await pool.query(`UPDATE daily_budget_overrides SET reverted_at = NOW() WHERE id = ANY($1)`, [revertedIds]);
        console.log(`[BudgetReset] 💾 Marked ${revertedIds.length} overrides as reverted in the database.`);

    } catch (error) {
        console.error('[BudgetReset] ❌ CRITICAL: Failed during budget reset process.', error);
    }
};

export const startRulesEngine = () => {
    if (mainTask) {
        console.warn('[RulesEngine] Engine is already running. Skipping new start.');
        return;
    }
    console.log('[RulesEngine] 🚀 Starting the automation rules engine...');
    // Run every minute to check for due rules
    mainTask = cron.schedule('* * * * *', checkAndRunDueRules, {
        scheduled: true,
        timezone: "UTC"
    });
    // Schedule the daily budget reset
    resetTask = cron.schedule('55 23 * * *', resetBudgets, {
        scheduled: true,
        timezone: REPORTING_TIMEZONE
    });
};

export const stopRulesEngine = () => {
    if (mainTask) {
        console.log('[RulesEngine] 🛑 Stopping the automation rules engine.');
        mainTask.stop();
        mainTask = null;
    }
    if (resetTask) {
        console.log('[RulesEngine] 🛑 Stopping the budget reset task.');
        resetTask.stop();
        resetTask = null;
    }
};

// Graceful shutdown
process.on('SIGINT', () => {
  stopRulesEngine();
  pool.end(() => {
    console.log('[RulesEngine] PostgreSQL pool has been closed.');
    process.exit(0);
  });
});
