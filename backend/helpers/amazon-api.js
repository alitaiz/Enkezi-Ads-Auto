// backend/helpers/amazon-api.js
import axios from 'axios';
import https from 'https';
import { URLSearchParams } from 'url';
import crypto from 'crypto';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const ADS_API_ENDPOINT = 'https://advertising-api.amazon.com';

// Simple in-memory cache for the access token to avoid excessive refreshes.
let adsApiTokenCache = {
    token: null,
    expiresAt: 0,
};

/**
 * Creates an HMAC-SHA256 signature for SBv4 API requests.
 * @param {string} secretKey - The secret key for signing.
 * @param {string} stringToSign - The canonical request string.
 * @returns {string} The hexadecimal signature.
 */
const createHmacSignature = (secretKey, stringToSign) => {
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(stringToSign, 'utf8');
    return hmac.digest('hex');
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

        const response = await axios.post(LWA_TOKEN_URL, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        });

        const responseData = response.data;
        if (!responseData || typeof responseData.access_token !== 'string' || responseData.access_token.trim() === '') {
            console.error('[Auth] Invalid token response from Amazon LWA:', responseData);
            throw new Error('Failed to retrieve a valid access_token from Amazon LWA. The response was malformed.');
        }
        
        const accessToken = responseData.access_token.trim();
        
        adsApiTokenCache = {
            token: accessToken,
            expiresAt: Date.now() + 55 * 60 * 1000,
        };

        console.log("[Auth] Successfully obtained and cached new Amazon Ads API access token.");
        return adsApiTokenCache.token;

    } catch (error) {
        adsApiTokenCache = { token: null, expiresAt: 0 };
        const errorMessage = error.response?.data?.error_description || error.response?.data?.message || error.message;
        console.error("[Auth] Error refreshing Amazon Ads API access token:", errorMessage);
        throw new Error(`Could not refresh Amazon Ads API access token: ${errorMessage}. Please check your credentials.`);
    }
}

/**
 * A wrapper for making authenticated requests to the Amazon Ads API.
 * It now intelligently switches between Bearer token and HMAC-SHA256 signature auth.
 */
export async function amazonAdsApiRequest({ method, url, profileId, data, params, headers = {} }) {
    try {
        const finalHeaders = {
            'Amazon-Advertising-API-ClientId': process.env.ADS_API_CLIENT_ID,
            ...headers
        };
        
        if (profileId) {
            finalHeaders['Amazon-Advertising-API-Scope'] = profileId;
        }

        // --- DYNAMIC AUTHENTICATION LOGIC ---
        // Check if the URL matches the patterns requiring HMAC signature authentication.
        const requiresHmac = url.startsWith('/sb/v4/') || url.startsWith('/portfolios');

        if (requiresHmac) {
            // Use HMAC Signature for Sponsored Brands v4 and Portfolios
            const { ADS_API_ACCESS_KEY, ADS_API_SECRET_KEY } = process.env;
            if (!ADS_API_ACCESS_KEY || !ADS_API_SECRET_KEY) {
                throw new Error('Missing ADS_API_ACCESS_KEY or ADS_API_SECRET_KEY in .env for HMAC request.');
            }
            
            // The host header is required for the signature.
            const host = new URL(ADS_API_ENDPOINT).hostname;
            finalHeaders['Host'] = host;

            // The 'X-Amz-Date' header is required. Format: YYYYMMDD'T'HHMMSS'Z'.
            const timestamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
            finalHeaders['X-Amz-Date'] = timestamp;
            
            // Headers must be included in the 'SignedHeaders' list, sorted alphabetically.
            const signedHeaders = 'host;x-amz-date';

            const requestBody = data ? JSON.stringify(data) : '';
            const stringToSign = `${timestamp}\n${method.toUpperCase()}\n${url}\n${requestBody}`;
            
            const signature = createHmacSignature(ADS_API_SECRET_KEY, stringToSign);
            
            // Construct the final Authorization header with the corrected SignedHeaders.
            finalHeaders['Authorization'] = `AMZ-ADS-HMAC-SHA256-20220101 Credential=${ADS_API_ACCESS_KEY}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        } else {
            // Use Bearer Token for all other APIs (SP, SD, etc.)
            const accessToken = await getAdsApiAccessToken();
            if (!accessToken) {
                throw new Error("Cannot make API request: failed to obtain a valid access token.");
            }
            finalHeaders['Authorization'] = `Bearer ${accessToken}`;
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
