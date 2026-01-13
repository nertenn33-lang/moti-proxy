/**
 * RevenueCat Service
 * Server-side premium verification using RevenueCat API
 */

const axios = require('axios');

// Entitlement identifier for premium subscription
const ENTITLEMENT_ID = 'premium';

// Cache for subscriber data (appUserId -> { data, timestamp })
const subscriberCache = new Map();

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get RevenueCat subscriber data
 * @param {string} appUserId - RevenueCat app user ID
 * @returns {Promise<Object|null>} Subscriber data or null if not found/failed
 */
async function getSubscriber(appUserId) {
  const cacheKey = appUserId;
  const cached = subscriberCache.get(cacheKey);
  
  // Check cache
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      return cached.data;
    }
    // Expired, remove from cache
    subscriberCache.delete(cacheKey);
  }
  
  // Call RevenueCat API
  const apiKey = process.env.REVENUECAT_SECRET_KEY;
  if (!apiKey) {
    console.warn(`[RC] RevenueCat API key not configured`);
    return null;
  }
  
  try {
    const response = await axios.get(
      `https://api.revenuecat.com/v1/subscribers/${appUserId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000, // 5 second timeout
      }
    );
    
    const subscriberData = response.data?.subscriber || null;
    
    // Cache the result
    if (subscriberData) {
      subscriberCache.set(cacheKey, {
        data: subscriberData,
        timestamp: Date.now(),
      });
    }
    
    return subscriberData;
  } catch (error) {
    // Fail-safe: log error but don't throw
    const status = error?.response?.status || 'unknown';
    console.error(`[RC] Error fetching subscriber ${appUserId}: [${status}] ${error.message}`);
    return null;
  }
}

/**
 * Check if user has premium subscription
 * @param {string} appUserId - RevenueCat app user ID
 * @returns {Promise<boolean>} True if user has premium, false otherwise
 */
async function isUserPremium(appUserId) {
  // Dev flag: Force premium for testing (set REVENUECAT_DEV_FORCE_PREMIUM=true)
  if (process.env.REVENUECAT_DEV_FORCE_PREMIUM === 'true') {
    console.log(`[RC] userId=${appUserId} premium=true cache=dev_forced`);
    return true;
  }
  
  const cacheKey = appUserId;
  const cached = subscriberCache.get(cacheKey);
  let cacheHit = false;
  let subscriberData = null;
  
  // Check cache first
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      subscriberData = cached.data;
      cacheHit = true;
    } else {
      subscriberCache.delete(cacheKey);
    }
  }
  
  // If not cached, fetch from RevenueCat
  if (!subscriberData) {
    subscriberData = await getSubscriber(appUserId);
  }
  
  // Check if user has premium entitlement
  const isPremium = subscriberData?.entitlements?.active?.[ENTITLEMENT_ID] !== undefined;
  
  // Log once per request
  console.log(`[RC] userId=${appUserId} premium=${isPremium} cache=${cacheHit ? 'hit' : 'miss'}`);
  
  return isPremium;
}

module.exports = {
  getSubscriber,
  isUserPremium,
  ENTITLEMENT_ID,
};

