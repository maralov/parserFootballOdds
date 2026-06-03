'use strict';

const { pressureBiasFor } = require('./leagueBias');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sumSide(pair) {
  if (!pair) return null;
  const h = pair.home;
  const a = pair.away;
  if (h == null && a == null) return null;
  return (h || 0) + (a || 0);
}

function subSide(a, b) {
  if (!a || !b) return null;
  if (a.home == null && a.away == null) return null;
  return {
    home: (a.home || 0) - (b.home || 0),
    away: (a.away || 0) - (b.away || 0),
  };
}

function maxSide(pair) {
  if (!pair) return null;
  const h = pair.home;
  const a = pair.away;
  if (h == null && a == null) return null;
  return Math.max(h || 0, a || 0);
}

function presFromXgDelta10(snapshot80) {
  const dxg = sumSide(snapshot80?.delta?.expectedGoalsXg);
  if (dxg == null) return null;
  return 100 * clamp(dxg / 0.6, 0, 1);
}

function presFromSotDelta10(snapshot80) {
  const ds = sumSide(snapshot80?.delta?.shotsOnTarget);
  if (ds == null) return null;
  return 100 * clamp(ds / 4, 0, 1);
}

function presFromTouchesDelta10(snapshot80) {
  const dt = sumSide(snapshot80?.delta?.touchesInOppositionBox);
  if (dt == null) return null;
  return 100 * clamp(dt / 8, 0, 1);
}

function presFromCornersDelta10(snapshot80) {
  const dc = sumSide(snapshot80?.delta?.cornerKicks);
  if (dc == null) return null;
  return 100 * clamp(dc / 3, 0, 1);
}

function presFromBigChancesDelta10(snapshot80) {
  const db = sumSide(snapshot80?.delta?.bigChances);
  if (db == null) return null;
  return 100 * clamp(db / 2, 0, 1);
}

function presFromXgVs60(snapshot80, snapshot60) {
  const xg80 = sumSide(snapshot80?.cumulative?.expectedGoalsXg);
  const xg60 = sumSide(snapshot60?.cumulative?.expectedGoalsXg);
  if (xg80 == null || xg60 == null) return null;
  const diff = xg80 - xg60;
  return 100 * clamp(diff / 0.5, 0, 1);
}

function presFromPossessionImbalance(snapshot80) {
  const h = snapshot80?.ballPossession?.home;
  const a = snapshot80?.ballPossession?.away;
  if (h == null && a == null) return null;
  const maxPoss = Math.max(h || 0, a || 0);
  return clamp((maxPoss - 55) * 4, 0, 100);
}

function presFromXg2H(s80) {
  const xg = sumSide(s80?.since2H?.expectedGoalsXg);
  if (xg == null) return null;
  return 100 * clamp(xg / 1.2, 0, 1);
}

function presFromSot2H(s80) {
  const sot = sumSide(s80?.since2H?.shotsOnTarget);
  if (sot == null) return null;
  return 100 * clamp(sot / 5, 0, 1);
}

function presFromBigChances2H(s80) {
  const big = sumSide(s80?.since2H?.bigChances);
  if (big == null) return null;
  return 100 * clamp(big / 2, 0, 1);
}

function presFromLiveDominance(match, s80) {
  const xg = s80?.since2H?.expectedGoalsXg;
  const sot = s80?.since2H?.shotsOnTarget;
  const touch = s80?.since2H?.touchesInOppositionBox;
  const parts = [];
  if (xg) parts.push(Math.abs((xg.home || 0) - (xg.away || 0)) / 0.6);
  if (sot) parts.push(Math.abs((sot.home || 0) - (sot.away || 0)) / 4);
  if (touch) parts.push(Math.abs((touch.home || 0) - (touch.away || 0)) / 8);
  if (!parts.length) return null;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return clamp(avg * 100, 0, 100);
}

const COMPONENTS = [
  { key: 'xg_delta_10',          weight: 12, fn: (m, s80) => presFromXgDelta10(s80) },
  { key: 'sot_delta_10',         weight: 10, fn: (m, s80) => presFromSotDelta10(s80) },
  { key: 'touches_delta_10',     weight:  8, fn: (m, s80) => presFromTouchesDelta10(s80) },
  { key: 'corners_delta_10',     weight:  5, fn: (m, s80) => presFromCornersDelta10(s80) },
  { key: 'big_chances_delta_10', weight:  5, fn: (m, s80) => presFromBigChancesDelta10(s80) },
  { key: 'xg_2h',                weight: 15, fn: (m, s80) => presFromXg2H(s80) },
  { key: 'sot_2h',               weight: 12, fn: (m, s80) => presFromSot2H(s80) },
  { key: 'big_chances_2h',       weight:  8, fn: (m, s80) => presFromBigChances2H(s80) },
  { key: 'possession_imbalance', weight:  5, fn: (m, s80) => presFromPossessionImbalance(s80) },
  { key: 'live_dominance',       weight: 10, fn: (m, s80) => presFromLiveDominance(m, s80) },
];

const LEAGUE_BIAS_WEIGHT = 5;

/**
 * Compute Pressure Score at minute 80.
 * @param {Object} match
 * @param {Object} snapshot80  the snapshot near minute 80
 * @param {Object} [snapshot60] the snapshot near minute 60 (for xG diff)
 * @returns {{score: number, components: Object, weightUsed: number}}
 */
function computePS(match, snapshot80, snapshot60) {
  const components = {};
  let weightedSum = 0;
  let weightUsed = 0;

  for (const c of COMPONENTS) {
    const value = c.fn(match, snapshot80, snapshot60);
    components[c.key] = value;
    if (value != null) {
      weightedSum += value * c.weight;
      weightUsed += c.weight;
    }
  }

  const leagueBias = pressureBiasFor(match);
  components.league_bias = leagueBias;
  weightedSum += leagueBias * LEAGUE_BIAS_WEIGHT;
  weightUsed += LEAGUE_BIAS_WEIGHT;

  const score = weightUsed > 0 ? Math.round(weightedSum / weightUsed) : null;

  return { score, components, weightUsed };
}

module.exports = { computePS, COMPONENTS };
