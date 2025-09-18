// backend/routes/ppcManagementApi.js
import express from 'express';
import { amazonAdsApiRequest } from '../helpers/amazon-api.js';

const router = express.Router();

/**
 * GET /api/amazon/profiles
 * Fetches all available advertising profiles.
 */
router.get('/profiles', async (req, res) => {
    try {
        const response = await amazonAdsApiRequest({
            method: 'get',
            url: '/v2/profiles',
        });
        res.json(response);
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: 'An unknown error occurred' });
    }
});

/**
 * Fetches campaigns for Sponsored Products using POST with pagination.
 */
const fetchCampaignsForTypePost = async (profileId, url, headers, body) => {
    let allCampaigns = [];
    let nextToken = null;
    
    do {
        const requestBody = { ...body };
        if (nextToken) {
            requestBody.nextToken = nextToken;
        }

        const data = await amazonAdsApiRequest({
            method: 'post',
            url,
            profileId,
            data: requestBody,
            headers,
        });

        const campaignsKey = Object.keys(data).find(k => k.toLowerCase().includes('campaigns'));
        if (campaignsKey && data[campaignsKey]) {
            allCampaigns = allCampaigns.concat(data[campaignsKey]);
        }
        nextToken = data.nextToken;

    } while (nextToken);

    return allCampaigns;
};

/**
 * Fetches campaigns for ad products using GET with pagination (for SB, SD).
 */
const fetchCampaignsForTypeGet = async (profileId, url, headers, params) => {
    let allCampaigns = [];
    let nextToken = null;

    do {
        const requestParams = { ...params };
        if (nextToken) {
            requestParams.nextToken = nextToken;
        }

        const data = await amazonAdsApiRequest({
            method: 'get',
            url,
            profileId,
            params: requestParams,
            headers,
        });

        if (data.campaigns && Array.isArray(data.campaigns)) {
            allCampaigns = allCampaigns.concat(data.campaigns);
        }
        nextToken = data.nextToken;

    } while (nextToken);

    return allCampaigns;
};


/**
 * POST /api/amazon/campaigns/list
 * Fetches a list of campaigns across all ad types (SP, SB, SD).
 */
router.post('/campaigns/list', async (req, res) => {
    const { profileId, stateFilter, campaignIdFilter } = req.body;
    if (!profileId) {
        return res.status(400).json({ message: 'profileId is required in the request body.' });
    }

    try {
        const baseStateFilter = stateFilter || ["ENABLED", "PAUSED", "ARCHIVED"];

        // --- Sponsored Products (POST) ---
        const spBody = {
            maxResults: 500,
            stateFilter: { include: baseStateFilter },
        };
        if (campaignIdFilter && Array.isArray(campaignIdFilter) && campaignIdFilter.length > 0) {
            spBody.campaignIdFilter = { include: campaignIdFilter.map(id => id.toString()) };
        }
        const spPromise = fetchCampaignsForTypePost(profileId, '/sp/campaigns/list', 
            { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' }, 
            spBody
        );

        // --- Sponsored Brands & Display (GET) ---
        const getStateFilterForGet = baseStateFilter.map(s => s.toLowerCase()).join(',');
        const getCampaignIdFilter = (campaignIdFilter && Array.isArray(campaignIdFilter) && campaignIdFilter.length > 0) 
            ? campaignIdFilter.map(id => id.toString()).join(',') 
            : undefined;

        // Sponsored Brands
        const sbParams = {
            stateFilter: getStateFilterForGet,
            campaignIdFilter: getCampaignIdFilter,
            maxResults: 100, // SB v4 supports maxResults
        };
        const sbPromise = fetchCampaignsForTypeGet(profileId, '/sb/v4/campaigns', 
            { 'Accept': 'application/vnd.sbcampaign.v4+json' },
            sbParams
        ).catch(err => { console.error("SB Campaign fetch failed:", err.details || err); return []; }); // Add resilience

        // Sponsored Display
        const sdParams = {
            stateFilter: getStateFilterForGet,
            campaignIdFilter: getCampaignIdFilter,
            count: 100, // SD uses 'count'
        };
        const sdPromise = fetchCampaignsForTypeGet(profileId, '/sd/campaigns', 
            { 'Accept': 'application/vnd.sdcampaignresponse.v3.3+json' },
            sdParams
        ).catch(err => { console.error("SD Campaign fetch failed:", err.details || err); return []; }); // Add resilience

        const [spCampaigns, sbCampaigns, sdCampaigns] = await Promise.all([spPromise, sbPromise, sdPromise]);

        // Transform and merge results
        const transformedSP = spCampaigns.map(c => ({
            campaignId: c.campaignId, name: c.name, campaignType: 'sponsoredProducts',
            targetingType: c.targetingType, state: c.state.toLowerCase(),
            dailyBudget: c.budget?.amount ?? 0,
            startDate: c.startDate, endDate: c.endDate, bidding: c.bidding,
        }));
         const transformedSB = sbCampaigns.map(c => ({
            campaignId: c.campaignId, name: c.name, campaignType: 'sponsoredBrands',
            targetingType: 'UNKNOWN', state: c.state.toLowerCase(),
            dailyBudget: c.budget?.amount ?? 0,
            startDate: c.startDate, endDate: c.endDate, bidding: c.bidding,
        }));
        const transformedSD = sdCampaigns.map(c => ({
            campaignId: c.campaignId, name: c.name, campaignType: 'sponsoredDisplay',
            targetingType: c.tactic, state: c.state.toLowerCase(),
            dailyBudget: c.budget?.budget ?? 0,
            startDate: c.startDate, endDate: c.endDate, bidding: c.bidding,
        }));
        
        const allCampaigns = [...transformedSP, ...transformedSB, ...transformedSD];
        
        res.json({ campaigns: allCampaigns });
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: 'An unknown error occurred' });
    }
});

/**
 * PUT /api/amazon/campaigns
 * Updates one or more Sponsored Products campaigns.
 */
router.put('/campaigns', async (req, res) => {
    const { profileId, updates } = req.body;
    if (!profileId || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ message: 'profileId and a non-empty updates array are required.' });
    }
    try {
        const transformedUpdates = updates.map(update => {
            const newUpdate = { campaignId: update.campaignId };
            if (update.state) newUpdate.state = update.state.toUpperCase();
            if (update.budget && typeof update.budget.amount === 'number') {
                newUpdate.budget = { budget: update.budget.amount, budgetType: 'DAILY' };
            }
            return newUpdate;
        });
        const data = await amazonAdsApiRequest({
            method: 'put', url: '/sp/campaigns', profileId,
            data: { campaigns: transformedUpdates },
            headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' },
        });
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: 'An unknown error occurred' });
    }
});

/**
 * POST /api/amazon/campaigns/:campaignId/adgroups
 * Fetches ad groups for a specific campaign.
 */
router.post('/campaigns/:campaignId/adgroups', async (req, res) => {
    const { campaignId } = req.params;
    const { profileId } = req.body;
    if (!profileId) return res.status(400).json({ message: 'profileId is required.' });
    
    const campaignIdNum = Number(campaignId);
    if (Number.isNaN(campaignIdNum)) {
        return res.status(400).json({ message: 'Invalid campaignId.' });
    }

    try {
        const requestBody = {
            campaignIdFilter: { include: [campaignId] },
            stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] },
            maxResults: 500,
        };

        let allAdGroups = [];
        let nextToken = null;

        do {
            if (nextToken) {
                requestBody.nextToken = nextToken;
            }
            const data = await amazonAdsApiRequest({
                method: 'post', url: '/sp/adGroups/list', profileId,
                data: requestBody,
                headers: { 'Content-Type': 'application/vnd.spAdGroup.v3+json', 'Accept': 'application/vnd.spAdGroup.v3+json' },
            });
            
            if (data.adGroups && Array.isArray(data.adGroups)) {
                allAdGroups = allAdGroups.concat(data.adGroups);
            }
            nextToken = data.nextToken;
        } while (nextToken);
        
        const adGroups = allAdGroups.map(ag => ({
            adGroupId: ag.adGroupId, name: ag.name, campaignId: ag.campaignId,
            defaultBid: ag.defaultBid, state: (ag.state || 'archived').toLowerCase(),
        }));
        res.json({ adGroups });
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: `Failed to fetch ad groups for campaign ${campaignId}` });
    }
});

/**
 * POST /api/amazon/adgroups/:adGroupId/keywords
 * Fetches keywords for a specific ad group.
 */
router.post('/adgroups/:adGroupId/keywords', async (req, res) => {
    const { adGroupId } = req.params;
    const { profileId } = req.body;
    if (!profileId) return res.status(400).json({ message: 'profileId is required.' });
    
    const adGroupIdNum = Number(adGroupId);
    if (Number.isNaN(adGroupIdNum)) {
        return res.status(400).json({ message: 'Invalid adGroupId.' });
    }

    try {
        const requestBody = {
            adGroupIdFilter: { include: [adGroupId] },
            stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] },
            maxResults: 1000,
        };

        let allKeywords = [];
        let nextToken = null;

        do {
            if (nextToken) {
                requestBody.nextToken = nextToken;
            }
            const data = await amazonAdsApiRequest({
                method: 'post', url: '/sp/keywords/list', profileId,
                data: requestBody,
                headers: { 'Content-Type': 'application/vnd.spKeyword.v3+json', 'Accept': 'application/vnd.spKeyword.v3+json' },
            });
            
            if (data.keywords && Array.isArray(data.keywords)) {
                allKeywords = allKeywords.concat(data.keywords);
            }
            nextToken = data.nextToken;
        } while (nextToken);
        
        const keywords = allKeywords.map(kw => ({
            keywordId: kw.keywordId, adGroupId: kw.adGroupId, campaignId: kw.campaignId,
            keywordText: kw.keywordText, matchType: (kw.matchType || 'unknown').toLowerCase(),
            state: (kw.state || 'archived').toLowerCase(), bid: kw.bid,
        }));
        
        res.json({ keywords, adGroupName: `Ad Group ${adGroupId}`, campaignId: keywords[0]?.campaignId });
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: `Failed to fetch keywords for ad group ${adGroupId}` });
    }
});

/**
 * PUT /api/amazon/keywords
 * Updates one or more Sponsored Products keywords.
 */
router.put('/keywords', async (req, res) => {
    const { profileId, updates } = req.body;
    if (!profileId || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ message: 'profileId and a non-empty updates array are required.' });
    }
    try {
         const transformedUpdates = updates.map(update => {
            const newUpdate = { keywordId: update.keywordId };
            if (update.state) newUpdate.state = update.state.toUpperCase();
            if (update.bid) newUpdate.bid = update.bid;
            return newUpdate;
        });
        
        const data = await amazonAdsApiRequest({
            method: 'put', url: '/sp/keywords', profileId,
            data: { keywords: transformedUpdates },
            headers: { 'Content-Type': 'application/vnd.spKeyword.v3+json', 'Accept': 'application/vnd.spKeyword.v3+json' },
        });
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: 'An unknown error occurred' });
    }
});

/**
 * POST /api/amazon/targets/list
 * Fetches targeting clauses for a given list of target IDs.
 */
router.post('/targets/list', async (req, res) => {
    const { profileId, targetIdFilter } = req.body;
    if (!profileId || !Array.isArray(targetIdFilter) || targetIdFilter.length === 0) {
        return res.status(400).json({ message: 'profileId and targetIdFilter array are required.' });
    }
    try {
        const data = await amazonAdsApiRequest({
            method: 'post',
            url: '/sp/targets/list',
            profileId,
            data: { targetIdFilter: { include: targetIdFilter } },
            headers: { 'Content-Type': 'application/vnd.spTargetingClause.v3+json', 'Accept': 'application/vnd.spTargetingClause.v3+json' }
        });
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: 'Failed to list targets' });
    }
});

/**
 * PUT /api/amazon/targets
 * Updates one or more SP targets.
 */
router.put('/targets', async (req, res) => {
    const { profileId, updates } = req.body;
    if (!profileId || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ message: 'profileId and a non-empty updates array are required.' });
    }
    try {
        const transformedUpdates = updates.map(u => ({
            targetId: u.targetId,
            state: u.state?.toUpperCase(),
            bid: u.bid,
        }));

        const data = await amazonAdsApiRequest({
            method: 'put',
            url: '/sp/targets',
            profileId,
            data: { targetingClauses: transformedUpdates },
            headers: { 'Content-Type': 'application/vnd.spTargetingClause.v3+json', 'Accept': 'application/vnd.spTargetingClause.v3+json' },
        });
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: 'Failed to update targets' });
    }
});


/**
 * POST /api/amazon/negativeKeywords
 * Creates one or more negative keywords.
 */
router.post('/negativeKeywords', async (req, res) => {
    const { profileId, negativeKeywords } = req.body;
    if (!profileId || !Array.isArray(negativeKeywords) || negativeKeywords.length === 0) {
        return res.status(400).json({ message: 'profileId and a non-empty negativeKeywords array are required.' });
    }

    try {
        // FIX: The Amazon API expects uppercase enum values for matchType, e.g., 'NEGATIVE_EXACT'.
        // The previous logic and comment were incorrect.
        const transformedKeywords = negativeKeywords.map(kw => ({
            ...kw,
            state: 'ENABLED',
            matchType: kw.matchType // Pass the value directly from the request
        }));

        const data = await amazonAdsApiRequest({
            method: 'post',
            url: '/sp/negativeKeywords',
            profileId,
            data: { negativeKeywords: transformedKeywords },
            headers: { 'Content-Type': 'application/vnd.spNegativeKeyword.v3+json', 'Accept': 'application/vnd.spNegativeKeyword.v3+json' },
        });
        res.status(207).json(data); // 207 Multi-Status is common for bulk operations
    } catch (error) {
        res.status(error.status || 500).json(error.details || { message: 'An unknown error occurred while creating negative keywords' });
    }
});


export default router;