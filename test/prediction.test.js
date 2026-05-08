'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { subtractStats, buildStatsMap, CUMULATIVE_STAT_FIELDS } = require('../src/tracker/deltaCalculator');
const { buildAllWindows } = require('../src/computed/windows');
const { evaluateDecision60 } = require('../src/prediction/evaluateDecision60');
const { evaluateDecision80 } = require('../src/prediction/evaluateDecision80');
const { updateComputed } = require('../src/computed/updateComputed');
const predictionSignals = require('../src/store/predictionSignals');
const { buildFirstHalfProfile } = require('../src/computed/firstHalfProfile');
const matchStore = require('../src/store/matchStore');
const { maybeRunPredictionPipeline } = require('../src/prediction/runLivePrediction');
const { hotHalfNoGoal1H, classifyTrend6075, classifyTrend7080 } = require('../src/computed/ftTmModelSignals');
const {
  calculateRealPressureScore,
  calculateFakePressureScore,
  calculateDryStateScore,
  calculateLateActivationRisk,
  calculateFullTimeNilNilScore,
  calculateLateGoalScore80,
  dataQualityScore,
} = require('../src/computed/modelScoresRaw');
const { applyAiOverlay, isPremiumAiSignal } = require('../src/prediction/aiOverlay');
const { buildConfidence } = require('../src/prediction/confidence');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('CUMULATIVE_STAT_FIELDS extend legacy baseline', () => {
  assert.ok(CUMULATIVE_STAT_FIELDS.includes('cornerKicks'));
  assert.ok(CUMULATIVE_STAT_FIELDS.includes('bigChances'));

  const a = buildStatsMap(
    {
      totalShots: 4,
      bigChances: 1,
    },
    {
      totalShots: 6,
      bigChances: 0,
    },
  );

  const b = buildStatsMap({ totalShots: 4, bigChances: 1 }, { totalShots: 6, bigChances: 0 });

  const z = subtractStats(a, b);
  assert.ok(z);
  assert.equal(z.totalShots.home, 0);
  assert.equal(z.bigChances.home, 0);
});

test('buildAllWindows derives window45_60 totals across cumulative snapshots', () => {
  const c45 = buildStatsMap({ totalShots: 2, shotsOnTarget: 0 }, { totalShots: 3, shotsOnTarget: 0 });
  const c60 = buildStatsMap({ totalShots: 8, shotsOnTarget: 1 }, { totalShots: 11, shotsOnTarget: 0 });

  const match = {
    snapshots: [
      { minute: 45, cumulative: c45 },
      { minute: 60, cumulative: c60 },
    ],
  };

  const wins = buildAllWindows(match);
  assert.ok(wins.window45_60);
  assert.ok(wins.window45_60.totals);
  assert.equal(wins.window45_60.totals.totalShots, (8 - 2) + (11 - 3));
});

test('prediction lock forces decision80 NO_BET', () => {
  const match = {
    matchId: 'x',
    predictionLocks: { blockTb80Plus: true, reason: 'tm60_75_signal_was_issued' },
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = updateComputed(match);
  const pred = evaluateDecision80(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert(pred.riskFlags.includes('locked_after_tm60_signal'));
  assert.equal(pred.mode, 'detailed');
  assert.equal(pred.modelMode, pred.mode);
  assert.equal(pred.useInBacktest, false);
  assert.equal(typeof pred.useInTelegram, 'boolean');
});

test('evaluateDecision60 NO_BET on lateActivationRisk >= 60', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 65,
      realPressureScores: { window45_60: 20, window60_70: 20 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert.ok(pred.reasons.includes('late_activation_risk_too_high'));
  assert.ok(pred.riskFlags.includes('late_activation_signs'));
});

test('evaluateDecision60 NO_BET on realPressureScore >= 60', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 30,
      realPressureScores: { window45_60: 20, window60_70: 65 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert.ok(pred.reasons.includes('real_pressure_too_high'));
  assert.ok(pred.riskFlags.includes('late_activation_signs'));
});

test('evaluateDecision60 NO_BET on window70_75 real pressure >= 60', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 25,
      realPressureScores: { window45_60: 20, window60_70: 20, window65_70: 20, window70_75: 65 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert.ok(pred.reasons.includes('real_pressure_too_high'));
});

test('evaluateDecision60 NO_BET on lateActivationRisk equality (=60)', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 60,
      realPressureScores: { window45_60: 20, window60_70: 20 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert.ok(pred.reasons.includes('late_activation_risk_too_high'));
});

test('evaluateDecision60 does not trigger hard filters on moderate values', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 40,
      realPressureScores: { window45_60: 30, window60_70: 30 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(!pred.reasons.includes('late_activation_risk_too_high'));
  assert.ok(!pred.reasons.includes('real_pressure_too_high'));
});

test('prediction-signals idempotent append', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signals-'));
  const row = {
    matchId: 'm1',
    recordedAt: new Date().toISOString(),
    checkpoint: 'decision60',
    signal: predictionSignals.deriveSignal({ predictionType: 'FT_TM05_FROM_60_75' }),
    minute: 60,
    score: '0:0',
    predictionType: 'FT_TM05_FROM_60_75',
    confidence: 0.7,
    modelMode: 'detailed',
    components: {},
    reasons: [],
    riskFlags: [],
  };
  predictionSignals.appendPredictionSignals(tmp, row);
  predictionSignals.appendPredictionSignals(tmp, row);
  const arr = predictionSignals.readSignalsArray(tmp);
  assert.equal(arr.length, 1);
});

test('buildFirstHalfProfile detailed dry', () => {
  const p = buildFirstHalfProfile({
    '1half': {
      overall: {
        expectedGoalsXg: 0.3,
        shotsOnTarget: 1,
        bigChances: 0,
        xgOnTargetXgot: 0.1,
        totalShots: 5,
        cornerKicks: 3,
      },
    },
  });
  assert.equal(p.isDryFirstHalf, true);
  assert.equal(p.isHotButNoGoal, false);
  assert.equal(p.isFakePressure1H, false);
  assert.equal(p.isHighQualityNoGoal, false);
});

test('buildFirstHalfProfile detailed hot', () => {
  const p = buildFirstHalfProfile({
    '1half': {
      overall: {
        expectedGoalsXg: 1.4,
        shotsOnTarget: 5,
        bigChances: 2,
        xgOnTargetXgot: 0.9,
        totalShots: 15,
        cornerKicks: 4,
      },
    },
  });
  assert.equal(p.isHotButNoGoal, true);
  assert.equal(p.isHighQualityNoGoal, true);
});

test('buildFirstHalfProfile detailed fake pressure', () => {
  const p = buildFirstHalfProfile({
    '1half': {
      overall: {
        cornerKicks: 8,
        shotsOnTarget: 1,
        expectedGoalsXg: 0.3,
        xgOnTargetXgot: 0.1,
        bigChances: 0,
      },
    },
  });
  assert.equal(p.isFakePressure1H, true);
});

test('buildFirstHalfProfile basic dry fallback', () => {
  const p = buildFirstHalfProfile({
    '1half': {
      overall: {
        totalShots: 5,
        shotsOnTarget: 1,
        cornerKicks: 3,
      },
    },
  });
  assert.equal(p.isDryFirstHalf, true);
  assert.equal(p.isHotButNoGoal, null);
  assert.equal(p.isFakePressure1H, null);
  assert.equal(p.isHighQualityNoGoal, null);
});

test('buildFirstHalfProfile detailed not-dry overrides basic dry-fallback', () => {
  const p = buildFirstHalfProfile({
    '1half': {
      overall: {
        expectedGoalsXg: 1.2,
        shotsOnTarget: 1,
        bigChances: 0,
        xgOnTargetXgot: 0.1,
        totalShots: 5,
        cornerKicks: 3,
      },
    },
  });
  assert.equal(p.isDryFirstHalf, false);
});

test('hotHalfNoGoal1H fallback uses OR (xgot alone triggers)', () => {
  const profile = {
    totalXg: 0.4,
    totalXgot: 0.9,
    totalBigChances: 0,
    totalShotsOnTarget: 2,
    totalGoalkeeperSaves: 1,
  };
  assert.equal(hotHalfNoGoal1H(profile, 'detailed'), true);
});

test('hotHalfNoGoal1H fallback false on quiet half', () => {
  const profile = {
    totalXg: 0.3,
    totalXgot: 0.1,
    totalBigChances: 0,
    totalShotsOnTarget: 1,
    totalGoalkeeperSaves: 0,
  };
  assert.equal(hotHalfNoGoal1H(profile, 'detailed'), false);
});

test('buildAllWindows includes new windows', () => {
  const c55 = buildStatsMap({ totalShots: 50 }, { totalShots: 0 });
  const c60 = buildStatsMap({ totalShots: 56 }, { totalShots: 0 });
  const c80 = buildStatsMap({ totalShots: 70 }, { totalShots: 0 });
  const c85 = buildStatsMap({ totalShots: 73 }, { totalShots: 0 });
  const c90 = buildStatsMap({ totalShots: 76 }, { totalShots: 0 });
  const match = {
    snapshots: [
      { minute: 55, cumulative: c55 },
      { minute: 60, cumulative: c60 },
      { minute: 80, cumulative: c80 },
      { minute: 85, cumulative: c85 },
      { minute: 90, cumulative: c90 },
    ],
  };
  const wins = buildAllWindows(match);
  assert.equal(wins.window55_60.totals.totalShots, 6);
  assert.equal(wins.window80_85.totals.totalShots, 3);
  assert.equal(wins.window80_90.totals.totalShots, 6);
});

test('evaluateDecision80 accepts minute 90 via prediction pipeline', () => {
  const isoDate = new Date('2099-06-20T14:00:00.000Z');
  const matchId = '__tb90_pipeline_test__';

  try {
    matchStore.writeStore({}, isoDate);

    const storeBlank = {};
    storeBlank[matchId] = {
      matchId,
      statsLevel: 'basic',
      statistics: {},
      tracking: {
        status: 'active',
        validForPrediction: true,
      },
      snapshots: [],
    };
    matchStore.writeStore(storeBlank, isoDate);

    maybeRunPredictionPipeline(matchId, { minute: 90, scoreHome: 0, scoreAway: 0 }, isoDate);

    const m = matchStore.getMatch(matchId, isoDate);
    assert.ok(m);
    assert.ok(m.predictions != null);
    assert.ok(m.predictions.decision80 != null);
  } finally {
    matchStore.writeStore({}, isoDate);
  }
});

test('calculateRealPressureScore detailed linear formula', () => {
  const totals = {
    totalShots: 5,
    shotsOnTarget: 2,
    xg: 0.4,
    xgot: 0.3,
    bigChances: 1,
    shotsInsideBox: 3,
    touchesInBox: 8,
    goalkeeperSaves: 0,
  };
  assert.equal(calculateRealPressureScore(totals, { mode: 'detailed' }), 100);
});

test('calculateRealPressureScore detailed dry window', () => {
  const totals = {
    totalShots: 1,
    shotsOnTarget: 0,
    xg: 0.05,
    xgot: 0,
    bigChances: 0,
    shotsInsideBox: 0,
    touchesInBox: 2,
  };
  const score = calculateRealPressureScore(totals, { mode: 'detailed' });
  assert.ok(score >= 9 && score <= 10);
});

test('calculateRealPressureScore basic', () => {
  const totals = { totalShots: 4, shotsOnTarget: 1, corners: 3 };
  assert.equal(calculateRealPressureScore(totals, { mode: 'basic' }), 58);
});

test('calculateRealPressureScore basic dry', () => {
  const totals = { totalShots: 1, shotsOnTarget: 0, corners: 1 };
  const score = calculateRealPressureScore(totals, { mode: 'basic' });
  assert.equal(score, 1 * 6 + 0 * 22 + 1 * 4);
});

test('calculateFakePressureScore detailed all triggers', () => {
  const totals = {
    corners: 3,
    shotsOnTarget: 0,
    crossesAttempted: 10,
    crossesMade: 1,
    blockedShots: 3,
    xg: 0.05,
    xgot: 0,
    shotsInsideBox: 0,
    bigChances: 0,
    touchesInBox: 2,
  };
  assert.equal(calculateFakePressureScore(totals, { mode: 'detailed' }), 100);
});

test('calculateFakePressureScore detailed includes blocked-shots component', () => {
  const totals = {
    corners: 0,
    shotsOnTarget: 0,
    blockedShots: 3,
    xgot: 1,
    bigChances: 5,
    shotsInsideBox: 5,
    touchesInBox: 10,
  };
  const score = calculateFakePressureScore(totals, { mode: 'detailed' });
  assert.equal(score, 10);
});

test('calculateFakePressureScore detailed missing xgot does NOT bump +15', () => {
  const totals = {
    corners: 0,
    shotsOnTarget: 0,
    bigChances: 5,
    shotsInsideBox: 5,
    touchesInBox: 10,
  };
  const score = calculateFakePressureScore(totals, { mode: 'detailed' });
  assert.equal(score, 0);
});

test('calculateFakePressureScore detailed explicit xgot===0 bumps +15', () => {
  const totals = {
    corners: 0,
    shotsOnTarget: 0,
    xgot: 0,
    bigChances: 5,
    shotsInsideBox: 5,
    touchesInBox: 10,
  };
  const score = calculateFakePressureScore(totals, { mode: 'detailed' });
  assert.equal(score, 15);
});

test('calculateFakePressureScore null totals returns 0', () => {
  assert.equal(calculateFakePressureScore(null), 0);
});

test('calculateFakePressureScore basic', () => {
  const totals = { totalShots: 1, shotsOnTarget: 0, corners: 3 };
  assert.equal(calculateFakePressureScore(totals, { mode: 'basic' }), 55);
});

test('calculateRealPressureScore returns 0 for null totals', () => {
  assert.equal(calculateRealPressureScore(null), 0);
});

test('calculateDryStateScore detailed sterile match clamps to 100', () => {
  const score = calculateDryStateScore({
    sinceHt: {
      shotsOnTarget: 0,
      xg: 0.05,
      xgot: 0,
      bigChances: 0,
      shotsInsideBox: 0,
      touchesInBox: 3,
    },
    tempoTrend: 'flat',
    statsLevel: 'detailed',
  });
  assert.ok(score === 100);
});

test('calculateDryStateScore detailed hot match is very low', () => {
  const score = calculateDryStateScore({
    sinceHt: {
      shotsOnTarget: 2,
      xg: 0.4,
      xgot: 0.2,
      bigChances: 1,
      shotsInsideBox: 3,
      touchesInBox: 8,
    },
    tempoTrend: 'growing',
    statsLevel: 'detailed',
  });
  assert.ok(score < 25);
});

test('calculateDryStateScore returns 50 when sinceHt missing', () => {
  assert.equal(calculateDryStateScore({ sinceHt: null, tempoTrend: 'flat', statsLevel: 'detailed' }), 50);
});

test('calculateDryStateScore basic sterile', () => {
  const score = calculateDryStateScore({
    sinceHt: { shotsOnTarget: 0, totalShots: 1, corners: 1 },
    tempoTrend: 'flat',
    statsLevel: 'basic',
  });
  assert.equal(score, 97);
});

test('classifyTrend6075 detailed explosive from quiet prev burst last', () => {
  const windows = {
    window45_60: { totals: { totalShots: 0 } },
    window70_75: {
      totals: {
        totalShots: 6,
        shotsOnTarget: 2,
        xg: 0.3,
        xgot: 0.2,
        bigChances: 1,
        shotsInsideBox: 2,
        touchesInBox: 5,
      },
    },
  };
  assert.equal(classifyTrend6075(windows, { statsLevel: 'detailed' }), 'explosive');
});

test('classifyTrend6075 falling when last window quieter than prev', () => {
  const windows = {
    window45_60: { totals: { totalShots: 8 } },
    window70_75: { totals: { totalShots: 1 } },
  };
  assert.equal(classifyTrend6075(windows, { statsLevel: 'basic' }), 'falling');
});

test('classifyTrend6075 growing', () => {
  // prev = activityScore(window65_70 { totalShots: 4 }) = 4 (detailed totals match basic here)
  // last = activityScore(window70_75 { totalShots: 3, sot: 1 }) = 6 — above 4*1.3 but NOT > 4*2 (avoids explosive)
  const windows = {
    window45_60: { totals: { totalShots: 2, shotsOnTarget: 0 } },
    window60_65: { totals: { totalShots: 1, shotsOnTarget: 0 } },
    window65_70: { totals: { totalShots: 4, shotsOnTarget: 0 } },
    window70_75: { totals: { totalShots: 3, shotsOnTarget: 1 } },
  };
  const result = classifyTrend6075(windows, { statsLevel: 'detailed' });
  assert.equal(result, 'growing');
});

test('classifyTrend6075 flat (small diff)', () => {
  // last = prev = activityScore({ totalShots: 2 }) = 2 → |0| <= 1.5 → flat
  const windows = {
    window45_60: { totals: { totalShots: 2, shotsOnTarget: 0 } },
    window65_70: { totals: { totalShots: 2, shotsOnTarget: 0 } },
    window70_75: { totals: { totalShots: 2, shotsOnTarget: 0 } },
  };
  const result = classifyTrend6075(windows, { statsLevel: 'detailed' });
  assert.equal(result, 'flat');
});

test('calculateLateGoalScore80 strong real7080 + sot + bc', () => {
  const score = calculateLateGoalScore80(
    {
      shotsOnTarget: 2,
      xg: 0.3,
      xgot: 0.2,
      bigChances: 1,
      shotsInsideBox: 3,
      corners: 2,
    },
    { realPressureScore70_80: 50, tempoTrend70_80: 'growing' },
  );
  assert.equal(score, 100);
});

test('calculateLateGoalScore80 dry no goal threat', () => {
  const score = calculateLateGoalScore80(
    {
      shotsOnTarget: 0,
      xg: 0.05,
      xgot: 0,
      bigChances: 0,
      shotsInsideBox: 0,
      corners: 1,
    },
    { realPressureScore70_80: 10, tempoTrend70_80: 'flat' },
  );
  assert.equal(score, 0);
});

test('calculateLateGoalScore80 explosive bumps +20', () => {
  const score = calculateLateGoalScore80(
    {
      shotsOnTarget: 1,
      xg: 0.1,
      xgot: 0,
      bigChances: 0,
      shotsInsideBox: 0,
      corners: 0,
    },
    { realPressureScore70_80: 30, tempoTrend70_80: 'explosive' },
  );
  assert.equal(score, 68);
});

test('calculateLateGoalScore80 fake pressure penalty', () => {
  const score = calculateLateGoalScore80(
    { shotsOnTarget: 0, xgot: 0 },
    { realPressureScore70_80: 0, fakePressureScore70_80: 70, tempoTrend70_80: 'flat' },
  );
  assert.equal(score, 0);
});

test('calculateLateGoalScore80 null totals → 0', () => {
  assert.equal(calculateLateGoalScore80(null), 0);
});

test('classifyTrend7080 explosive', () => {
  const windows = {
    window70_75: { totals: { totalShots: 0, shotsOnTarget: 0, corners: 0, xg: 0 } },
    window75_80: { totals: { totalShots: 8, shotsOnTarget: 0, corners: 0, xg: 0 } },
  };
  assert.equal(classifyTrend7080(windows, { statsLevel: 'basic' }), 'explosive');
});

test('classifyTrend7080 falling', () => {
  const windows = {
    window70_75: { totals: { totalShots: 10, shotsOnTarget: 0, corners: 0, xg: 0 } },
    window75_80: { totals: { totalShots: 1, shotsOnTarget: 0, corners: 0, xg: 0 } },
  };
  assert.equal(classifyTrend7080(windows, { statsLevel: 'basic' }), 'falling');
});

test('calculateLateActivationRisk base 20', () => {
  assert.equal(calculateLateActivationRisk({}), 20);
});

test('calculateLateActivationRisk hot1h + strong fav', () => {
  assert.equal(
    calculateLateActivationRisk({
      firstHalfProfile: { isHotButNoGoal: true },
      favoriteContext: { strongLabel: true },
    }),
    50,
  );
});

test('calculateLateActivationRisk red card', () => {
  assert.equal(
    calculateLateActivationRisk({
      hasRedCard: true,
    }),
    50,
  );
});

test('calculateLateActivationRisk explosive trend', () => {
  assert.equal(
    calculateLateActivationRisk({
      tempoTrend: 'explosive',
    }),
    45,
  );
});

test('calculateLateActivationRisk dry-1h bonus', () => {
  assert.equal(
    calculateLateActivationRisk({
      isDryFirstHalf: true,
      dryStateScore: 85,
      realPressureScore: 20,
    }),
    10,
  );
});

test('calculateFullTimeNilNilScore dry detailed', () => {
  const score = calculateFullTimeNilNilScore({
    dryStateScore: 90,
    realPressureScore: 10,
    lateActivationRisk: 15,
    isDryFirstHalf: true,
    isHotButNoGoal: false,
    fakePressureScore: 50,
    dataQualityScore: 90,
  });
  assert.equal(score, 87.5);
});

test('calculateFullTimeNilNilScore hot1h kill', () => {
  const dry = calculateFullTimeNilNilScore({
    dryStateScore: 90,
    realPressureScore: 10,
    lateActivationRisk: 15,
    isDryFirstHalf: true,
    isHotButNoGoal: false,
    fakePressureScore: 50,
    dataQualityScore: 90,
  });
  const hot = calculateFullTimeNilNilScore({
    dryStateScore: 90,
    realPressureScore: 10,
    lateActivationRisk: 15,
    isDryFirstHalf: false,
    isHotButNoGoal: true,
    fakePressureScore: 50,
    dataQualityScore: 90,
  });
  assert.ok(hot < dry);
});

test('dataQualityScore tiers', () => {
  assert.equal(dataQualityScore({ statsLevel: 'detailed', hasXg: true, hasXgot: true }), 90);
  assert.equal(dataQualityScore({ statsLevel: 'detailed', hasXg: true, hasXgot: false }), 80);
  assert.equal(dataQualityScore({ statsLevel: 'basic', hasXg: false, hasXgot: false }), 60);
  assert.equal(dataQualityScore({ statsLevel: 'detailed', hasXg: false, hasXgot: true }), 45);
});

test('applyAiOverlay no AI returns ruleScore unchanged', () => {
  const r = applyAiOverlay({ ruleScore: 78, aiOutput: null, aiConfidence: null, predictionType: 'FT_TM05_FROM_60_75' });
  assert.equal(r.applied, false);
  assert.equal(r.finalScore, 78);
});

test('applyAiOverlay strong agree boosts finalScore', () => {
  const aiOutput = {
    match_state: 'dead',
    favorite_pressure: 'none',
    tempo_state: 'flat',
    recommendation: { action: 'under_candidate', confidence: 'high' },
  };
  const r = applyAiOverlay({ ruleScore: 78, aiOutput, aiConfidence: 0.85, predictionType: 'FT_TM05_FROM_60_75' });
  assert.ok(r.finalScore > 85);
  assert.equal(r.agreementAdjustment, 8);
});

test('applyAiOverlay strong disagree drops finalScore', () => {
  const aiOutput = {
    match_state: 'high_pressure',
    favorite_pressure: 'strong',
    tempo_state: 'explosive',
    recommendation: { action: 'goal_candidate', confidence: 'high' },
  };
  const r = applyAiOverlay({ ruleScore: 78, aiOutput, aiConfidence: 0.85, predictionType: 'FT_TM05_FROM_60_75' });
  assert.ok(r.finalScore < 60);
});

test('isPremiumAiSignal pass', () => {
  const aiOutput = {
    match_state: 'dead',
    favorite_pressure: 'none',
    tempo_state: 'flat',
    recommendation: { action: 'under_candidate', confidence: 'high' },
  };
  const r = isPremiumAiSignal({ finalScore: 88, ruleScore: 80, aiOutput, aiConfidence: 0.75, riskFlags: [] });
  assert.equal(r, true);
});

test('isPremiumAiSignal fail on red_card riskFlag', () => {
  const r = isPremiumAiSignal({
    finalScore: 88,
    ruleScore: 80,
    aiOutput: { match_state: 'dead', favorite_pressure: 'none', tempo_state: 'flat' },
    aiConfidence: 0.8,
    riskFlags: ['red_card'],
  });
  assert.equal(r, false);
});

test('isPremiumAiSignal fail on chaotic match_state', () => {
  const r = isPremiumAiSignal({
    finalScore: 88,
    ruleScore: 80,
    aiOutput: { match_state: 'chaotic', favorite_pressure: 'none', tempo_state: 'flat' },
    aiConfidence: 0.8,
    riskFlags: [],
  });
  assert.equal(r, false);
});

test('evaluateDecision60 mode=detailed_ai when aiUseInModel=true', () => {
  const match = {
    matchId: 'mAi',
    statsLevel: 'detailed',
    snapshots: [],
    aiAnalysis: {
      decision60: {
        useInModel: true,
        output: {
          match_state: 'dead',
          favorite_pressure: 'none',
          tempo_state: 'flat',
          recommendation: { action: 'under_candidate', confidence: 'high' },
          confidence: 0.85,
        },
      },
    },
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 25,
      realPressureScores: { window45_60: 20, window60_70: 20 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
      confidencePenalty: 0,
      favoriteContext: { isStrongContext: false },
      hotFirstHalfDanger: false,
      dryStateScore: 88,
      chaosRisk: 10,
      favoriteDesperationRisk: 10,
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: {
      isHotButNoGoal: false,
      totalXg: 0.4,
      totalXgot: 0.2,
      totalBigChances: 0,
      totalShotsOnTarget: 2,
    },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.modelMode, 'detailed_ai');
  assert.equal(pred.components.aiUseInModel, true);
});

test('evaluateDecision60 mode=detailed when aiUseInModel=false', () => {
  const match = {
    matchId: 'mAi2',
    statsLevel: 'detailed',
    snapshots: [],
    aiAnalysis: {
      decision60: {
        useInModel: false,
        output: {
          match_state: 'dead',
          favorite_pressure: 'none',
          tempo_state: 'flat',
          recommendation: { action: 'under_candidate', confidence: 'high' },
          confidence: 0.85,
        },
      },
    },
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 25,
      realPressureScores: { window45_60: 20, window60_70: 20 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
      confidencePenalty: 0,
      favoriteContext: { isStrongContext: false },
      hotFirstHalfDanger: false,
      dryStateScore: 88,
      chaosRisk: 10,
      favoriteDesperationRisk: 10,
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: {
      isHotButNoGoal: false,
      totalXg: 0.4,
      totalXgot: 0.2,
      totalBigChances: 0,
      totalShotsOnTarget: 2,
    },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.modelMode, 'detailed');
  assert.equal(pred.components.aiUseInModel, false);
});

test('evaluateDecision60 AI premium upgrade sets actionablePrimary=true', () => {
  const match = {
    matchId: 'mAiUp',
    statsLevel: 'detailed',
    snapshots: [],
    aiAnalysis: {
      decision60: {
        useInModel: true,
        output: {
          match_state: 'dead',
          favorite_pressure: 'none',
          tempo_state: 'flat',
          recommendation: { action: 'under_candidate', confidence: 'high' },
          confidence: 0.85,
        },
      },
    },
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 78,
      lateActivationRisk: 35,
      realPressureScores: { window45_60: 28, window60_70: 25 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 1, xg: 0.10, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
      confidencePenalty: 0,
      favoriteContext: { isStrongContext: false },
      hotFirstHalfDanger: false,
      dryStateScore: 80,
      chaosRisk: 10,
      favoriteDesperationRisk: 10,
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: {
      isHotButNoGoal: false,
      totalXg: 0.5,
      totalXgot: 0.3,
      totalBigChances: 0,
      totalShotsOnTarget: 4,
      totalShotsInsideBox: 7,
    },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.tier, 'ai_premium_upgrade');
  assert.equal(pred.predictionType, 'FT_TM05_FROM_60_75');
  assert.equal(pred.actionablePrimary, true);
});

test('buildConfidence detailed_ai cap 0.86', () => {
  const c = buildConfidence({
    finalScore: 95,
    activationThreshold: 75,
    dataQuality: 1,
    reasonsCount: 5,
    modelMode: 'detailed_ai',
  });
  assert.ok(c <= 0.86 && c >= 0.85);
});

test('buildConfidence detailed cap 0.82', () => {
  const c = buildConfidence({
    finalScore: 95,
    activationThreshold: 75,
    dataQuality: 1,
    reasonsCount: 5,
    modelMode: 'detailed',
  });
  assert.ok(c <= 0.82);
});

test('buildConfidence basic cap 0.68', () => {
  const c = buildConfidence({
    finalScore: 95,
    activationThreshold: 75,
    dataQuality: 0.6,
    reasonsCount: 5,
    modelMode: 'basic',
  });
  assert.ok(c <= 0.68);
});

test('buildConfidence redCard penalty about -0.20', () => {
  const common = {
    finalScore: 80,
    activationThreshold: 75,
    dataQuality: 1,
    reasonsCount: 0,
    modelMode: 'detailed',
  };
  const cWith = buildConfidence({ ...common, hasRedCard: true });
  const cWithout = buildConfidence({ ...common, hasRedCard: false });
  assert.ok(cWithout - cWith >= 0.18);
});

test('buildConfidence basic stats penalty about -0.06', () => {
  const common = {
    finalScore: 80,
    activationThreshold: 75,
    dataQuality: 1,
    reasonsCount: 0,
    modelMode: 'detailed',
  };
  const cDetailed = buildConfidence({ ...common, statsLevel: 'detailed' });
  const cBasic = buildConfidence({ ...common, statsLevel: 'basic' });
  assert.ok(cDetailed - cBasic >= 0.055 && cDetailed - cBasic <= 0.065);
});

test('evaluateDecision60 includes mode and useInTelegram flags', () => {
  const match = {
    matchId: 'mAiShape',
    statsLevel: 'detailed',
    snapshots: [],
    aiAnalysis: {
      decision60: {
        useInModel: true,
        output: {
          match_state: 'dead',
          favorite_pressure: 'none',
          tempo_state: 'flat',
          recommendation: { action: 'under_candidate', confidence: 'high' },
          confidence: 0.85,
        },
      },
    },
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 25,
      realPressureScores: { window45_60: 20, window60_70: 20 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
      confidencePenalty: 0,
      favoriteContext: { isStrongContext: false },
      hotFirstHalfDanger: false,
      dryStateScore: 88,
      chaosRisk: 10,
      favoriteDesperationRisk: 10,
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: {
      isHotButNoGoal: false,
      totalXg: 0.4,
      totalXgot: 0.2,
      totalBigChances: 0,
      totalShotsOnTarget: 2,
    },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.mode, 'detailed_ai');
  assert.equal(pred.modelMode, pred.mode);
  assert.equal(typeof pred.useInTelegram, 'boolean');
  assert.equal(typeof pred.useInBacktest, 'boolean');
});

test('evaluateDecision80 includes mode and useInBacktest on NO_BET', () => {
  const match = { matchId: 'm80nb', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {
      window70_80: {
        totals: {
          xg: 0.2,
          xgot: 0.1,
          totalShots: 5,
          shotsOnTarget: 1,
          corners: 2,
        },
      },
    },
    modelScoresRaw: { lateGoalScore80: 10, realPressureScore80: 10, fakePressureScore80: 10 },
    snapshotCount: 5,
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
  };
  const pred = evaluateDecision80(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert.equal(pred.mode, 'detailed');
  assert.equal(pred.modelMode, pred.mode);
  assert.equal(pred.useInBacktest, false);
});

test('predictionLocks NO_BET decision80 has mode detailed and useInBacktest false', () => {
  const match = {
    matchId: 'x',
    predictionLocks: { blockTb80Plus: true },
    statsLevel: 'detailed',
    snapshots: [],
  };
  const pred = evaluateDecision80(match, {
    windows: {},
    modelScoresRaw: {},
    snapshotCount: 0,
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: {},
  });
  assert.equal(pred.mode, 'detailed');
  assert.equal(pred.useInBacktest, false);
});
