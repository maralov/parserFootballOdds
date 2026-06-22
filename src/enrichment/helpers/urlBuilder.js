'use strict';

const { FLASHSCORE_MOBI_BASE: BASE } = require('../../config/constants');

/** Summary page: /match/{id}/?s=2 */
function buildSummaryUrl(matchId) {
  return `${BASE}/match/${matchId}/?s=2`;
}

/** Statistics page: /match/{id}/?s=2&t=stats */
function buildStatsUrl(matchId) {
  return `${BASE}/match/${matchId}/?s=2&t=stats`;
}

/** Standings page: /match/{id}/?s=2&t=standings */
function buildStandingsUrl(matchId) {
  return `${BASE}/match/${matchId}/?s=2&t=standings`;
}

/** H2H page: /match/{id}/?s=2&t=h2h */
function buildH2hUrl(matchId) {
  return `${BASE}/match/${matchId}/?s=2&t=h2h`;
}

/**
 * Live stats page for Stage 3 snapshot collection.
 * Same as buildStatsUrl — alias for semantic clarity.
 */
function buildLiveStatsUrl(matchId) {
  return buildStatsUrl(matchId);
}

/**
 * Match summary page for Stage 3 final collection (incidents + score).
 */
function buildFinalSummaryUrl(matchId) {
  return buildSummaryUrl(matchId);
}

/**
 * Append a unique cache-buster query param so CDN/intermediary caches can't
 * serve a stale page. flashscore.mobi live pages are edge-cached with a short
 * TTL; without this a poll can read a score that lags the real match by 1-3 min
 * (e.g. a 0:0 returned after a goal already happened), firing a doomed signal.
 *
 * @param {string} url  a URL that already carries a query string ("...?s=2")
 * @returns {string}
 */
function withCacheBuster(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_=${Date.now()}`;
}

module.exports = {
  buildSummaryUrl,
  buildStatsUrl,
  buildStandingsUrl,
  buildH2hUrl,
  buildLiveStatsUrl,
  buildFinalSummaryUrl,
  withCacheBuster,
};
