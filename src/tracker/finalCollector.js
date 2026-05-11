'use strict';

const { fetchResilient }       = require('../fetcher/resilientFetcher');
const { randomDelay }          = require('../fetcher/antibot/delays');
const { buildFinalSummaryUrl } = require('../enrichment/helpers/urlBuilder');
const { parseLiveHeader }      = require('./parsers/liveHeaderParser');
const { parseIncidents }       = require('./parsers/incidentParser');
const { computeDerived }       = require('./derivedFields');
const matchStore               = require('../store/matchStore');
const env                      = require('../config/env');
const logger                   = require('../observability/logger');

/**
 * Collect final result for a finished match.
 *
 * GET /match/{id}/?s=2  (summary page):
 *  - Parse #main header for final score sanity check
 *  - Parse #detail-tab-content for 2nd Half score + goal incidents
 *  - Compute final result fields (firstGoalMinute, goalsAfter60/75, resultTM05/TB05)
 *  - Compute derived fields (marketSignal, tableSignal, ...)
 *  - Call matchStore.finalize()
 *
 * Note: For our candidates 1st Half is always 0:0, so final score = 2nd Half score.
 *
 * @param {string} matchId
 * @param {Date}   [date]
 */
async function collectFinal(matchId, date = new Date()) {
  await randomDelay(
    env.LIVE_ENRICHMENT_DELAY_MIN_MS,
    env.LIVE_ENRICHMENT_DELAY_MAX_MS,
  );

  const match = matchStore.getMatch(matchId, date);
  if (!match) {
    logger.warn('finalCollector: match not found', { matchId });
    return;
  }

  // ── Fetch summary page ────────────────────────────────────────────────────
  let html;
  try {
    const res = await fetchResilient(buildFinalSummaryUrl(matchId));
    html = res.html;
  } catch (err) {
    logger.error('finalCollector: fetch failed', { matchId, err: err.message });
    matchStore.markStale(matchId, 'final_fetch_failed', date);
    return;
  }

  // ── Parse header for final score ──────────────────────────────────────────
  const header = parseLiveHeader(html);

  // ── Parse incidents for goals ─────────────────────────────────────────────
  const incidents = parseIncidents(html, match.homeTeam, match.awayTeam);

  // Final score: 1H always 0:0 for our candidates + 2H score
  const scoreHome = incidents.secondHalfScore.home;
  const scoreAway = incidents.secondHalfScore.away;

  // Fallback: use header score if incidents parsing returned 0:0 but header says otherwise
  const finalHome = (scoreHome + scoreAway) === 0 && (header.scoreHome + header.scoreAway) > 0
    ? header.scoreHome : scoreHome;
  const finalAway = (scoreHome + scoreAway) === 0 && (header.scoreHome + header.scoreAway) > 0
    ? header.scoreAway : scoreAway;

  const totalGoals = finalHome + finalAway;

  // ── Derive goal timing fields ─────────────────────────────────────────────
  const goals = incidents.goals;

  // first goal minute (only regular time goals: !isExtraTime)
  const regularGoals = goals.filter(g => !g.isExtraTime);
  const firstGoalMinute = regularGoals.length > 0
    ? Math.min(...regularGoals.map(g => g.minute))
    : null;

  // goals scored after given minutes (regular time only)
  const goalsAfter60 = regularGoals.filter(g => g.minute > 60).length;
  const goalsAfter75 = regularGoals.filter(g => g.minute > 75).length;
  const goalsAfter80 = regularGoals.filter(g => g.minute > 80).length;

  const final = {
    scoreHome: finalHome,
    scoreAway: finalAway,
    totalGoals,
    resultTM05: totalGoals === 0,
    resultTB05: totalGoals > 0,
    firstGoalMinute,
    goalsAfter60,
    goalsAfter75,
    goalsAfter80,
    goals: goals.map(g => ({
      minute:      g.minute,
      extraMinutes: g.extraMinutes,
      team:        g.team,
      isExtraTime: g.isExtraTime,
    })),
    finishedAt: new Date().toISOString(),
  };

  // ── Compute derived (uses full match record) ──────────────────────────────
  const freshMatch = matchStore.getMatch(matchId, date);
  const derived = computeDerived(freshMatch || match);

  // ── Persist ───────────────────────────────────────────────────────────────
  matchStore.finalize(matchId, final, derived, date);

  logger.info('finalCollector: finalized', {
    matchId,
    score:  `${finalHome}:${finalAway}`,
    goals:  totalGoals,
    TM05:   final.resultTM05,
    TB05:   final.resultTB05,
    firstGoalMinute,
  });
}

module.exports = { collectFinal };
