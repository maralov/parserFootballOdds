'use strict';

const { fetchResilient }       = require('../fetcher/resilientFetcher');
const { randomDelay }          = require('../fetcher/antibot/delays');
const { buildLiveStatsUrl, withCacheBuster } = require('../enrichment/helpers/urlBuilder');
const { parseLiveHeader }      = require('./parsers/liveHeaderParser');
const { parseCumulativeStats } = require('../enrichment/parsers/matchStatsParser');
const { buildStatsMap }        = require('./deltaCalculator');
const {
  SNAPSHOT_START_MINUTE_1H,
  SNAPSHOT_END_MINUTE_1H,
  getSnapshotMinute1H,
  getDelayToNextSnapshotMs1H,
} = require('./snapshotCadence1H');
const matchStore               = require('../store/matchStore');
const { runTm05_1hDecision }   = require('../prediction/runTm05_1hDecision');
const { runOneH_AiDecision }   = require('../prediction/runOneH_AiDecision');
const { isLockedPhase }        = require('../prediction/lockPolicy');
const tgDispatcher             = require('../integrations/telegram/dispatcher');
const env                      = require('../config/env');
const logger                   = require('../observability/logger');
const { printEvent }           = require('../observability/display');

function matchLabel(match) {
  if (!match) return '?';
  return `${match.homeTeam || '?'} - ${match.awayTeam || '?'}`;
}

/**
 * Settle the 1HUNDER bet at (or before) the break: record the HT outcome on
 * every tracked 1H match for later calibration, and reply HIT/MISS in Telegram
 * for matches that actually signalled (dispatchOneHResult is a no-op otherwise).
 *
 * @param {string} matchId
 * @param {Object} match
 * @param {number} scoreHome
 * @param {number} scoreAway
 * @param {number|null} firstGoalMinute
 * @param {Date} date
 */
async function resolveOneH(matchId, match, scoreHome, scoreAway, firstGoalMinute, date) {
  const dry = (scoreHome + scoreAway) === 0;
  const htOutcome = {
    score: `${scoreHome}:${scoreAway}`,
    dry,
    firstGoalMinute: firstGoalMinute ?? null,
    resolvedAt: new Date().toISOString(),
  };
  matchStore.setTm05_1hDecision(matchId, { htOutcome }, date);

  // Also record outcome on tb05_1h if it exists (both get labeled for analysis)
  const currentMatch = matchStore.getMatch(matchId, date);
  if (currentMatch?.predictions?.tb05_1h != null) {
    matchStore.setTb05_1hDecision(matchId, { htOutcome }, date);
  }

  printEvent('1hunder', matchLabel(match), `RESULT ${dry ? 'HIT' : 'MISS'} ${scoreHome}:${scoreAway}`, {});

  if (!env.LIVE_1H_TG_ENABLED) return;
  try {
    await tgDispatcher.dispatchOneHResult({
      matchId,
      htScoreHome: scoreHome,
      htScoreAway: scoreAway,
      firstGoalMinute: firstGoalMinute ?? null,
      date,
      decisionKey: 'tm05_1h',
    });
    await tgDispatcher.dispatchOneHResult({
      matchId,
      htScoreHome: scoreHome,
      htScoreAway: scoreAway,
      firstGoalMinute: firstGoalMinute ?? null,
      date,
      decisionKey: 'tb05_1h',
    });
  } catch (err) {
    logger.warn('snapshotCollector1H: 1H result dispatch failed', { matchId, err: err.message });
  }
}

/**
 * Collect one first-half snapshot for a 1HUNDER-tracked match.
 *
 * Lifecycle within the first half:
 *  - minute < 20  → too early, reschedule to the 20' bucket
 *  - goal (score ≠ 0:0) → discard (kills both 1H and full-match lines)
 *  - halftime OR minute > 35 → hand off; the 2H scheduler takes over at 45'
 *  - otherwise → store snapshot, run decision in 25–35', reschedule next tick
 *
 * @param {string}   matchId
 * @param {Function} scheduleNext  callback(matchId, delayMs)
 * @param {Date}     [date]
 * @returns {Promise<'too_early'|'discarded'|'handoff_2h'|'retry_scheduled'|'snapshot'|'stale'>}
 */
async function collectSnapshot1H(matchId, scheduleNext, date = new Date()) {
  await randomDelay(env.LIVE_ENRICHMENT_DELAY_MIN_MS, env.LIVE_ENRICHMENT_DELAY_MAX_MS);

  const match = matchStore.getMatch(matchId, date);
  if (!match) {
    logger.warn('snapshotCollector1H: match not found', { matchId });
    return 'stale';
  }
  if (match.tracking.status !== 'active') return match.tracking.status;

  // Fetch live stats page
  let html;
  try {
    const res = await fetchResilient(withCacheBuster(buildLiveStatsUrl(matchId)));
    html = res.html;
  } catch (err) {
    logger.warn('snapshotCollector1H: fetch failed', { matchId, err: err.message });
    matchStore.recordFailure(matchId, env.LIVE_TRACKER_MAX_FAILURES, date);
    const updated = matchStore.getMatch(matchId, date);
    if (updated?.tracking?.status === 'stale') return 'stale';
    scheduleNext(matchId, env.LIVE_1H_POLL_MS);
    return 'retry_scheduled';
  }

  const header = parseLiveHeader(html);
  const {
    scoreHome, scoreAway, minute, statusText,
    isFinished, isHalftime, isSecondHalf, isFirstHalfStoppage, htScore,
  } = header;

  // We're still in the first half (including stoppage) unless an explicit
  // halftime / 2nd-half / finished marker is set. This is the authoritative
  // gate for both goal-discard and HT settlement — never minute >= 45.
  const inFirstHalf = !isHalftime && !isSecondHalf && !isFinished;

  // Goal during the first half (including 45+ stoppage) → MISS.
  if ((scoreHome + scoreAway) > 0 && inFirstHalf) {
    matchStore.markDiscarded(matchId, 'goal_before_halftime', date);
    const fresh = matchStore.getMatch(matchId, date);
    if (fresh && !isLockedPhase(fresh.predictions?.tm05_1h?.phase)) {
      matchStore.setTm05_1hDecision(matchId, {
        phase: 'goal_during_decision',
        decidedAt: new Date().toISOString(),
      }, date);
    }
    printEvent('1hunder', matchLabel(match), `DISCARDED goal@${minute ?? '?'}'`, {
      score: `${scoreHome}:${scoreAway}`,
    });
    if (env.LIVE_1H_ONLY) {
      const fgm = fresh?.tracking?.firstGoalMinute ?? minute ?? null;
      await resolveOneH(matchId, match, scoreHome, scoreAway, fgm, date);
    }
    return 'discarded';
  }

  // Halftime / 2nd half / finished → settle the first-half bet using the HT
  // score from the parenthetical when available; otherwise fall back to the
  // current score (safe at true HT; best-effort during 2nd half or finished).
  if (isHalftime || isSecondHalf || isFinished) {
    if (env.LIVE_1H_ONLY) {
      let htHome = scoreHome;
      let htAway = scoreAway;
      if (htScore) {
        htHome = htScore.home;
        htAway = htScore.away;
      } else if (!isHalftime) {
        // No parenthetical and we're past true HT → trust our own goal tracking.
        const fgm = match?.tracking?.firstGoalMinute;
        if (fgm == null || fgm > 45) {
          htHome = 0;
          htAway = 0;
        }
        logger.warn('snapshotCollector1H: settling post-HT without parenthetical', {
          matchId, statusText, score: `${scoreHome}:${scoreAway}`, firstGoalMinute: fgm ?? null,
        });
      }
      const fgm = match?.tracking?.firstGoalMinute ?? null;
      await resolveOneH(matchId, match, htHome, htAway, fgm, date);
      logger.info('snapshotCollector1H: resolved at halftime', {
        matchId, statusText, htScore: `${htHome}:${htAway}`,
      });
      return 'resolved_1h';
    }
    logger.info('snapshotCollector1H: handoff to 2H track', { matchId, minute, statusText });
    return 'handoff_2h';
  }

  // First-half stoppage (45+X') — poll fast so we don't miss the true HT tick.
  if (isFirstHalfStoppage || (minute != null && minute >= 45 && inFirstHalf)) {
    scheduleNext(matchId, Math.min(env.LIVE_1H_POLL_MS, 20_000));
    return 'snapshot';
  }

  // Too early (kickoff lag) — wait for the 20' bucket.
  if (minute == null || minute < SNAPSHOT_START_MINUTE_1H) {
    const waitMs = minute == null
      ? env.LIVE_1H_POLL_MS
      : Math.max(0, (SNAPSHOT_START_MINUTE_1H - minute) * 60_000);
    scheduleNext(matchId, waitMs);
    return 'retry_scheduled';
  }

  // Parse cumulative stats + possession
  const cumulativeRaw = parseCumulativeStats(html);
  let cumulativeMap = null;
  let ballPossession = null;
  if (cumulativeRaw) {
    cumulativeMap = buildStatsMap(cumulativeRaw.home, cumulativeRaw.away);
    if (cumulativeRaw.home?.ballPossession != null) {
      ballPossession = {
        home: cumulativeRaw.home.ballPossession,
        away: cumulativeRaw.away?.ballPossession ?? null,
      };
    }
  }

  const snapshot = {
    phase: '1H',
    minute: getSnapshotMinute1H(minute),
    observedMinute: minute,
    capturedAt: new Date().toISOString(),
    statusText,
    scoreHome,
    scoreAway,
    ballPossession,
    cumulative: cumulativeMap,
  };

  matchStore.appendSnapshot(matchId, snapshot, null, date);

  const xgHome = cumulativeMap?.expectedGoalsXg?.home;
  const xgAway = cumulativeMap?.expectedGoalsXg?.away;
  printEvent('1hunder', matchLabel(match), `snapshot @${snapshot.minute}'  ${scoreHome}:${scoreAway}`, {
    observedMin: minute,
    ...(xgHome != null ? { xG: `${xgHome}/${xgAway}` } : {}),
  });

  // Decision: first snapshot in the 25–35' window while still 0:0.
  if (
    minute >= env.LIVE_1H_DECISION_MIN && minute <= env.LIVE_1H_DECISION_MAX &&
    scoreHome === 0 && scoreAway === 0
  ) {
    const fresh = matchStore.getMatch(matchId, date);
    // Block if either direction's key is locked or pending AI call
    const tm05Phase = fresh?.predictions?.tm05_1h?.phase;
    const tb05Phase = fresh?.predictions?.tb05_1h?.phase;
    const alreadyDecided = isLockedPhase(tm05Phase) || isLockedPhase(tb05Phase)
      || tm05Phase === 'ai_pending' || tb05Phase === 'ai_pending';
    if (fresh && !alreadyDecided) {
      setImmediate(() => {
        if (env.LIVE_1H_AI_ENABLED) {
          runOneH_AiDecision(matchId, snapshot, date, { tgDispatcher }).catch((err) => {
            logger.warn('snapshotCollector1H: runOneH_AiDecision failed', { matchId, err: err.message });
          });
        } else {
          runTm05_1hDecision(matchId, snapshot, date, { tgDispatcher }).catch((err) => {
            logger.warn('snapshotCollector1H: runTm05_1hDecision failed', { matchId, err: err.message });
          });
        }
      });
    }
  }

  // Past the decision window (35'+) but not yet halftime.
  if (minute >= SNAPSHOT_END_MINUTE_1H) {
    if (env.LIVE_1H_ONLY) {
      // Keep a light watch until the break so we can settle the bet at HT.
      scheduleNext(matchId, env.LIVE_1H_POLL_MS);
      return 'snapshot';
    }
    // Combined mode: stop 1H polling; the 2H scheduler resumes at halftime.
    return 'handoff_2h';
  }

  scheduleNext(matchId, getDelayToNextSnapshotMs1H(minute));
  return 'snapshot';
}

module.exports = { collectSnapshot1H };
