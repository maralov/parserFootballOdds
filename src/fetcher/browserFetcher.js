'use strict';

const { chromium } = require('playwright');
const { createIsolatedContext } = require('./antibot/contextFactory');
const { applyRouteBlocker } = require('./antibot/routeBlocker');
const { randomDelay } = require('./antibot/delays');
const env = require('../config/env');
const logger = require('../observability/logger');

let _browser = null;
let _browserBornAt = 0;

/**
 * Lazily launch Chromium and keep it alive until max lifetime is exceeded.
 * @returns {Promise<import('playwright').Browser>}
 */
async function getBrowser() {
  const now = Date.now();
  const tooOld = now - _browserBornAt > env.LIVE_BROWSER_MAX_LIFETIME_MS;

  if (_browser && tooOld) {
    logger.info('browserFetcher: restarting browser (max lifetime reached)');
    try { await _browser.close(); } catch (_) {}
    _browser = null;
  }

  if (!_browser) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    _browserBornAt = Date.now();
    logger.info('browserFetcher: browser launched');
  }

  return _browser;
}

/**
 * Fetch a URL using an isolated Playwright BrowserContext.
 * Each call creates a new context and closes it after extraction.
 *
 * @param {string} url
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<{ html: string, status: number, source: 'browser' }>}
 */
async function fetchBrowser(url, opts = {}) {
  const timeout = opts.timeout ?? env.LIVE_BROWSER_TIMEOUT_MS;

  const browser = await getBrowser();
  const context = await createIsolatedContext(browser);
  const page = await context.newPage();

  try {
    await applyRouteBlocker(page);

    await randomDelay(1000, 2500);

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    const status = response?.status() ?? 0;
    const html = await page.content();

    logger.debug('browserFetcher: ok', { url, status });
    return { html, status, source: 'browser' };

  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * Gracefully close the shared browser instance (call on process exit).
 */
async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

module.exports = { fetchBrowser, closeBrowser };
