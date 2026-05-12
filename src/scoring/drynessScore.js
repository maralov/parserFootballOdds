'use strict';

const { drynessBiasFor } = require('./leagueBias');

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

// Each scorer returns a number 0..100 or null when input missing.
function dryFromXgTotal(snapshot) {
  const xg = sumSide(snapshot?.cumulative?.expectedGoalsXg);
  if (xg == null) return null;
  return 100 * (1 - clamp(xg / 1.8, 0, 1));
}

function dryFromXgDelta(snapshot) {
  const dxg = sumSide(snapshot?.delta?.expectedGoalsXg);
  if (dxg == null) return null;
  return 100 * (1 - clamp(dxg / 0.5, 0, 1));
}

function dryFromSotTotal(snapshot) {
  const sot = sumSide(snapshot?.cumulative?.shotsOnTarget);
  if (sot == null) return null;
  return 100 * (1 - clamp(sot / 8, 0, 1));
}

function dryFromTouches(snapshot) {
  const t = sumSide(snapshot?.cumulative?.touchesInOppositionBox);
  if (t == null) return null;
  return 100 * (1 - clamp(t / 35, 0, 1));
}

function dryFromBigChances(snapshot) {
  const big = sumSide(snapshot?.cumulative?.bigChances);
  if (big == null) return null;
  return 100 * (1 - clamp(big / 3, 0, 1));
}

function dryFromPossessionBalance(snapshot) {
  const home = snapshot?.ballPossession?.home;
  if (home == null) return null;
  return clamp(100 - Math.abs(50 - home) * 2, 0, 100);
}

function dryFromCornersDelta(snapshot) {
  const dc = sumSide(snapshot?.delta?.cornerKicks);
  if (dc == null) return null;
  return 100 * (1 - clamp(dc / 4, 0, 1));
}

function dryFromCards(snapshot) {
  const y = sumSide(snapshot?.cumulative?.yellowCards) || 0;
  const r = sumSide(snapshot?.cumulative?.redCards) || 0;
  if (y === 0 && r === 0) return null;
  return Math.min(100, y * 15 + r * 40);
}

function dryFromErrors(snapshot) {
  const e = sumSide(snapshot?.cumulative?.errorsLeadingToShot);
  if (e == null) return null;
  return 100 * (1 - clamp(e / 2, 0, 1));
}

const COMPONENTS = [
  { key: 'xg_total',         weight: 20, fn: dryFromXgTotal },
  { key: 'xg_delta_last10',  weight: 15, fn: dryFromXgDelta },
  { key: 'sot_total',        weight: 10, fn: dryFromSotTotal },
  { key: 'touches_in_box',   weight: 10, fn: dryFromTouches },
  { key: 'big_chances',      weight: 10, fn: dryFromBigChances },
  { key: 'possession_bal',   weight:  5, fn: dryFromPossessionBalance },
  { key: 'corners_delta',    weight:  5, fn: dryFromCornersDelta },
  { key: 'cards',            weight: 10, fn: dryFromCards },
  { key: 'errors',           weight:  5, fn: dryFromErrors },
];

const LEAGUE_BIAS_WEIGHT = 10;

/**
 * Compute Dryness Score at minute 60.
 * @param {Object} match  match record from matchStore
 * @param {Object} snapshot the snapshot at ~60' (cumulative + delta relative to prior snapshot)
 * @returns {{score: number, components: Object, weightUsed: number}}
 */
function computeDS(match, snapshot) {
  const components = {};
  let weightedSum = 0;
  let weightUsed = 0;

  for (const c of COMPONENTS) {
    const value = c.fn(snapshot);
    components[c.key] = value;
    if (value != null) {
      weightedSum += value * c.weight;
      weightUsed += c.weight;
    }
  }

  const leagueBias = drynessBiasFor(match);
  components.league_bias = leagueBias;
  weightedSum += leagueBias * LEAGUE_BIAS_WEIGHT;
  weightUsed += LEAGUE_BIAS_WEIGHT;

  // Normalize by actually-used weight (so missing components don't drag score to 0)
  const score = weightUsed > 0 ? Math.round(weightedSum / weightUsed) : null;

  return { score, components, weightUsed };
}

module.exports = { computeDS, COMPONENTS };
