'use strict';

const PACE_METRICS = [
  'shotsOnTarget',
  'expectedGoalsXg',
  'bigChances',
  'touchesInOppositionBox',
  'totalShots',
];

/**
 * @param {object|null} raw — sum-metrics object
 * @param {number} minutes — minutes covered by raw
 * @returns {object|null} pace[metric] = stat / minutes; null when minutes <= 0
 */
function computePace(raw, minutes) {
  if (!raw || !Number.isFinite(minutes) || minutes <= 0) return null;
  const out = {};
  for (const k of PACE_METRICS) {
    const v = raw[k];
    if (v === null || v === undefined || !Number.isFinite(Number(v))) {
      out[k] = null;
    } else {
      out[k] = Number(v) / minutes;
    }
  }
  return out;
}

/**
 * @param {object|null} pace2H
 * @param {object|null} pace1H
 * @returns {object|null} ratio[metric] = pace2H / pace1H; null when pace1H=0 or null
 */
function computeIntensityRatio(pace2H, pace1H) {
  if (!pace1H || !pace2H) return null;
  const out = {};
  for (const k of PACE_METRICS) {
    const a = pace2H[k];
    const b = pace1H[k];
    if (a === null || b === null || b === 0 || !Number.isFinite(a) || !Number.isFinite(b)) {
      out[k] = null;
    } else {
      out[k] = Number((a / b).toFixed(4));
    }
  }
  return out;
}

module.exports = { computePace, computeIntensityRatio, PACE_METRICS };
