'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { subtractStats, buildStatsMap, CUMULATIVE_STAT_FIELDS } = require('../src/tracker/deltaCalculator');
const { buildAllWindows, buildOpen6075Window, findSnapshotAtOrAfter } = require('../src/computed/windows');
const { evaluateDecision60 } = require('../src/prediction/evaluateDecision60');
const { evaluateDecision80, evaluateTbCandidateQuality } = require('../src/prediction/evaluateDecision80');
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
const { sideWeightedPressure } = require('../src/computed/pressureEngine');
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

test('evaluateDecision60 window45_60 alone no longer triggers rpHardMax', () => {
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
      realPressureScores: { window45_60: 100, window60_70: 20, window65_70: 20, window70_75: 20, windowTracked6075: 20 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(!pred.reasons.includes('real_pressure_too_high'));
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

test('evaluateDecision60 cooling override bypasses lateActivationRisk hard cap', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window45_60: 100,
        window60_70: 57.7,
        window65_70: 31.85,
        window70_75: 6,
        windowTracked6075: 63.7,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 3 },
      tempoTrend6075: 'falling',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: true },
    snapshotCount: 6,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(!pred.reasons.includes('late_activation_risk_too_high'),
    'cooling override повинен зняти lateActivationRisk hard cap');
  assert.ok(!pred.reasons.includes('real_pressure_too_high'),
    'cooling override повинен зняти rpHardMax hard cap');
  assert.ok(pred.reasons.includes('cooling_override_applied'),
    'reasons має містити маркер cooling_override_applied');
});

test('evaluateDecision60 cooling override does not fire when window70_75 >= 15', () => {
  const match = { matchId: 'm1', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window60_70: 57.7,
        window65_70: 30,
        window70_75: 20,
        windowTracked6075: 50,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(pred.reasons.includes('late_activation_risk_too_high'));
  assert.ok(!pred.reasons.includes('cooling_override_applied'));
});

test('evaluateDecision60 cooling override does not fire when window65_70 >= 35', () => {
  const match = { matchId: 'm1', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window60_70: 57.7,
        window65_70: 40,
        window70_75: 5,
        windowTracked6075: 50,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(pred.reasons.includes('late_activation_risk_too_high'));
  assert.ok(!pred.reasons.includes('cooling_override_applied'));
});

test('evaluateDecision60 cooling override does not bypass tempoBad gate', () => {
  const match = { matchId: 'm1', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window60_70: 30,
        window65_70: 25,
        window70_75: 5,
        windowTracked6075: 30,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'growing',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert.ok(pred.reasons.includes('late_activation_tempo_negative'));
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

test('prediction-signals attach final score and outcome after finalize', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signals-'));
  const row = {
    matchId: 'm-final',
    recordedAt: new Date().toISOString(),
    checkpoint: 'decision60',
    signal: predictionSignals.deriveSignal({ predictionType: 'FT_TM05_FROM_60_75' }),
    minute: 64,
    score: '0:0',
    predictionType: 'FT_TM05_FROM_60_75',
    confidence: 0.79,
    modelMode: 'detailed',
    components: {},
    reasons: [],
    riskFlags: [],
  };
  predictionSignals.appendPredictionSignals(tmp, row);
  predictionSignals.attachFinalResult(tmp, {
    matchId: 'm-final',
    final: { score: '0:0' },
    predictions: {
      decision60: {
        predictionAudit: { hit: true },
      },
    },
  });
  const arr = predictionSignals.readSignalsArray(tmp);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].finalScore, '0:0');
  assert.equal(arr[0].predictionHit, true);
  assert.equal(arr[0].predictionOutcome, 'HIT');
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
  const { score } = calculateFullTimeNilNilScore({
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
  const { score: dry } = calculateFullTimeNilNilScore({
    dryStateScore: 90,
    realPressureScore: 10,
    lateActivationRisk: 15,
    isDryFirstHalf: true,
    isHotButNoGoal: false,
    fakePressureScore: 50,
    dataQualityScore: 90,
  });
  const { score: hot } = calculateFullTimeNilNilScore({
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

test('calculateFullTimeNilNilScore all values provided — uses real data, no neutral substitution', () => {
  const { score, dataCompletenessRatio } = calculateFullTimeNilNilScore({
    dryStateScore: 80,
    realPressureScore: 20,
    lateActivationRisk: 25,
    isDryFirstHalf: true,
    isHotButNoGoal: false,
    fakePressureScore: 55,
    dataQualityScore: 90,
  });
  // noRealPressure=80, noLateActivation=75, firstHalfDryness=85, sterilePressure=75 (55>=45 && 20<35), dq=90
  // score = 80*0.30 + 80*0.25 + 75*0.25 + 85*0.10 + 75*0.05 + 90*0.05 = 24+20+18.75+8.5+3.75+4.5 = 79.5
  assert.equal(score, 79.5);
  assert.equal(dataCompletenessRatio, 1);
});

test('calculateFullTimeNilNilScore null pressure and risk — neutral 50, not inflated', () => {
  const { score } = calculateFullTimeNilNilScore({
    dryStateScore: 50,
    realPressureScore: null,
    lateActivationRisk: null,
    isDryFirstHalf: false,
    isHotButNoGoal: false,
    fakePressureScore: 50,
    dataQualityScore: 50,
  });
  // effectiveRealPressure=50, effectiveLateActivation=50 → noRealPressure=50, noLateActivation=50
  // firstHalfDryness=55, sterilePressure=50 (50>=45 but 50 not <35), dq=50
  // score = 50*0.30 + 50*0.25 + 50*0.25 + 55*0.10 + 50*0.05 + 50*0.05 = 15+12.5+12.5+5.5+2.5+2.5 = 50.5
  assert.ok(score >= 50 && score <= 55, `expected score in 50-55 range, got ${score}`);
});

test('calculateFullTimeNilNilScore all 4 primary metrics null — score near 50, dataCompletenessRatio=0', () => {
  const { score, dataCompletenessRatio } = calculateFullTimeNilNilScore({
    dryStateScore: null,
    realPressureScore: null,
    lateActivationRisk: null,
    isDryFirstHalf: false,
    isHotButNoGoal: false,
    fakePressureScore: null,
    dataQualityScore: 50,
  });
  // all effective values = 50: noRealPressure=50, noLateActivation=50, firstHalfDryness=55, sterilePressure=50 (50>=45 but 50 not <35)
  // score = 50*0.30 + 50*0.25 + 50*0.25 + 55*0.10 + 50*0.05 + 50*0.05 = 15+12.5+12.5+5.5+2.5+2.5 = 50.5
  assert.ok(score >= 48 && score <= 55, `expected score near 50, got ${score}`);
  assert.equal(dataCompletenessRatio, 0);
});

test('calculateFullTimeNilNilScore all 4 metrics provided — dataCompletenessRatio=1', () => {
  const { dataCompletenessRatio } = calculateFullTimeNilNilScore({
    dryStateScore: 70,
    realPressureScore: 30,
    lateActivationRisk: 20,
    isDryFirstHalf: true,
    isHotButNoGoal: false,
    fakePressureScore: 40,
    dataQualityScore: 80,
  });
  assert.equal(dataCompletenessRatio, 1);
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

test('evaluateDecision60 useInTelegram true for RISK when confidence >= 0.70 (not actionable)', () => {
  const match = { matchId: 'mRiskTg', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 57,
      lateActivationRisk: 40,
      realPressureScores: { window45_60: 25, window60_70: 25 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
      confidencePenalty: 0,
      favoriteContext: { isStrongContext: false },
      hotFirstHalfDanger: true,
      dryStateScore: 60,
      chaosRisk: 10,
      favoriteDesperationRisk: 10,
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: {
      isHotButNoGoal: false,
      totalXg: 0.6,
      totalXgot: 0.4,
      totalBigChances: 0,
      totalShotsOnTarget: 3,
    },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.predictionType, 'FT_TM05_RISK');
  assert.equal(pred.actionable, false);
  assert.ok(pred.confidence >= 0.70);
  assert.equal(pred.useInTelegram, true);
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

// ── buildOpen6075Window ──────────────────────────────────────────────────────

test('buildOpen6075Window starts at first snapshot >=60, not at 50', () => {
  const c50 = buildStatsMap({ totalShots: 2 }, { totalShots: 1 });
  const c55 = buildStatsMap({ totalShots: 4 }, { totalShots: 2 });
  const c60 = buildStatsMap({ totalShots: 6 }, { totalShots: 3 });
  const c65 = buildStatsMap({ totalShots: 9 }, { totalShots: 5 });
  const c70 = buildStatsMap({ totalShots: 12 }, { totalShots: 7 });

  const match = {
    snapshots: [
      { minute: 50, cumulative: c50 },
      { minute: 55, cumulative: c55 },
      { minute: 60, cumulative: c60 },
      { minute: 65, cumulative: c65 },
      { minute: 70, cumulative: c70 },
    ],
  };

  const win = buildOpen6075Window(match);
  assert.ok(win, 'window should exist');
  assert.equal(win.fromMinute, 60, 'window must start at 60, not 50 or 55');
  assert.equal(win.toMinute, 70);
  // totalShots delta: (12-6) + (7-3) = 6 + 4 = 10
  assert.equal(win.totals.totalShots, (12 - 6) + (7 - 3));
});

test('buildOpen6075Window returns null when no snapshot >=60 exists', () => {
  const c50 = buildStatsMap({ totalShots: 2 }, { totalShots: 1 });
  const c55 = buildStatsMap({ totalShots: 4 }, { totalShots: 2 });

  const match = {
    snapshots: [
      { minute: 50, cumulative: c50 },
      { minute: 55, cumulative: c55 },
    ],
  };

  const win = buildOpen6075Window(match);
  assert.equal(win, null, 'should return null when no snapshot >=60');
});

test('buildOpen6075Window starts at 62 when first snapshot >=60 is at 62', () => {
  const c50 = buildStatsMap({ totalShots: 2 }, { totalShots: 1 });
  const c62 = buildStatsMap({ totalShots: 7 }, { totalShots: 4 });
  const c70 = buildStatsMap({ totalShots: 12 }, { totalShots: 8 });

  const match = {
    snapshots: [
      { minute: 50, cumulative: c50 },
      { minute: 62, cumulative: c62 },
      { minute: 70, cumulative: c70 },
    ],
  };

  const win = buildOpen6075Window(match);
  assert.ok(win, 'window should exist');
  assert.equal(win.fromMinute, 62, 'window must start at 62 (first snapshot >=60)');
  assert.equal(win.toMinute, 70);
});

test('findSnapshotAtOrAfter returns earliest snapshot with minute >= target', () => {
  const s55 = { minute: 55, cumulative: {} };
  const s60 = { minute: 60, cumulative: {} };
  const s65 = { minute: 65, cumulative: {} };
  const snapshots = [s55, s65, s60]; // intentionally unsorted

  const result = findSnapshotAtOrAfter(snapshots, 60);
  assert.equal(result.minute, 60);
});

test('findSnapshotAtOrAfter returns null when no snapshot meets threshold', () => {
  const s50 = { minute: 50, cumulative: {} };
  const s55 = { minute: 55, cumulative: {} };

  const result = findSnapshotAtOrAfter([s50, s55], 60);
  assert.equal(result, null);
});

test('classifyTrend6075 returns unknown when only window45_60 exists (same object fallback)', () => {
  const win = { totals: { totalShots: 3, shotsOnTarget: 1 } };
  const windows = { window45_60: win };
  const result = classifyTrend6075(windows);
  assert.equal(result, 'unknown');
});

test('classifyTrend7080 returns unknown when only window45_60 exists (same object fallback)', () => {
  const win = { totals: { totalShots: 3, shotsOnTarget: 1 } };
  const windows = { window45_60: win };
  const result = classifyTrend7080(windows);
  assert.equal(result, 'unknown');
});

test('classifyTrend6075 classifies normally when window65_70 and window70_75 are distinct', () => {
  const prevWin = { totals: { totalShots: 2, shotsOnTarget: 0, corners: 1 } };
  const lastWin = { totals: { totalShots: 6, shotsOnTarget: 3, corners: 3, xg: 0.4, xgot: 0.2, bigChances: 1, shotsInsideBox: 4, touchesInBox: 8 } };
  const windows = { window65_70: prevWin, window70_75: lastWin };
  const result = classifyTrend6075(windows);
  assert.notEqual(result, 'unknown', 'should classify normally with two distinct windows');
  assert.ok(['explosive', 'growing', 'falling', 'flat'].includes(result), `unexpected result: ${result}`);
});

// ─── evaluateDecision80 AI overlay ───────────────────────────────────────────

function makeComputedForAi80(overrides = {}) {
  return {
    windows: {
      window70_80: {
        totals: {
          totalShots: 6,
          shotsOnTarget: 2,
          corners: 2,
          xg: 0.3,
          xgot: 0.1,
          bigChances: 1,
        },
      },
    },
    modelScoresRaw: {
      lateGoalScore80: overrides.lateGoalScore80 ?? 65,
      realPressureScore80: overrides.realPressureScore80 ?? 55,
      fakePressureScore80: overrides.fakePressureScore80 ?? 20,
    },
    snapshotCount: 5,
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    modelSignals: {},
    ...overrides.computed,
  };
}

test('evaluateDecision80 AI overlay: disabled when no aiAnalysis.decision80', () => {
  const match = { matchId: 'ai80_test1', statsLevel: 'detailed', snapshots: [] };
  const computed = makeComputedForAi80();
  const pred = evaluateDecision80(match, computed);
  assert.equal(pred.aiApplied, false, 'aiApplied should be false when no AI data');
  assert.equal(pred.aiScenarioScore, null, 'aiScenarioScore should be null');
  // predictionType should be set by rules alone (lateGoalScore80=65 → LEAN_TB05_80_PLUS)
  assert.equal(pred.predictionType, 'LEAN_TB05_80_PLUS');
});

test('evaluateDecision80 AI overlay: LEAN upgrades to PRIMARY with high_pressure + strong + confidence >= 0.65', () => {
  // lateGoalScore80=65 → LEAN_TB05_80_PLUS rule; AI high_pressure + strong should upgrade
  // high_pressure: rawAiScore = 15*0.45 + 15*0.35 + 35*0.20 = 6.75 + 5.25 + 7.0 = 19
  // tbAiScore = 100 - 19 = 81; aiWeight=0.15 (confidence=0.7)
  // blendedLate = 65 * 0.85 + 81 * 0.15 = 55.25 + 12.15 = 67.4 → clampedLate = 67.4 < 68
  // So we need lateGoalScore80 high enough → use 68
  const match = {
    matchId: 'ai80_test2',
    statsLevel: 'detailed',
    snapshots: [],
    aiAnalysis: {
      decision80: {
        useInModel: true,
        confidence: 0.7,
        output: {
          match_state: 'high_pressure',
          favorite_pressure: 'strong',
          tempo_state: 'growing',
        },
      },
    },
  };
  // lateGoalScore80=68: rule gives LEAN (68 >= 60, < 72); AI upgrades to PRIMARY
  const computed = makeComputedForAi80({ lateGoalScore80: 68 });
  const pred = evaluateDecision80(match, computed);
  assert.equal(pred.aiApplied, true, 'aiApplied should be true');
  assert.equal(pred.predictionType, 'TB05_80_PLUS', 'LEAN should be upgraded to PRIMARY');
  assert.ok(pred.reasons.some(r => r.startsWith('ai_upgrade_lean_to_primary')), 'upgrade reason should be in reasons');
});

test('evaluateDecision80 AI overlay: TB05_80_PLUS blocked to NO_BET when dead + none pressure', () => {
  // lateGoalScore80=75 → TB05_80_PLUS rule; AI dead + none should block
  const match = {
    matchId: 'ai80_test3',
    statsLevel: 'detailed',
    snapshots: [],
    aiAnalysis: {
      decision80: {
        useInModel: true,
        confidence: 0.8,
        output: {
          match_state: 'dead',
          favorite_pressure: 'none',
          tempo_state: 'falling',
        },
      },
    },
  };
  const computed = makeComputedForAi80({ lateGoalScore80: 75, realPressureScore80: 62 });
  const pred = evaluateDecision80(match, computed);
  assert.equal(pred.aiApplied, true, 'aiApplied should be true');
  assert.equal(pred.predictionType, 'NO_BET', 'TB should be blocked to NO_BET');
  assert.ok(pred.reasons.some(r => r.startsWith('ai_block_tb')), 'block reason should be in reasons');
});

test('evaluateDecision80 AI overlay: balanced match_state — no upgrade, no block, aiApplied=true', () => {
  // lateGoalScore80=65 → LEAN; AI balanced → no change, but aiApplied=true and ai_confirmed reason added
  const match = {
    matchId: 'ai80_test4',
    statsLevel: 'detailed',
    snapshots: [],
    aiAnalysis: {
      decision80: {
        useInModel: true,
        confidence: 0.7,
        output: {
          match_state: 'balanced',
          favorite_pressure: 'moderate',
          tempo_state: 'flat',
        },
      },
    },
  };
  const computed = makeComputedForAi80({ lateGoalScore80: 65 });
  const pred = evaluateDecision80(match, computed);
  assert.equal(pred.aiApplied, true, 'aiApplied should be true');
  assert.equal(pred.predictionType, 'LEAN_TB05_80_PLUS', 'predictionType should remain LEAN_TB05_80_PLUS');
  assert.ok(pred.reasons.some(r => r.startsWith('ai_confirmed')), 'ai_confirmed reason should be added');
  assert.ok(pred.aiScenarioScore != null, 'aiScenarioScore should be set');
});

// ─── pressureEngine sideWeightedPressure weights ─────────────────────────────

test('pressureEngine sideWeightedPressure weights: xG-driven match beats high-shots no-xG match', () => {
  const xgDriven = {
    totalShots: { home: 2 },
    shotsOnTarget: { home: 1 },
    cornerKicks: { home: 1 },
    expectedGoalsXg: { home: 0.8 },
    xgOnTargetXgot: { home: 0 },
    shotsInsideTheBox: { home: 0 },
    touchesInOppositionBox: { home: 0 },
    bigChances: { home: 0 },
  };

  const highShotsNoXg = {
    totalShots: { home: 8 },
    shotsOnTarget: { home: 2 },
    cornerKicks: { home: 3 },
    expectedGoalsXg: { home: 0 },
    xgOnTargetXgot: { home: 0 },
    shotsInsideTheBox: { home: 0 },
    touchesInOppositionBox: { home: 0 },
    bigChances: { home: 0 },
  };

  const scoreXg = sideWeightedPressure(xgDriven, 'home');
  const scoreShots = sideWeightedPressure(highShotsNoXg, 'home');
  assert.ok(
    scoreXg > scoreShots,
    `xG-driven score (${scoreXg}) should exceed high-shots no-xG score (${scoreShots})`,
  );
});

test('pressureEngine sideWeightedPressure weights: zero-input returns 0', () => {
  assert.equal(sideWeightedPressure(null, 'home'), 0);
});

// ─── evaluateDecision80 odds and quality ──────────────────────────────────────

function makeMatchForOddsTest(drawOdds, lateGoalScore80 = 50) {
  const match = {
    matchId: 'odds_test',
    statsLevel: 'detailed',
    snapshots: [],
  };
  if (drawOdds != null) {
    match.odds = { draw: drawOdds };
  }
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
    modelScoresRaw: {
      lateGoalScore80,
      realPressureScore80: 20,
      fakePressureScore80: 10,
    },
    snapshotCount: 5,
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    modelSignals: {},
  };
  return { match, computed };
}

test('evaluateDecision80 odds: draw > 4.0 increases effectiveLate by 5', () => {
  const { match: mNo, computed: cNo } = makeMatchForOddsTest(null, 60);
  const { match: mOpen, computed: cOpen } = makeMatchForOddsTest(4.5, 60);

  const predNo = evaluateDecision80(mNo, cNo);
  const predOpen = evaluateDecision80(mOpen, cOpen);

  // effectiveLate is stored in components.lateGoalScore80 (before AI, no AI here)
  assert.equal(predOpen.components.lateGoalScore80 - predNo.components.lateGoalScore80, 5,
    'open match draw > 4.0 should boost lateGoalScore80 by 5');
  assert.equal(predOpen.components.oddsAdjustment, 5);
  assert.ok(predOpen.reasons.some(r => r.startsWith('odds_open_match')));
});

test('evaluateDecision80 odds: draw < 3.0 decreases effectiveLate by 5', () => {
  const { match: mNo, computed: cNo } = makeMatchForOddsTest(null, 60);
  const { match: mClosed, computed: cClosed } = makeMatchForOddsTest(2.5, 60);

  const predNo = evaluateDecision80(mNo, cNo);
  const predClosed = evaluateDecision80(mClosed, cClosed);

  assert.equal(predNo.components.lateGoalScore80 - predClosed.components.lateGoalScore80, 5,
    'closed match draw < 3.0 should suppress lateGoalScore80 by 5');
  assert.equal(predClosed.components.oddsAdjustment, -5);
  assert.ok(predClosed.reasons.some(r => r.startsWith('odds_closed_match')));
});

test('evaluateDecision80 odds: no draw odds → no adjustment', () => {
  const { match, computed } = makeMatchForOddsTest(null, 60);
  const pred = evaluateDecision80(match, computed);
  assert.equal(pred.components.oddsAdjustment, 0);
  assert.ok(!pred.reasons.some(r => r.startsWith('odds_')));
});

test('evaluateTbCandidateQuality: all 3 signals → score 3', () => {
  const w7080Totals = { xg: 0.7, shotsOnTarget: 4 };
  const modelSignals = { tempoTrend70_80: 'growing' };
  const aiOutput80 = {
    pressure_team: 'home',
    pressure_quality: 'real',
    motivation_asymmetry: {
      team_that_must_score: 'home',
      strength: 'high',
    },
  };
  const result = evaluateTbCandidateQuality(w7080Totals, modelSignals, aiOutput80);
  assert.equal(result.score, 3, 'all 3 components should score 3');
  assert.equal(result.reasons.length, 3);
});

test('evaluateTbCandidateQuality: no signals → score 0', () => {
  const w7080Totals = { xg: 0.1, shotsOnTarget: 0 };
  const modelSignals = { tempoTrend70_80: 'flat' };
  const aiOutput80 = {
    pressure_team: 'none',
    pressure_quality: 'fake',
    motivation_asymmetry: {
      team_that_must_score: 'none',
      strength: 'low',
    },
  };
  const result = evaluateTbCandidateQuality(w7080Totals, modelSignals, aiOutput80);
  assert.equal(result.score, 0, 'no qualifying signals should give score 0');
  assert.equal(result.reasons.length, 0);
});
