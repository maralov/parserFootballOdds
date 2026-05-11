'use strict';

const { fetchHttp, FetchError } = require('./httpFetcher');
const { fetchBrowser } = require('./browserFetcher');
const logger = require('../observability/logger');

/**
 * Fetch a URL resilently: try HTTP first, fall back to browser on failure.
 *
 * HTTP is preferred — it is ~10x faster and uses no browser RAM.
 * Browser fallback activates on network error, 403, or empty body.
 *
 * @param {string} url
 * @returns {Promise<{ html: string, status: number, source: 'http'|'browser' }>}
 * @throws {Error} if both channels fail
 */
async function fetchResilient(url) {
  try {
    return await fetchHttp(url);
  } catch (httpErr) {
    logger.warn('resilientFetcher: HTTP failed, trying browser', {
      url,
      err: httpErr.message,
      status: httpErr.status,
    });

    try {
      return await fetchBrowser(url);
    } catch (browserErr) {
      const err = new Error(
        `Both fetch channels failed. HTTP: ${httpErr.message}. Browser: ${browserErr.message}`
      );
      err.httpError = httpErr;
      err.browserError = browserErr;
      throw err;
    }
  }
}

module.exports = { fetchResilient };
