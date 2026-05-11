'use strict';

const MATCH_ID_RE = /\/match\/([A-Za-z0-9]+)\//;

/**
 * Extract matchId from a Flashscore match href.
 * "/match/Sh1Xq0bL/?s=2" → "Sh1Xq0bL"
 *
 * @param {string} href
 * @returns {string|null}
 */
function extractMatchId(href) {
  if (!href) return null;
  const m = String(href).match(MATCH_ID_RE);
  return m ? m[1] : null;
}

module.exports = { extractMatchId };
