'use strict';

/**
 * Determine whether a snapshot should trigger match discard.
 *
 * Rule: score is no longer 0:0 AND the current minute is below the threshold.
 * Matches that score after the threshold remain valid for prediction
 * (they represent TB 0.5 positives in the 60–75' prediction window).
 *
 * @param {{ scoreHome: number, scoreAway: number, minute: number|null }} header
 * @param {number} [discardBeforeMinute=60]
 * @returns {{ discard: boolean, reason: string|null }}
 */
function shouldDiscard(header, discardBeforeMinute = 60) {
  const { scoreHome, scoreAway, minute } = header;

  const hasGoal  = (scoreHome + scoreAway) > 0;
  const earlyMin = minute !== null && minute < discardBeforeMinute;

  if (hasGoal && earlyMin) {
    return { discard: true, reason: 'goal_before_60' };
  }

  return { discard: false, reason: null };
}

module.exports = { shouldDiscard };
