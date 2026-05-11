'use strict';

/**
 * Clamp a value to [min, max].
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Safely round to N decimal places.
 */
function round(v, n = 4) {
  if (v == null) return null;
  return Math.round(v * 10 ** n) / 10 ** n;
}

/**
 * Compute clean probabilities (margin-removed) from 1x2 odds.
 * Returns null for each field if odds are unavailable.
 *
 * @param {{ home: number, draw: number, away: number }|null} odds
 * @returns {{ p1Clean: number|null, pXClean: number|null, p2Clean: number|null }}
 */
function computeCleanProbs(odds) {
  if (!odds || !odds.home || !odds.draw || !odds.away) {
    return { p1Clean: null, pXClean: null, p2Clean: null };
  }
  const margin = 1 / odds.home + 1 / odds.draw + 1 / odds.away;
  return {
    p1Clean: round((1 / odds.home) / margin),
    pXClean: round((1 / odds.draw) / margin),
    p2Clean: round((1 / odds.away) / margin),
  };
}

/**
 * Market signal: p1_clean - p2_clean, clipped to [-1, +1].
 * Positive → home favored; negative → away favored.
 *
 * @param {number|null} p1Clean
 * @param {number|null} p2Clean
 * @returns {number|null}
 */
function computeMarketSignal(p1Clean, p2Clean) {
  if (p1Clean == null || p2Clean == null) return null;
  return round(clamp(p1Clean - p2Clean, -1, 1));
}

/**
 * Table signal from standings PPG difference.
 * tableSignal = clip( (home_ppg_home - away_ppg_away) / 2.0, -1, +1 )
 * where ppg = pts / mp.
 *
 * @param {{ home: { pts, mp }, away: { pts, mp } }|null} standings
 * @returns {number|null}
 */
function computeTableSignal(standings) {
  if (!standings) return null;
  const h = standings.home;
  const a = standings.away;
  if (!h || !a || !h.mp || !a.mp) return null;

  const homePpg = h.pts / h.mp;
  const awayPpg = a.pts / a.mp;
  const diff    = homePpg - awayPpg;
  return round(clamp(diff / 2.0, -1, 1));
}

/**
 * Compute all derived fields for a finished match.
 * Called once in finalCollector after the final result is known.
 *
 * @param {Object} match  Full match record from matchStore
 * @returns {{
 *   p1Clean: number|null,
 *   pXClean: number|null,
 *   p2Clean: number|null,
 *   marketSignal: number|null,
 *   tableSignal: number|null,
 *   oddsImpliedOver25: null,
 * }}
 */
function computeDerived(match) {
  const { p1Clean, pXClean, p2Clean } = computeCleanProbs(match.odds);
  const marketSignal  = computeMarketSignal(p1Clean, p2Clean);
  const tableSignal   = computeTableSignal(match.standings);

  return {
    p1Clean,
    pXClean,
    p2Clean,
    marketSignal,
    tableSignal,
    oddsImpliedOver25: null, // not parsed yet
  };
}

module.exports = { computeDerived, computeCleanProbs, computeMarketSignal, computeTableSignal };
