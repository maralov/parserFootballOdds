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

function calculateDryStateScore({ sinceHt, tempoTrend, statsLevel }) {
  if (!sinceHt) return 50;
  const detailed = statsLevel === 'detailed';

  if (detailed) {
    let score = 50;
    const sot = sinceHt.shotsOnTarget;
    const xg = sinceHt.xg;
    const xgot = sinceHt.xgot;
    const bc = sinceHt.bigChances;
    const sib = sinceHt.shotsInsideBox;
    const tbox = sinceHt.touchesInBox;

    if (sot != null && sot === 0) score += 14;
    if (xg != null && xg <= 0.12) score += 14;
    if (xgot != null && xgot === 0) score += 12;
    if (bc != null && bc === 0) score += 12;
    if (sib != null && sib <= 1) score += 8;
    if (tbox != null && tbox <= 5) score += 8;
    if (tempoTrend === 'flat') score += 8;
    if (tempoTrend === 'falling') score += 12;

    if (sot != null && sot >= 1) score -= 18;
    if (xg != null && xg >= 0.20) score -= 20;
    if (xgot != null && xgot > 0) score -= 18;
    if (bc != null && bc >= 1) score -= 25;
    if (tempoTrend === 'growing') score -= 15;
    if (tempoTrend === 'explosive') score -= 30;

    return clamp(score, 0, 100);
  }

  let score = 50;
  const sot = sinceHt.shotsOnTarget;
  const shots = sinceHt.totalShots;
  const corners = sinceHt.corners;

  if (sot != null && sot === 0) score += 18;
  if (shots != null && shots <= 2) score += 15;
  if (corners != null && corners <= 2) score += 6;
  if (tempoTrend === 'flat') score += 8;
  if (tempoTrend === 'falling') score += 12;

  if (sot != null && sot >= 1) score -= 22;
  if (shots != null && shots >= 5) score -= 18;
  if (corners != null && corners >= 4 && sot != null && sot >= 1) score -= 10;
  if (tempoTrend === 'growing') score -= 15;
  if (tempoTrend === 'explosive') score -= 30;

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

/** Late goal score TB80+ (window 70–80 + pressure/tempo context per RFC). */
function calculateLateGoalScore80(totals, ctx = {}) {
  if (!totals) return 0;
  const realPressure7080 = ctx.realPressureScore70_80;
  const fakePressure7080 = ctx.fakePressureScore70_80;
  const tempoTrend7080 = ctx.tempoTrend70_80;

  const sot = totals.shotsOnTarget ?? 0;
  const xg = nv(totals.xg);
  const xgot = nv(totals.xgot);
  const bc = nv(totals.bigChances);
  const sib = nv(totals.shotsInsideBox);
  const corners = totals.corners ?? 0;

  let score = 30;
  if ((realPressure7080 || 0) >= 45) score += 20;
  if (sot >= 1) score += 18;
  if (xg != null && xg >= 0.15) score += 15;
  if (xgot != null && xgot > 0) score += 15;
  if (bc != null && bc >= 1) score += 18;
  if (sib != null && sib >= 2) score += 8;
  if (corners >= 2 && sot >= 1) score += 6;
  if (tempoTrend7080 === 'growing') score += 10;
  if (tempoTrend7080 === 'explosive') score += 20;

  if ((fakePressure7080 || 0) >= 65) score -= 18;
  if ((realPressure7080 || 0) < 30) score -= 15;
  if (sot === 0 && (xgot == null || xgot === 0)) score -= 20;

  return clamp(score, 0, 100);
}

function calculateLateActivationRisk({
  firstHalfProfile,
  favoriteContext,
  tournamentImportance,
  realPressureScore50_60,
  realPressureScore60_70,
  tempoTrend,
  yellowCardsTotal,
  hasRedCard,
  isDryFirstHalf,
  dryStateScore,
  fakePressureScore,
  realPressureScore,
}) {
  let risk = 20;

  if (firstHalfProfile?.isHotButNoGoal === true) risk += 18;
  if (favoriteContext?.strongLabel === true) risk += 12;
  if (Math.abs(favoriteContext?.marketSignal || 0) > 0.4) risk += 8;
  if (Math.abs(favoriteContext?.tableSignal || 0) > 0.45) risk += 8;
  if ((tournamentImportance || 0) >= 3) risk += 10;
  if ((realPressureScore50_60 || 0) >= 35) risk += 10;
  if ((realPressureScore60_70 || 0) >= 35) risk += 12;
  if (tempoTrend === 'growing') risk += 12;
  if (tempoTrend === 'explosive') risk += 25;
  if ((yellowCardsTotal || 0) >= 4) risk += 8;
  if (hasRedCard) risk += 30;

  if (isDryFirstHalf === true && (dryStateScore || 0) >= 78 && (realPressureScore || 0) < 30) {
    risk -= 10;
  }
  if ((fakePressureScore || 0) >= 60 && (realPressureScore || 0) < 30) {
    risk -= 5;
  }

  return clamp(risk, 0, 100);
}

function dataQualityScore({ statsLevel, hasXg, hasXgot }) {
  if (statsLevel === 'detailed' && hasXg && hasXgot) return 90;
  if (statsLevel === 'detailed' && hasXg) return 80;
  if (statsLevel === 'basic') return 60;
  return 45;
}

function calculateFullTimeNilNilScore({
  dryStateScore,
  realPressureScore,
  lateActivationRisk,
  isDryFirstHalf,
  isHotButNoGoal,
  fakePressureScore,
  dataQualityScore: dqIn,
}) {
  const noRealPressure = 100 - (realPressureScore || 0);
  const noLateActivation = 100 - (lateActivationRisk || 0);
  const firstHalfDryness = isDryFirstHalf === true ? 85
    : isHotButNoGoal === true ? 25
      : 55;
  const sterilePressure = ((fakePressureScore || 0) >= 45 && (realPressureScore || 0) < 35) ? 75 : 50;
  const dq = dqIn || 50;

  const score =
    (dryStateScore || 0) * 0.30 +
    noRealPressure * 0.25 +
    noLateActivation * 0.25 +
    firstHalfDryness * 0.10 +
    sterilePressure * 0.05 +
    dq * 0.05;

  return clamp(score, 0, 100);
}

module.exports = {
  calculateDrynessScoreForWindow,
  calculateDryStateScore,
  calculateFakePressureScore,
  calculateRealPressureScore,
  calculateLateGoalScore80,
  calculateLateActivationRisk,
  calculateFullTimeNilNilScore,
  dataQualityScore,
};
