'use strict';

const { clamp } = require('./helpers');

function nv(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/** Dry score for TM-style “dead” window (≈ dryness in 45–60). */
function calculateDrynessScoreForWindow(totals) {
  if (!totals) return 50;
  const shots = totals.totalShots ?? 0;
  const shotsOnTarget = totals.shotsOnTarget ?? 0;
  const corners = totals.corners ?? 0;
  const xg = totals.xg == null ? null : totals.xg;

  let score = 50;
  if (shots <= 1) score += 15;
  else if (shots <= 2) score += 8;
  if (shotsOnTarget === 0) score += 15;
  if (corners === 0) score += 5;
  if (xg !== null && xg < 0.1) score += 15;
  if (xg !== null && xg >= 0.2) score -= 25;
  if (shotsOnTarget >= 1) score -= 20;
  if (shots >= 4) score -= 20;
  if (corners >= 3 && shotsOnTarget >= 1) score -= 10;
  return clamp(score, 0, 100);
}

/** Fake pressure aggregate (RFC Plan 2) on window totals. */
function calculateFakePressureScore(totals, opts = {}) {
  if (!totals) return 0;
  const mode = opts.mode === 'basic' ? 'basic' : 'detailed';

  if (mode === 'basic') {
    const shots = totals.totalShots ?? 0;
    const sot = totals.shotsOnTarget ?? 0;
    const corners = totals.corners ?? 0;
    let s = 0;
    if (corners >= 2 && sot === 0) s += 25;
    if (corners >= 3 && shots <= 1) s += 20;
    if (shots > 0 && sot === 0) s += 10;
    return clamp(s, 0, 100);
  }

  const corners = totals.corners ?? 0;
  const sot = totals.shotsOnTarget ?? 0;
  const crossesAttempted = totals.crossesAttempted ?? 0;
  const crossesMade = totals.crossesMade ?? 0;

  const xg = nv(totals.xg);
  const xgot = nv(totals.xgot);
  const blockedShots = nv(totals.blockedShots);
  const sib = nv(totals.shotsInsideBox);
  const bc = nv(totals.bigChances);
  const tbox = nv(totals.touchesInBox);

  let s = 0;
  if (corners >= 2 && sot === 0) s += 18;
  if (crossesAttempted >= 8 && crossesMade <= 2) s += 14;
  if (blockedShots != null && blockedShots >= 2 && sot === 0) s += 10;
  if (xg != null && xg < 0.08 && corners >= 2) s += 18;
  if (xgot != null && xgot === 0) s += 15;
  if (sib != null && sib <= 1) s += 10;
  if (bc != null && bc === 0) s += 10;
  if (tbox != null && tbox <= 4) s += 10;
  return clamp(s, 0, 100);
}

/** Real pressure aggregate on window totals. */
function calculateRealPressureScore(totals, opts = {}) {
  if (!totals) return 0;
  const mode = opts.mode === 'basic' ? 'basic' : 'detailed';

  if (mode === 'basic') {
    const shots = totals.totalShots ?? 0;
    const sot = totals.shotsOnTarget ?? 0;
    const corners = totals.corners ?? 0;
    return clamp(shots * 6 + sot * 22 + corners * 4, 0, 100);
  }

  const shots = totals.totalShots ?? 0;
  const sot = totals.shotsOnTarget ?? 0;
  const xg = typeof totals.xg === 'number' ? totals.xg : 0;
  const xgot = totals.xgot ?? 0;
  const bc = totals.bigChances ?? 0;
  const sib = totals.shotsInsideBox ?? 0;
  const tbox = totals.touchesInBox ?? 0;
  const saves = totals.goalkeeperSaves ?? 0;

  const score = shots * 4 + sot * 18 + xg * 35 + xgot * 30
    + bc * 22 + sib * 8 + tbox * 2 + saves * 10;
  return clamp(score, 0, 100);
}

/** Late goal score TB context (primarily window 70–80). */
function calculateLateGoalScore80(totals, ctx = {}) {
  if (!totals) return 0;
  const { fakePressureScore = 0, pressureTeamAligned = false, favoriteStrengthLabel = null } = ctx;

  const shots = totals.totalShots ?? 0;
  const shotsOnTarget = totals.shotsOnTarget ?? 0;
  const corners = totals.corners ?? 0;
  const xg = totals.xg;

  let score = 35;
  if (shots >= 2) score += 10;
  if (shots >= 4) score += 10;
  if (shotsOnTarget >= 1) score += 20;
  if (corners >= 2) score += 8;
  if (xg != null && xg >= 0.15) score += 20;
  if (xg != null && xg >= 0.25) score += 10;
  if (pressureTeamAligned) score += 10;
  if (favoriteStrengthLabel === 'strong') score += 5;
  if (fakePressureScore >= 60) score -= 20;
  if (shotsOnTarget === 0 && xg != null && xg < 0.08) score -= 20;
  return clamp(score, 0, 100);
}

module.exports = {
  calculateDrynessScoreForWindow,
  calculateFakePressureScore,
  calculateRealPressureScore,
  calculateLateGoalScore80,
};
