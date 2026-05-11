'use strict';

/**
 * Percentage fields — their primary value is the percentage (0..100).
 * We also extract made/attempted from the "(N/M)" suffix when available.
 */
const PCT_FIELDS = new Set([
  'ballPossession',
  'passes', 'longPasses', 'passesInFinalThird', 'crosses', 'tackles',
]);

/**
 * Parse a stat value string into a typed result.
 *
 * Supported formats:
 *   "5"            → { value: 5 }
 *   "0.39"         → { value: 0.39 }
 *   "31%"          → { value: 31, pct: true }
 *   "71% (121/170)"→ { value: 71, pct: true, made: 121, attempted: 170 }
 *   "—" / "" / "-" → { value: null }
 *
 * @param {string} str
 * @returns {{ value: number|null, pct?: boolean, made?: number, attempted?: number }}
 */
function parseStatsValue(str) {
  if (!str) return { value: null };
  const s = str.trim();
  if (!s || s === '—' || s === '-' || s === 'N/A') return { value: null };

  // "71% (121/170)"
  const pctFraction = s.match(/^(\d+(?:\.\d+)?)%\s*\((\d+)\/(\d+)\)$/);
  if (pctFraction) {
    return {
      value: Number(pctFraction[1]),
      pct: true,
      made: Number(pctFraction[2]),
      attempted: Number(pctFraction[3]),
    };
  }

  // "31%"
  const pctOnly = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (pctOnly) {
    return { value: Number(pctOnly[1]), pct: true };
  }

  // plain number
  const num = Number(s);
  if (!Number.isNaN(num)) return { value: num };

  return { value: null };
}

/**
 * Apply parsed value(s) onto a stats object for a given field key.
 * Handles percentage (pct), fraction (made/attempted), and plain values.
 *
 * @param {Object} statsObj  mutable stats object to write into
 * @param {string} key       camelCase field key
 * @param {string} rawValue  raw string from feed/DOM
 */
function applyStatsValue(statsObj, key, rawValue) {
  const parsed = parseStatsValue(rawValue);
  if (parsed.pct) {
    statsObj[key] = parsed.value; // percentage number (e.g. 71)
    if (parsed.made !== undefined) {
      statsObj[`${key}Made`]      = parsed.made;
      statsObj[`${key}Attempted`] = parsed.attempted;
    }
  } else {
    statsObj[key] = parsed.value;
  }
}

module.exports = { parseStatsValue, applyStatsValue };
