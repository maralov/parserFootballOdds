'use strict';

function n01(v, max) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const c = Math.max(0, Math.min(Number(v), max));
  return c / max;
}

/**
 * dry score for a half based on raw stats intensity.
 * Returns [0..1], 1 = fully dry (no pressure), 0 = high pressure.
 */
function dryFromIntensity(raw) {
  if (!raw) return 0.5;

  const sot   = n01(raw.shotsOnTarget, 8);
  const xg    = n01(raw.expectedGoalsXg, 2.0);
  const bc    = n01(raw.bigChances, 4);
  const touch = n01(raw.touchesInOppositionBox, 25);

  const parts = [];
  if (sot   !== null) parts.push({ v: sot,   w: 0.40 });
  if (xg    !== null) parts.push({ v: xg,    w: 0.30 });
  if (bc    !== null) parts.push({ v: bc,    w: 0.20 });
  if (touch !== null) parts.push({ v: touch, w: 0.10 });

  if (parts.length === 0) return 0.5;

  const totalW    = parts.reduce((s, p) => s + p.w, 0);
  const intensity = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;

  return Number(Math.max(0, Math.min(1, 1 - intensity)).toFixed(4));
}

/**
 * trajectory_dry based on intensityRatio (pace_2H / pace_1H per metric).
 * Formula: dry = clip(1.5 - weighted_ratio, 0, 1)
 *   ratio=0.5 → dry=1.0, ratio=1.0 → dry=0.5, ratio=1.5 → dry=0.0
 */
function trajectoryDry(intensityRatio) {
  if (!intensityRatio) return 0.3;
  const parts = [];
  if (Number.isFinite(intensityRatio.expectedGoalsXg))
    parts.push({ v: intensityRatio.expectedGoalsXg, w: 0.40 });
  if (Number.isFinite(intensityRatio.shotsOnTarget))
    parts.push({ v: intensityRatio.shotsOnTarget, w: 0.35 });
  if (Number.isFinite(intensityRatio.touchesInOppositionBox))
    parts.push({ v: intensityRatio.touchesInOppositionBox, w: 0.25 });
  if (parts.length === 0) return 0.3;
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  const weightedRatio = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;
  return Number(Math.max(0, Math.min(1, 1.5 - weightedRatio)).toFixed(4));
}

/**
 * odds_dry: implied draw probability + market tightness.
 */
function oddsDry(odds1X2) {
  if (!odds1X2 || !odds1X2.home || !odds1X2.draw || !odds1X2.away) return 0.4;
  const h = Number(odds1X2.home), d = Number(odds1X2.draw), a = Number(odds1X2.away);
  if (![h, d, a].every(x => Number.isFinite(x) && x > 1)) return 0.4;
  const inv = 1/h + 1/d + 1/a;
  const impliedDraw = (1/d) / inv;
  const marketTotalInv = 1/h + 1/a;
  const drawNorm = Math.max(0, Math.min(1, (impliedDraw - 0.20) / (0.40 - 0.20)));
  const totalInvNorm = Math.max(0, Math.min(1, (marketTotalInv - 0.55) / (0.95 - 0.55)));
  return Number(Math.max(0, Math.min(1, 0.5 * drawNorm + 0.5 * (1 - totalInvNorm))).toFixed(4));
}

/**
 * prematch_dry: team form and H2H profile.
 */
function prematchDry(aggregates) {
  if (!aggregates) return 0.3;
  const isLow = (x, threshold, minN) =>
    x && Number.isFinite(x.n) && x.n >= minN &&
    Number.isFinite(x.avgTotalGoals) && x.avgTotalGoals <= threshold;
  const homeLow  = isLow(aggregates.home,   2.0, 3) ? 1 : 0;
  const awayLow  = isLow(aggregates.away,   2.0, 3) ? 1 : 0;
  const h2hLow   = isLow(aggregates.mutual, 2.2, 2) ? 1 : 0;
  return Number((0.4 * homeLow + 0.4 * awayLow + 0.2 * h2hLow).toFixed(4));
}

module.exports = { dryFromIntensity, trajectoryDry, oddsDry, prematchDry, n01 };
