'use strict';

const BLOCKED_TYPES = new Set([
  'image',
  'font',
  'media',
  'stylesheet',
  'beacon',
  'ping',
  'websocket',
]);

// URL fragments that indicate analytics / ads — always block regardless of resource type.
const BLOCKED_URL_PATTERNS = [
  'google-analytics',
  'googletagmanager',
  'doubleclick',
  'facebook.net',
  'scoreboard.res',
  'cdn.flashscore',  // static assets CDN (logos, flags)
  'static.flashscore',
];

/**
 * Attach a Playwright route handler that aborts unwanted resources.
 * Call this once on a new page before navigation.
 *
 * @param {import('playwright').Page} page
 */
async function applyRouteBlocker(page) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    const blockedByType = BLOCKED_TYPES.has(type);
    const blockedByUrl = BLOCKED_URL_PATTERNS.some((p) => url.includes(p));

    if (blockedByType || blockedByUrl) {
      route.abort();
    } else {
      route.continue();
    }
  });
}

module.exports = { applyRouteBlocker };
