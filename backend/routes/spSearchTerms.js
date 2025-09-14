import express from 'express';
import pool from '../db.js';

const router = express.Router();

// A safer formatDate that avoids timezone shifts from toISOString()
const formatDateSafe = (d) => {
    if (!d) return '';
    const date = new Date(d);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Normalizes a percentage value (e.g., 95.5 for 95.5%) into a decimal ratio (e.g., 0.955).
 * Safely handles numeric values that might be represented as strings from the database driver.
 * @param {any} value - The value to normalize.
 * @returns {number | any} The normalized decimal, or the original value.
 */
const normalizePercent = (value) => {
    if (value === null || typeof value === 'undefined') {
        return value; // Keep null/undefined as is
    }
    // The pg driver can return NUMERIC types as strings. Coerce to a number.
    const num = Number(value);
    
    // If the result is a valid number (not NaN), perform the division.
    // Otherwise, return the original value.
    return !isNaN(num) ? num / 100 : value;
};


// --- SP Search Term Report Endpoints ---

router.get('/sp-search-terms-filters', async (req, res) => {
    try {
        console.log(`[Server] Querying filters for SP Search Term Report view.`);
        const asinsQuery = 'SELECT DISTINCT asin FROM sponsored_products_search_term_report WHERE asin IS NOT NULL ORDER BY asin ASC;';
        
        const [asinsResult] = await Promise.all([
            pool.query(asinsQuery),
        ]);

        const asins = asinsResult.rows.map(r => r.asin);
        
        res.json({ asins, dates: [] });
    } catch (error) {
        console.error("[Server] Error fetching SP search term filters:", error);
        if (error.code === '42P01') { // PostgreSQL 'undefined_table' error
            return res.status(500).json({ error: "Database table for SP Search Term Report not found. Please run the migration script (003_add_sp_search_term_report_table.sql) to create it." });
        }
        res.status(500).json({ error: "Failed to fetch filters. Please check the backend server logs for details." });
    }
});

router.get('/sp-search-terms', async (req, res) => {
    const { asin, startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'A startDate and endDate are required' });
    }
    console.log(`[Server] Querying SP search terms for ASIN: ${asin || 'ALL'}, from ${startDate} to ${endDate}`);

    try {
        const queryParams = [startDate, endDate];
        let whereClauses = [`report_date BETWEEN $1 AND $2`];

        if (asin) {
            queryParams.push(asin);
            whereClauses.push(`asin = $${queryParams.length}`);
        }
        
        const query = `
            SELECT 
                campaign_name,
                campaign_id,
                ad_group_name,
                ad_group_id,
                customer_search_term, 
                asin,
                targeting, 
                match_type,
                SUM(COALESCE(impressions, 0)) as impressions,
                SUM(COALESCE(clicks, 0)) as clicks,
                SUM(COALESCE(spend, cost, 0)) as spend,
                SUM(COALESCE(seven_day_total_sales, sales_7d, 0)) as seven_day_total_sales,
                SUM(COALESCE(seven_day_total_orders, purchases_7d, 0)) as seven_day_total_orders,
                SUM(COALESCE(seven_day_total_units, units_sold_clicks_7d, 0)) as seven_day_total_units
            FROM sponsored_products_search_term_report 
            WHERE ${whereClauses.join(' AND ')}
            GROUP BY 
                campaign_name, 
                campaign_id,
                ad_group_name,
                ad_group_id,
                customer_search_term, 
                asin,
                targeting, 
                match_type
            ORDER BY SUM(COALESCE(impressions, 0)) DESC NULLS LAST;
        `;

        const result = await pool.query(query, queryParams);
        
        const transformedData = result.rows.map(row => {
            const spend = parseFloat(row.spend || 0);
            const clicks = parseInt(row.clicks || 0);
            const sales = parseFloat(row.seven_day_total_sales || 0);

            const costPerClick = clicks > 0 ? spend / clicks : 0;
            const sevenDayAcos = sales > 0 ? spend / sales : 0;
            const sevenDayRoas = spend > 0 ? sales / spend : 0;

            return {
                campaignName: row.campaign_name,
                campaignId: row.campaign_id,
                adGroupName: row.ad_group_name,
                adGroupId: row.ad_group_id,
                customerSearchTerm: row.customer_search_term,
                impressions: parseInt(row.impressions || 0),
                clicks: clicks,
                costPerClick: costPerClick,
                spend: spend,
                sevenDayTotalSales: sales,
                sevenDayAcos: sevenDayAcos,
                asin: row.asin,
                targeting: row.targeting,
                matchType: row.match_type,
                sevenDayRoas: sevenDayRoas,
                sevenDayTotalOrders: parseInt(row.seven_day_total_orders || 0),
                sevenDayTotalUnits: parseInt(row.seven_day_total_units || 0)
            };
        });
        
        console.log(`[Server] Found and transformed ${transformedData.length} aggregated SP search term records.`);
        res.json(transformedData);

    } catch (error) {
        console.error("[Server] Error fetching SP search term data:", error);
        res.status(500).json({ error: "Failed to fetch SP search term data." });
    }
});

export default router;