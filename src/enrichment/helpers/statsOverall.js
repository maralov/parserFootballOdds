'use strict';

/**
 * Fields where the overall is a sum of home + away (counts, xG floats, etc.)
 * For percentage fields (ballPossession, passesPct, etc.) overall = null.
 */
// Only the base field is a percentage — Made/Attempted are raw counts and get summed
const PERCENTAGE_FIELDS = new Set([
  'ballPossession',
  'passes', 'longPasses', 'passesInFinalThird',
  'crosses', 'tackles',
]);

/**
 * Float precision fields (xG, xA, etc.) — round to 2 decimals after summing.
 */
const FLOAT_FIELDS = new Set([
  'expectedGoalsXg',
  'xgOnTargetXgot',
  'expectedAssistsXa',
  'xgotFaced',
  'goalsPrevented',
]);

/**
 * Compute the "overall" stats object from home + away.
 *
 * Rules per field:
 *   - percentage fields              → null (meaningless to add)
 *   - float fields                   → home + away, rounded to 2 decimals
 *   - count fields (everything else) → home + away
 *   - if either side is null         → null
 *
 * @param {Object} home
 * @param {Object} away
 * @returns {Object}
 */
function computeOverall(home, away) {
  if (!home || !away) return {};
  const keys = new Set([...Object.keys(home), ...Object.keys(away)]);
  const overall = {};

  for (const key of keys) {
    if (PERCENTAGE_FIELDS.has(key)) {
      overall[key] = null;
      continue;
    }
    const h = home[key];
    const a = away[key];
    if (h == null || a == null) {
      overall[key] = null;
      continue;
    }
    const sum = h + a;
    overall[key] = FLOAT_FIELDS.has(key) ? Math.round(sum * 100) / 100 : sum;
  }

  return overall;
}

module.exports = { computeOverall };
