'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { subtractStats, buildStatsMap, CUMULATIVE_STAT_FIELDS } = require('../src/tracker/deltaCalculator');
const { buildAllWindows } = require('../src/computed/windows');
const { evaluateDecision80 } = require('../src/prediction/evaluateDecision80');
const { updateComputed } = require('../src/computed/updateComputed');
const predictionSignals = require('../src/store/predictionSignals');
const { buildFirstHalfProfile } = require('../src/computed/firstHalfProfile');
const matchStore = require('../src/store/matchStore');
const { maybeRunPredictionPipeline } = require('../src/prediction/runLivePrediction');
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
