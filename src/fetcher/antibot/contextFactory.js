'use strict';

const { pickUserAgent, pickViewport } = require('../../config/userAgents');

/**
 * Create a new isolated BrowserContext with randomized fingerprint.
 * Each context is independent — no shared cookies, storage, or cache.
 *
 * @param {import('playwright').Browser} browser
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function createIsolatedContext(browser) {
  const ua = pickUserAgent();
  const viewport = pickViewport();

  const context = await browser.newContext({
    userAgent: ua,
    viewport,
    locale: 'en-US',
    timezoneId: 'Europe/Kyiv',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Referer': 'https://www.google.com/',
    },
  });

  // Mask automation signals on every new page inside this context.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  return context;
}

module.exports = { createIsolatedContext };
