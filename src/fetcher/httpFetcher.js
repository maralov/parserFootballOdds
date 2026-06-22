'use strict';

const axios = require('axios');
const { pickUserAgent } = require('../config/userAgents');
const { backoffDelay, randomDelay } = require('./antibot/delays');
const env = require('../config/env');
const logger = require('../observability/logger');

class FetchError extends Error {
  constructor(message, { status, url, attempts } = {}) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.url = url;
    this.attempts = attempts;
  }
}

/**
 * Fetch a URL using axios with UA rotation and exponential retry.
 *
 * @param {string} url
 * @param {{ maxRetries?: number, baseDelay?: number }} [opts]
 * @returns {Promise<{ html: string, status: number, source: 'http' }>}
 * @throws {FetchError} after all retries exhausted
 */
async function fetchHttp(url, opts = {}) {
  const maxRetries = opts.maxRetries ?? env.LIVE_HTTP_MAX_RETRIES;
  const baseDelay  = opts.baseDelay  ?? env.LIVE_HTTP_BASE_DELAY_MS;

  let lastErr;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await backoffDelay(attempt - 1, baseDelay);
    } else {
      await randomDelay(800, 2500);
    }

    const ua = pickUserAgent();

    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
          // Live scores must be current — never accept an intermediary-cached page.
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        timeout: 15_000,
        maxRedirects: 5,
      });

      const html = typeof res.data === 'string' ? res.data : '';

      if (res.status === 200 && html.length > 0) {
        logger.debug('httpFetcher: ok', { url, status: res.status, attempt });
        return { html, status: res.status, source: 'http' };
      }

      lastErr = new FetchError(`HTTP ${res.status} empty body`, {
        status: res.status, url, attempts: attempt + 1,
      });

    } catch (e) {
      const status = e.response?.status;
      logger.warn(`httpFetcher attempt ${attempt + 1} failed`, { url, status, err: e.message });
      lastErr = new FetchError(e.message, { status, url, attempts: attempt + 1 });

      // No point retrying on definitive blocks.
      if (status === 403 || status === 429) break;
    }
  }

  throw lastErr ?? new FetchError('unknown fetch error', { url });
}

module.exports = { fetchHttp, FetchError };
