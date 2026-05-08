'use strict';

const { fetchResilient }         = require('../fetcher/resilientFetcher');
const { randomDelay }            = require('../fetcher/antibot/delays');
const { buildLiveStatsUrl }      = require('../enrichment/helpers/urlBuilder');
const { parseLiveHeader }        = require('./parsers/liveHeaderParser');
const { parseCumulativeStats }   = require('../enrichment/parsers/matchStatsParser');
const { shouldDiscard }          = require('./discardPolicy');
const { subtractStats, buildStatsMap } = require('./deltaCalculator');
const matchStore                 = require('../store/matchStore');
const { collectFinal }           = require('./finalCollector');
const { maybeRequestAI }         = require('../ai/aiOrchestrator');
const env                        = require('../config/env');
const logger                     = require('../observability/logger');

/**
 * Collect a single live snapshot for a tracked match.
 *
 * Flow:
 *  1. GET /match/{id}/?s=2&t=stats
 *  2. Parse score + minute/status from #main header
 *  3. Apply discard policy (goal before 60')
 *  4. Parse cumulative stats from feed
 *  5. Build since2H (cumulative − baseline1H) + delta (vs prev snapshot)
 *  6. Append snapshot to matchStore
 *  7. If Finished → finalCollector; else schedule next tick
 *
 * @param {string}   matchId
 * @param {Function} scheduleNext  callback(matchId, delayMs) — provided by trackingScheduler
 * @param {Date}     [date]        logging date context
 * @returns {Promise<'discarded'|'stale'|'snapshot'|'final'>}
 */
async function collectSnapshot(matchId, scheduleNext, date = new Date()) {
  await randomDelay(
    env.LIVE_ENRICHMENT_DELAY_MIN_MS,
    env.LIVE_ENRICHMENT_DELAY_MAX_MS,
  );

  // ── 1. Load current match state ────────────────────────────────────────────
  const match = matchStore.getMatch(matchId, date);
  if (!match) {
    logger.warn('snapshotCollector: match not found in store', { matchId });
    return 'stale';
  }

  if (match.tracking.status !== 'active') {
    logger.debug('snapshotCollector: match no longer active, skipping', {
      matchId, status: match.tracking.status,
    });
    return match.tracking.status;
  }

  // ── 2. Fetch stats page ────────────────────────────────────────────────────
  let html;
  try {
    const res = await fetchResilient(buildLiveStatsUrl(matchId));
    html = res.html;
  } catch (err) {
    logger.warn('snapshotCollector: fetch failed', { matchId, err: err.message });
    matchStore.recordFailure(matchId, env.LIVE_TRACKER_MAX_FAILURES, date);
    const updated = matchStore.getMatch(matchId, date);
    if (updated?.tracking?.status === 'stale') return 'stale';
    scheduleNext(matchId, env.LIVE_TRACKER_HALFTIME_RETRY_MS);
    return 'stale';
  }

  // ── 3. Parse header (score + minute) ─────────────────────────────────────
  const header = parseLiveHeader(html);
  const { scoreHome, scoreAway, minute, statusText, isFinished, isHalftime } = header;

  // Still in halftime — reschedule and wait
  if (isHalftime || (minute !== null && minute < 45)) {
    logger.debug('snapshotCollector: still halftime, rescheduling', { matchId, statusText });
    scheduleNext(matchId, env.LIVE_TRACKER_HALFTIME_RETRY_MS);
    return 'snapshot';
  }

  // ── 4. Discard policy ────────────────────────────────────────────────────
  const discard = shouldDiscard(header, env.LIVE_TRACKER_DISCARD_BEFORE_MINUTE);
  if (discard.discard) {
    matchStore.markDiscarded(matchId, discard.reason, date);
    logger.info('snapshotCollector: discarded', { matchId, minute, score: `${scoreHome}:${scoreAway}` });
    return 'discarded';
  }

  // ── 5. Parse cumulative stats ─────────────────────────────────────────────
  const cumulativeRaw = parseCumulativeStats(html);
  let cumulativeMap = null;
  let since2H = null;
  let delta = null;
  let ballPossession = null;

  if (cumulativeRaw) {
    // Build { field: { home, away } } map (excludes possession)
    cumulativeMap = buildStatsMap(cumulativeRaw.home, cumulativeRaw.away);

    // since2H = cumulative − baseline1H
    since2H = subtractStats(cumulativeMap, match.baseline1H);

    // delta = cumulative − previous snapshot's cumulative
    const lastSnapshot = matchStore.getLastSnapshot(matchId, date);
    if (lastSnapshot?.cumulative) {
      delta = subtractStats(cumulativeMap, lastSnapshot.cumulative);
    }

    // Possession is a current % value — not cumulative, keep separately
    if (cumulativeRaw.home?.ballPossession != null) {
      ballPossession = {
        home: cumulativeRaw.home.ballPossession,
        away: cumulativeRaw.away?.ballPossession ?? null,
      };
    }
  }

  // ── 6. Build and store snapshot ───────────────────────────────────────────
  const capturedAt = new Date().toISOString();
  const nextAt = isFinished
    ? null
    : new Date(Date.now() + env.LIVE_TRACKER_INTERVAL_MS + _jitter()).toISOString();

  const snapshot = {
    minute,
    capturedAt,
    statusText,
    scoreHome,
    scoreAway,
    ballPossession,
    cumulative: cumulativeMap,
    since2H,
    delta,
  };

  matchStore.appendSnapshot(matchId, snapshot, nextAt, date);

  logger.debug('snapshotCollector: snapshot stored', {
    matchId, minute, score: `${scoreHome}:${scoreAway}`, isFinished,
  });

  // Stage 4 — AI checkpoints run in parallel and never block live tracking.
  if (env.LIVE_AI_ENABLED) {
    const freshMatch = matchStore.getMatch(matchId, date);
    if (freshMatch) {
      maybeRequestAI(matchId, header, freshMatch, date).catch(err => {
        logger.warn('snapshotCollector: AI checkpoint failed', {
          matchId,
          err: err.message,
        });
      });
    }
  }

  // ── 7. Final or next tick ─────────────────────────────────────────────────
  if (isFinished) {
    try {
      await collectFinal(matchId, date);
    } catch (err) {
      logger.error('snapshotCollector: finalCollector failed', { matchId, err: err.message });
      matchStore.markStale(matchId, 'final_collect_failed', date);
    }
    return 'final';
  }

  // Hard timeout: if discoveredAt + 120min is exceeded, mark stale
  if (match.discoveredAt) {
    const hardTimeoutAt = new Date(match.discoveredAt).getTime() + env.LIVE_TRACKER_HARD_TIMEOUT_MS;
    if (Date.now() > hardTimeoutAt) {
      matchStore.markStale(matchId, 'hard_timeout', date);
      logger.warn('snapshotCollector: hard timeout', { matchId });
      return 'stale';
    }
  }

  scheduleNext(matchId, env.LIVE_TRACKER_INTERVAL_MS);
  return 'snapshot';
}

function _jitter() {
  const jitter = env.LIVE_TRACKER_JITTER_MS || 15_000;
  return Math.floor(Math.random() * jitter * 2) - jitter;
}

module.exports = { collectSnapshot };
