// backend/services/automation/dataFetcher.js
import pool from '../../db.js';
import { amazonAdsApiRequest } from '../../helpers/amazon-api.js';
import { getLocalDateString } from './utils.js';

const REPORTING_TIMEZONE = 'America/Los_Angeles';

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
    
    // 2. Fetch today's performance from the stream using the correct aggregation logic
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const query = `
        WITH traffic_data AS (
            SELECT
                (event_data->>'campaign_id') as campaign_id_text,
                COALESCE(SUM((event_data->>'cost')::numeric), 0.00) as adjusted_spend
            FROM raw_stream_events
            WHERE event_type = 'sp-traffic'
              AND (event_data->>'time_window_start')::timestamptz >= $1
              AND (event_data->>'campaign_id') = ANY($2)
            GROUP BY 1
        ),
        conversion_data AS (
            SELECT
                (event_data->>'campaign_id') as campaign_id_text,
                COALESCE(SUM((event_data->>'attributed_sales_1d')::numeric), 0.00) as sales,
                COALESCE(SUM((event_data->>'attributed_conversions_1d')::bigint), 0) as orders
            FROM raw_stream_events
            WHERE event_type = 'sp-conversion'
              AND (event_data->>'time_window_start')::timestamptz >= $1
              AND (event_data->>'campaign_id') = ANY($2)
            GROUP BY 1
        )
        SELECT
            COALESCE(t.campaign_id_text, c.campaign_id_text) as campaign_id_text,
            COALESCE(t.adjusted_spend, 0.00) as spend,
            COALESCE(c.sales, 0.00) as sales,
            COALESCE(c.orders, 0) as orders
        FROM traffic_data t
        FULL OUTER JOIN conversion_data c ON t.campaign_id_text = c.campaign_id_text
        WHERE COALESCE(t.campaign_id_text, c.campaign_id_text) IS NOT NULL;
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
export const getPerformanceData = async (rule, campaignIds) => {
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