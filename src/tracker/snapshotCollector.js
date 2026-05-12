'use strict';

const { fetchResilient }         = require('../fetcher/resilientFetcher');
const { randomDelay }            = require('../fetcher/antibot/delays');
const { buildLiveStatsUrl }      = require('../enrichment/helpers/urlBuilder');
const { parseLiveHeader }        = require('./parsers/liveHeaderParser');
const { parseCumulativeStats }   = require('../enrichment/parsers/matchStatsParser');
const { shouldDiscard }          = require('./discardPolicy');
const { subtractStats, buildStatsMap } = require('./deltaCalculator');
const { getSnapshotMinute, getDelayToNextSnapshotMs } = require('./snapshotCadence');
const matchStore                 = require('../store/matchStore');
const { collectFinal }           = require('./finalCollector');
const { runTm05Decision }        = require('../prediction/runTm05Decision');
const { runTb05Decision }        = require('../prediction/runTb05Decision');
const tgDispatcher               = require('../integrations/telegram/dispatcher');
const env                        = require('../config/env');
const logger                     = require('../observability/logger');
const { printEvent }             = require('../observability/display');

function matchLabel(match) {
  if (!match) return '?';
  return `${match.homeTeam || '?'} - ${match.awayTeam || '?'}`;
}

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
 * @returns {Promise<'discarded'|'stale'|'retry_scheduled'|'snapshot'|'final'>}
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
    return 'retry_scheduled';
  }

  // ── 3. Parse header (score + minute) ─────────────────────────────────────
  const header = parseLiveHeader(html);
  const { scoreHome, scoreAway, minute, statusText, isFinished, isHalftime } = header;

  // Still in halftime — reschedule and wait
  if (isHalftime || (minute !== null && minute < 45)) {
    const retrySec = Math.round(env.LIVE_TRACKER_HALFTIME_RETRY_MS / 1000);
    printEvent('tracker', matchLabel(match), `HT-retry (${statusText || 'HT'})`, {
      observedMin: minute,
      retryIn: `${retrySec}s`,
    });
    logger.info('snapshotCollector: still halftime, rescheduling', {
      matchId, statusText, observedMinute: minute, retryInSec: retrySec,
    });
    scheduleNext(matchId, env.LIVE_TRACKER_HALFTIME_RETRY_MS);
    return 'retry_scheduled';
  }

  // ── 4. Discard policy ────────────────────────────────────────────────────
  const discard = shouldDiscard(header, env.LIVE_TRACKER_DISCARD_BEFORE_MINUTE);
  if (discard.discard) {
    matchStore.markDiscarded(matchId, discard.reason, date);
    printEvent('tracker', matchLabel(match), `DISCARDED (${discard.reason})`, {
      observedMin: minute,
      score: `${scoreHome}:${scoreAway}`,
    });
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
  const snapshotMinute = isFinished ? null : getSnapshotMinute(minute);

  const snapshot = {
    minute: snapshotMinute,
    observedMinute: minute,
    capturedAt,
    statusText,
    scoreHome,
    scoreAway,
    ballPossession,
    cumulative: cumulativeMap,
    since2H,
    delta,
  };

  matchStore.appendSnapshot(matchId, snapshot, null, date);

  const shotsPart = cumulativeMap?.totalShots
    ? `shots:${cumulativeMap.totalShots.home ?? '?'}/${cumulativeMap.totalShots.away ?? '?'}`
    : 'shots:?';
  const xgHome = cumulativeMap?.expectedGoalsXg?.home;
  const xgAway = cumulativeMap?.expectedGoalsXg?.away;
  const xgPart = xgHome != null && xgAway != null ? `xG:${xgHome}/${xgAway}` : null;
  printEvent(
    'tracker',
    matchLabel(match),
    `snapshot @${snapshotMinute ?? minute}'  ${scoreHome}:${scoreAway}  ${shotsPart}`,
    {
      observedMin: minute,
      level: match.statsLevel || '?',
      ...(xgPart ? { xG: `${xgHome}/${xgAway}` } : {}),
      finished: isFinished || undefined,
    },
  );
  logger.info('snapshotCollector: snapshot stored', {
    matchId,
    minute: snapshotMinute,
    observedMinute: minute,
    score: `${scoreHome}:${scoreAway}`,
    hasStats: cumulativeMap !== null,
    isFinished,
  });

  // V4.1 decision pipeline — non-blocking, fire-and-forget.
  // TM 0.5: at first snapshot with observedMinute >= 60 (single call per match)
  if (
    !isFinished &&
    minute != null && minute >= 60 && minute <= 75 &&
    scoreHome === 0 && scoreAway === 0
  ) {
    const fresh = matchStore.getMatch(matchId, date);
    if (fresh && !fresh.predictions?.tm05) {
      setImmediate(() => {
        runTm05Decision(matchId, snapshot, date, { tgDispatcher }).catch((err) => {
          logger.warn('snapshotCollector: runTm05Decision failed', { matchId, err: err.message });
        });
      });
    }
  }

  // TB 0.5: at first snapshot with observedMinute >= 80 if still 0:0
  if (
    !isFinished &&
    minute != null && minute >= 80 && minute <= 90 &&
    scoreHome === 0 && scoreAway === 0
  ) {
    const fresh = matchStore.getMatch(matchId, date);
    if (fresh && !fresh.predictions?.tb05) {
      setImmediate(() => {
        runTb05Decision(matchId, snapshot, date, { tgDispatcher }).catch((err) => {
          logger.warn('snapshotCollector: runTb05Decision failed', { matchId, err: err.message });
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

  scheduleNext(matchId, getDelayToNextSnapshotMs(minute));
  return 'snapshot';
}

module.exports = { collectSnapshot };
