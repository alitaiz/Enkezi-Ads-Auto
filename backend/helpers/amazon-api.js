// backend/helpers/amazon-api.js
import axios from 'axios';
import https from 'https';
import { URLSearchParams } from 'url';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const ADS_API_ENDPOINT = 'https://advertising-api.amazon.com';

// Simple in-memory cache for the access token to avoid excessive refreshes.
let adsApiTokenCache = {
    token: null,
    expiresAt: 0,
};

/**
 * Retrieves a valid LWA access token, using a cache to avoid unnecessary refreshes.
 * @returns {Promise<string>} A valid access token.
 */
export async function getAdsApiAccessToken() {
    // Check cache first
    if (adsApiTokenCache.token && Date.now() < adsApiTokenCache.expiresAt) {
        console.log("[Auth] Using cached Amazon Ads API access token.");
        return adsApiTokenCache.token;
    }

    console.log("[Auth] Cached token is invalid or expired. Requesting a new one...");
    
    const {
        ADS_API_CLIENT_ID,
        ADS_API_CLIENT_SECRET,
        ADS_API_REFRESH_TOKEN,
    } = process.env;

    if (!ADS_API_CLIENT_ID || !ADS_API_CLIENT_SECRET || !ADS_API_REFRESH_TOKEN) {
        throw new Error('Missing Amazon Ads API credentials in .env file.');
    }
    
    try {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: ADS_API_REFRESH_TOKEN,
            client_id: ADS_API_CLIENT_ID,
            client_secret: ADS_API_CLIENT_SECRET,
        });

        // FIX: Added charset=UTF-8 to Content-Type for maximum compatibility, especially with newer APIs like SBv4.
        const response = await axios.post(LWA_TOKEN_URL, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        });

        // Robust check to ensure a valid token string was received from Amazon.
        const responseData = response.data;
        if (!responseData || typeof responseData.access_token !== 'string' || responseData.access_token.trim() === '') {
            console.error('[Auth] Invalid token response from Amazon LWA:', responseData);
            throw new Error('Failed to retrieve a valid access_token from Amazon LWA. The response was malformed.');
        }
        
        const accessToken = responseData.access_token.trim();
        
        adsApiTokenCache = {
            token: accessToken,
            // Cache for 55 minutes (token is valid for 60 minutes)
            expiresAt: Date.now() + 55 * 60 * 1000,
        };

        console.log("[Auth] Successfully obtained and cached new Amazon Ads API access token.");
        return adsApiTokenCache.token;

    } catch (error) {
        // Clear the cache on a failed refresh attempt.
        adsApiTokenCache = { token: null, expiresAt: 0 };
        const errorMessage = error.response?.data?.error_description || error.response?.data?.message || error.message;
        console.error("[Auth] Error refreshing Amazon Ads API access token:", errorMessage);
        throw new Error(`Could not refresh Amazon Ads API access token: ${errorMessage}. Please check your credentials.`);
    }
}

/**
 * A wrapper for making authenticated requests to the Amazon Ads API.
 * This function is now more robust, guarding against invalid tokens and header overwrites.
 */
export async function amazonAdsApiRequest({ method, url, profileId, data, params, headers = {} }) {
    try {
        const accessToken = await getAdsApiAccessToken();

        // Guard against falsy tokens to prevent malformed Authorization headers.
        if (!accessToken) {
            throw new Error("Cannot make Amazon Ads API request: failed to obtain a valid access token.");
        }
        
        const { Authorization, ...otherHeaders } = headers;
        if (Authorization) {
            console.warn('[API Request] An explicit Authorization header was passed to amazonAdsApiRequest and has been ignored to prevent conflicts.');
        }

        const finalHeaders = {
            'Amazon-Advertising-API-ClientId': process.env.ADS_API_CLIENT_ID,
            'Authorization': `Bearer ${accessToken}`, // This is now guaranteed to be safe.
            ...otherHeaders
        };

        if (profileId) {
            finalHeaders['Amazon-Advertising-API-Scope'] = profileId;
        }

        const response = await axios({
            method,
            url: `${ADS_API_ENDPOINT}${url}`,
            headers: finalHeaders,
            data,
            params,
        });

        return response.data;
    } catch (error) {
        console.error(`Amazon Ads API request failed for ${method.toUpperCase()} ${url}:`, error.response?.data || { message: error.message });
        const errorDetails = error.response?.data || { message: error.message };
        const status = error.response?.status || 500;
        throw { status, details: errorDetails };
    }
}