'use strict';

const env = require('../config/env');

/**
 * Compute adaptive sleep duration based on potential sleepers (0:0 matches in 1H).
 *
 * Strategy:
 *   - Find the match closest to 45' (max minute among sleepers).
 *   - sleep = clamp((TARGET_MINUTE - nearest.minute) * 60_000, MIN, MAX)
 *   - No sleepers but candidates exist → MIN_SLEEP (quick re-check at halftime)
 *   - No sleepers and no candidates → FALLBACK_SLEEP
 *
 * @param {import('../parser/candidateSelector').PotentialSleeper[]} sleepers
 * @param {boolean} [hasCandidates]
 * @returns {{ sleepMs: number, reason: string, nearestMatch: object|null }}
 */
function computeSleep(sleepers, hasCandidates = false) {
  const {
    LIVE_MIN_SLEEP_MS: MIN,
    LIVE_MAX_SLEEP_MS: MAX,
    LIVE_FALLBACK_SLEEP_MS: FALLBACK,
    LIVE_TARGET_MINUTE: TARGET,
  } = env;

  if (sleepers.length > 0) {
    const nearest = sleepers.reduce((best, s) => (s.minute > best.minute ? s : best), sleepers[0]);
    const rawMs = (TARGET - nearest.minute) * 60_000;
    const sleepMs = Math.max(MIN, Math.min(MAX, rawMs));
    const sleepMin = Math.round(sleepMs / 60_000);
    const reason = `nearest 0:0 at ${nearest.minute}' (${nearest.homeTeam} - ${nearest.awayTeam}) → sleep ${sleepMin} min`;
    return { sleepMs, reason, nearestMatch: nearest };
  }

  if (hasCandidates) {
    return {
      sleepMs: MIN,
      reason: 'candidates at halftime, no 1H sleepers → quick re-check',
      nearestMatch: null,
    };
  }

  return {
    sleepMs: FALLBACK,
    reason: 'no 0:0 matches → fallback sleep',
    nearestMatch: null,
  };
}

module.exports = { computeSleep };
