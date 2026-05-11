'use strict';

const { FLASHSCORE_MOBI_BASE } = require('../../config/constants');

const MATCH_ID_RE = /\/match\/([A-Za-z0-9]+)/;

/**
 * Convert any flashscore match URL to canonical flashscore.mobi format.
 * flashscore.com/match/ID → https://www.flashscore.mobi/match/ID/
 * flashscore.mobi/match/ID → https://www.flashscore.mobi/match/ID/
 */
function flashscoreToMobi(url) {
  if (!url) return null;
  const m = url.match(MATCH_ID_RE);
  if (!m) return null;
  return `${FLASHSCORE_MOBI_BASE}/match/${m[1]}/`;
}

module.exports = { flashscoreToMobi };
