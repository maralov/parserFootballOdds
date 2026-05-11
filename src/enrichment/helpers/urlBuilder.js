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

module.exports = {
  buildSummaryUrl,
  buildStatsUrl,
  buildStandingsUrl,
  buildH2hUrl,
  buildLiveStatsUrl,
  buildFinalSummaryUrl,
};
