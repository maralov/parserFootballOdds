/**
 * Derived indices (блоки E, F з ТЗ).
 * Усі функції — чисті, приймають sum-об'єкти.
 */

const { getStatsSum } = require('./matchNormalizer');

function safe(v, fallback) { return v != null && Number.isFinite(v) ? v : fallback; }
function ratio(a, b) { return b > 0 ? Number((a / b).toFixed(3)) : null; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// --- Блок E: складні індекси ---

function pressureIndex(sum) {
  const sot = safe(sum.shotsOnTarget, 0);
  const tib = safe(sum.touchesInOppositionBox, 0);
  const ck = safe(sum.cornerKicks, 0);
  const bc = safe(sum.bigChances, 0);
  const xg = safe(sum.expectedGoalsXg, 0);
  const raw = sot / 14 * 0.25 + tib / 45 * 0.20 + ck / 16 * 0.15 + bc / 8 * 0.25 + xg / 4 * 0.15;
  return Number(clamp01(raw).toFixed(3));
}

function drynessIndex(sum) {
  const sot = safe(sum.shotsOnTarget, 0);
  const bc = safe(sum.bigChances, 0);
  const xg = safe(sum.expectedGoalsXg, 0);
  const saves = safe(sum.goalkeeperSaves, 0);
  const ts = safe(sum.totalShots, 0);
  const lowShots = clamp01(1 - sot / 10);
  const lowChances = clamp01(1 - bc / 4);
  const lowXg = clamp01(1 - xg / 2);
  const lowSaves = clamp01(1 - saves / 6);
  const lowVolume = clamp01(1 - ts / 20);
  const raw = lowShots * 0.25 + lowChances * 0.25 + lowXg * 0.20 + lowSaves * 0.15 + lowVolume * 0.15;
  return Number(clamp01(raw).toFixed(3));
}

function momentumIndex(overallSum, secondHalfSum) {
  if (!overallSum || !secondHalfSum) return null;
  function share(key) {
    const o = safe(overallSum[key], 0);
    const h2 = safe(secondHalfSum[key], 0);
    return o > 0 ? h2 / o : null;
  }
  const shares = [
    share('totalShots'), share('shotsOnTarget'),
    share('expectedGoalsXg'), share('touchesInOppositionBox'),
    share('cornerKicks'),
  ].filter(v => v !== null);
  if (shares.length === 0) return null;
  const avg = shares.reduce((a, b) => a + b, 0) / shares.length;
  return Number(clamp01(avg).toFixed(3));
}

function imbalanceIndex(sum, homeStats, awayStats) {
  const keys = ['shotsOnTarget', 'expectedGoalsXg', 'touchesInOppositionBox', 'cornerKicks', 'bigChances'];
  let totalImb = 0, count = 0;
  for (const k of keys) {
    const h = safe(homeStats?.[k], null);
    const a = safe(awayStats?.[k], null);
    if (h === null || a === null) continue;
    const total = h + a;
    if (total > 0) { totalImb += Math.abs(h - a) / total; count++; }
  }
  return count > 0 ? Number((totalImb / count).toFixed(3)) : null;
}

function conversionPressure(sum) {
  const xg = safe(sum.expectedGoalsXg, 0);
  const sot = safe(sum.shotsOnTarget, 0);
  const saves = safe(sum.goalkeeperSaves, 0);
  const bc = safe(sum.bigChances, 0);
  const raw = xg / 4 * 0.30 + sot / 14 * 0.25 + saves / 12 * 0.20 + bc / 8 * 0.25;
  return Number(clamp01(raw).toFixed(3));
}

function chaosIndex(sum) {
  const yc = safe(sum.yellowCards, 0);
  const rc = safe(sum.redCards, 0);
  const fouls = safe(sum.fouls, 0);
  const saves = safe(sum.goalkeeperSaves, 0);
  const errs = safe(sum.errorsLeadingToShot, 0);
  const fk = safe(sum.freeKicks, 0);
  const raw = yc / 8 * 0.15 + rc / 2 * 0.15 + fouls / 30 * 0.20 + saves / 12 * 0.15 + errs / 4 * 0.15 + fk / 30 * 0.20;
  return Number(clamp01(raw).toFixed(3));
}

// --- Блок F: ratios ---

function computeRatios(sum, overallSum, secondHalfSum) {
  const ts = safe(sum.totalShots, 0);
  const ratios = {
    onTargetRatio: ratio(safe(sum.shotsOnTarget, 0), ts),
    bigChancesPerShot: ratio(safe(sum.bigChances, 0), ts),
    touchesPerShot: ratio(safe(sum.touchesInOppositionBox, 0), ts),
    xgPerShot: ratio(safe(sum.expectedGoalsXg, 0), ts),
    xgPerSOT: ratio(safe(sum.expectedGoalsXg, 0), safe(sum.shotsOnTarget, 0)),
  };

  if (overallSum && secondHalfSum) {
    ratios.secondHalfShotsShare = ratio(safe(secondHalfSum.totalShots, 0), safe(overallSum.totalShots, 0));
    ratios.secondHalfSOTShare = ratio(safe(secondHalfSum.shotsOnTarget, 0), safe(overallSum.shotsOnTarget, 0));
    ratios.secondHalfXgShare = ratio(safe(secondHalfSum.expectedGoalsXg, 0), safe(overallSum.expectedGoalsXg, 0));
  }

  return ratios;
}

// --- Усе разом для одного матчу ---

function computeAllDerived(m) {
  const { sum, overallSum, secondHalfSum, hasBoth } = getStatsSum(m);
  const home2H = m.stats?.secondHalf?.home || m.stats?.overall?.home || {};
  const away2H = m.stats?.secondHalf?.away || m.stats?.overall?.away || {};

  return {
    pressure: pressureIndex(sum),
    dryness: drynessIndex(sum),
    momentum: hasBoth ? momentumIndex(overallSum, secondHalfSum) : null,
    imbalance: imbalanceIndex(sum, home2H, away2H),
    conversionPressure: conversionPressure(sum),
    chaos: chaosIndex(sum),
    ratios: computeRatios(sum, overallSum, secondHalfSum),
  };
}

module.exports = {
  pressureIndex, drynessIndex, momentumIndex,
  imbalanceIndex, conversionPressure, chaosIndex,
  computeRatios, computeAllDerived,
};
