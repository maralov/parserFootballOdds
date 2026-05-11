'use strict';

/**
 * Detailed stats indicators — at least one of these must be present
 * to classify the stats level as "detailed".
 */
const DETAILED_MARKERS = new Set([
  'expectedGoalsXg',
  'bigChances',
  'touchesInOppositionBox',
  'shotsInsideTheBox',
  'xgOnTargetXgot',
]);

/**
 * Detect stats level from a flat stats object.
 * Returns 'detailed' if any extended stat is non-null, otherwise 'basic'.
 *
 * @param {Object} statsObj  flat StatsTeam object (home or away)
 * @returns {'detailed'|'basic'}
 */
function detectStatsLevel(statsObj) {
  if (!statsObj) return 'basic';
  for (const marker of DETAILED_MARKERS) {
    if (statsObj[marker] != null) return 'detailed';
  }
  return 'basic';
}

module.exports = { detectStatsLevel };
