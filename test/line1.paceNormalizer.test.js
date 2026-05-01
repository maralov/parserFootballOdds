'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computePace, computeIntensityRatio } = require('../src/pipeline/line1/paceNormalizer');

test('computePace: pace_1H = stat_1H / 45', () => {
  const raw1H = { shotsOnTarget: 3, expectedGoalsXg: 0.9, bigChances: 1, touchesInOppositionBox: 18, totalShots: 6 };
  const pace = computePace(raw1H, 45);
  assert.equal(pace.shotsOnTarget, 3 / 45);
  assert.equal(pace.expectedGoalsXg, 0.9 / 45);
  assert.equal(pace.bigChances, 1 / 45);
});

test('computePace: pace_2H(t=55) для 10 хв даних 2H', () => {
  const delta2H = { shotsOnTarget: 1, expectedGoalsXg: 0.2, bigChances: 0, touchesInOppositionBox: 4, totalShots: 2 };
  const pace = computePace(delta2H, 10);
  assert.equal(pace.shotsOnTarget, 0.1);
  assert.equal(pace.expectedGoalsXg, 0.02);
});

test('computePace: повертає null для 0 minutes', () => {
  const pace = computePace({ shotsOnTarget: 1 }, 0);
  assert.equal(pace, null);
});

test('computePace: пропускає null/undefined метрики', () => {
  const pace = computePace({ shotsOnTarget: null, expectedGoalsXg: 0.5 }, 45);
  assert.equal(pace.shotsOnTarget, null);
  assert.equal(pace.expectedGoalsXg, 0.5 / 45);
});

test('computeIntensityRatio: ratio = pace_2H / pace_1H', () => {
  const pace1H = { shotsOnTarget: 0.1, expectedGoalsXg: 0.02 };
  const pace2H = { shotsOnTarget: 0.05, expectedGoalsXg: 0.01 };
  const r = computeIntensityRatio(pace2H, pace1H);
  assert.equal(r.shotsOnTarget, 0.5);
  assert.equal(r.expectedGoalsXg, 0.5);
});

test('computeIntensityRatio: pace_1H=0 → null (уникнути div by 0)', () => {
  const pace1H = { shotsOnTarget: 0 };
  const pace2H = { shotsOnTarget: 0.1 };
  const r = computeIntensityRatio(pace2H, pace1H);
  assert.equal(r.shotsOnTarget, null);
});

test('computeIntensityRatio: обидва 0 → null', () => {
  const pace1H = { shotsOnTarget: 0, expectedGoalsXg: 0 };
  const pace2H = { shotsOnTarget: 0, expectedGoalsXg: 0 };
  const r = computeIntensityRatio(pace2H, pace1H);
  assert.equal(r.shotsOnTarget, null);
  assert.equal(r.expectedGoalsXg, null);
});
