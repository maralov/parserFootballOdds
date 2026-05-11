'use strict';

/**
 * Cumulative counters (whole-match totals from kick-off) suitable for deltas.
 * Do not mix percentage / contextual snapshot fields here — diffs would be meaningless.
 */
const CUMULATIVE_STAT_FIELDS = [
  'totalShots',
  'shotsOnTarget',
  'cornerKicks',
  'expectedGoalsXg',
  'yellowCards',
  'redCards',
  'xgOnTargetXgot',
  'bigChances',
  'shotsInsideTheBox',
  'shotsOutsideTheBox',
  'blockedShots',
  'touchesInOppositionBox',
  'expectedAssistsXa',
  'goalkeeperSaves',
  'goalsPrevented',
  'passesMade',
  'passesAttempted',
  'passesInFinalThirdMade',
  'passesInFinalThirdAttempted',
  'crossesMade',
  'crossesAttempted',
  'accurateThroughPasses',
  'freeKicks',
  'offsides',
];

/** For documentation only (not subtracted via subtractStats). */
const SNAPSHOT_ONLY_STAT_FIELDS = [
  'ballPossession',
  'passes',
  'longPasses',
  'passesInFinalThird',
  'crosses',
  'tackles',
];

/** @deprecated Prefer CUMULATIVE_STAT_FIELDS; kept for existing imports. */
const STAT_FIELDS = CUMULATIVE_STAT_FIELDS;

/**
 * Subtract two stats maps of the shape { field: { home, away } }.
 *
 * If either snapshot map is missing a field wrapper → `{ home: null, away: null }`
 * Per-side home/away: if missing on either operand → delta home/away is null.
 *
 * @param {Object|null} a  Minuend
 * @param {Object|null} b  Subtrahend
 * @returns {Object|null}
 */
function subtractStats(a, b) {
  if (!a || !b) return null;

  const result = {};
  for (const field of CUMULATIVE_STAT_FIELDS) {
    const aVal = a[field];
    const bVal = b[field];

    if (aVal == null || bVal == null) {
      result[field] = { home: null, away: null };
      continue;
    }

    result[field] = {
      home: (aVal.home != null && bVal.home != null) ? aVal.home - bVal.home : null,
      away: (aVal.away != null && bVal.away != null) ? aVal.away - bVal.away : null,
    };
  }
  return result;
}

/**
 * Flat home/away team stats → `{ field: { home, away } }` for cumulative-only fields.
 */
function buildStatsMap(homeStats, awayStats) {
  const result = {};
  for (const field of CUMULATIVE_STAT_FIELDS) {
    result[field] = {
      home: homeStats?.[field] != null ? homeStats[field] : null,
      away: awayStats?.[field] != null ? awayStats[field] : null,
    };
  }
  return result;
}

module.exports = {
  subtractStats,
  buildStatsMap,
  STAT_FIELDS,
  CUMULATIVE_STAT_FIELDS,
  SNAPSHOT_ONLY_STAT_FIELDS,
};
