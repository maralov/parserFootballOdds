'use strict';

const { buildAllWindows } = require('./windows');
const { buildFirstHalfProfile } = require('./firstHalfProfile');
const { buildSecondHalfTrend } = require('./secondHalfTrend');
const {
  calculateDrynessScoreForWindow,
  calculateFakePressureScore,
  calculateRealPressureScore,
  calculateLateGoalScore80,
} = require('./modelScoresRaw');
const {
  evaluatePressure,
  finalizePressureQuality,
  classifyDirectionTrend,
  directionNearKick60,
} = require('./pressureEngine');
const { buildFtTmModelSignals } = require('./ftTmModelSignals');

function lastSnapshotTotals(match) {
  const snaps = match.snapshots || [];
  const last = snaps[snaps.length - 1];
  if (!last?.cumulative) return { homeReds: false, awayReds: false, anyRed: false };
  const rh = last.cumulative.redCards?.home ?? 0;
  const ra = last.cumulative.redCards?.away ?? 0;
  const h = typeof rh === 'number' ? rh > 0 : false;
  const a = typeof ra === 'number' ? ra > 0 : false;
  return { homeReds: h, awayReds: a, anyRed: h || a };
}

/**
 * Fully recompute volatile features for a stored match snapshot (no persistence).
 *
 * @param {Object} match matchStore record (mutate-free)
 */
function updateComputed(match) {
  const mode = match.statsLevel === 'detailed' ? 'detailed' : 'basic';
  const windows = buildAllWindows(match);
  const firstHalfProfile = buildFirstHalfProfile(match.statistics);
  const secondHalfTrend = buildSecondHalfTrend(windows);

  const w4560 = windows.window45_60;
  const w5060 = windows.window50_60;
  const w7080 = windows.window70_80;
  const w7580 = windows.window75_80;

  const totals4560 = w4560?.totals ?? null;
  const totals5060 = w5060?.totals ?? totals4560;
  const totals7080 = w7080?.totals ?? null;

  const dryScore60 = calculateDrynessScoreForWindow(totals4560);
  const fakePressureScore60 = calculateFakePressureScore(totals5060 ?? totals4560, { mode });
  const realPressureScore60 = calculateRealPressureScore(totals4560, { mode });

  const fakePressureScore80 = calculateFakePressureScore(totals7080, { mode });
  const realPressureScore80 = calculateRealPressureScore(totals7080, { mode });

  const favorite = match.odds?.isOddsFavorite?.favorite ?? null;

  const p60eval = evaluatePressure(w4560?.raw ?? null);
  const dir60 = directionNearKick60(totals4560, totals5060 ?? totals4560);
  const pq60base = finalizePressureQuality(dir60, fakePressureScore60, realPressureScore60);
  const pressure60 = {
    ...p60eval,
    quality: pq60base.quality !== 'none' ? pq60base.quality : p60eval.quality,
    direction: pq60base.direction || 'flat',
  };

  const p80eval = evaluatePressure(w7080?.raw ?? null);
  const dir80 = classifyDirectionTrend({
    totals70_80: totals7080 ?? null,
    totals75_80: w7580?.totals ?? null,
  });

  let pressureTeamAligned = false;
  if (favorite && favorite !== 'balanced' && p80eval.team === favorite) {
    pressureTeamAligned = true;
  }

  const lateGoalScore80 = calculateLateGoalScore80(totals7080, {
    fakePressureScore: fakePressureScore80,
    pressureTeamAligned,
    favoriteStrengthLabel: match.standings?.favoriteStrength?.label ?? null,
  });

  const pq80base = finalizePressureQuality(dir80, fakePressureScore80, realPressureScore80);
  const pressure80 = {
    ...p80eval,
    quality: pq80base.quality !== 'none' ? pq80base.quality : p80eval.quality,
    direction: pq80base.direction || 'flat',
  };

  const red = lastSnapshotTotals(match);

  const interimForFt = {
    windows,
    firstHalfProfile,
    secondHalfTrend,
    pressure: null,
    statsLevel: match.statsLevel ?? null,
    modelScoresRaw: {},
  };

  interimForFt.pressure = {
    at60primary: pressure60,
    at80primary: pressure80,
    favorite,
    pressureTeamAligned,
    redCards: red,
  };
  interimForFt.modelScoresRaw = {
    dryScore60,
    fakePressureScore60,
    realPressureScore60,
    fakePressureScore80,
    realPressureScore80,
    lateGoalScore80,
  };

  const modelSignals = buildFtTmModelSignals(match, interimForFt);

  return {
    computedAt: new Date().toISOString(),
    snapshotCount: (match.snapshots || []).length,
    statsLevel: match.statsLevel ?? null,
    windows,
    firstHalfProfile,
    secondHalfTrend,
    pressure: {
      at60primary: pressure60,
      at80primary: pressure80,
      favorite,
      pressureTeamAligned,
      redCards: red,
    },
    modelSignals,
    modelScoresRaw: {
      dryScore60,
      fakePressureScore60,
      realPressureScore60,
      fakePressureScore80,
      realPressureScore80,
      lateGoalScore80,
    },
  };
}

module.exports = { updateComputed };
