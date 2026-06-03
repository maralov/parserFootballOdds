'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { brier, logLoss, roiFlat, roiKelly } = require('../src/prediction/calibrationMetrics');

test('brier score: perfect prediction = 0', () => {
  assert.equal(brier([{ p: 1, outcome: 1 }, { p: 0, outcome: 0 }]), 0);
});

test('brier score: worst prediction = 1', () => {
  assert.equal(brier([{ p: 0, outcome: 1 }, { p: 1, outcome: 0 }]), 1);
});

test('logLoss penalizes confident wrong predictions', () => {
  const good = logLoss([{ p: 0.9, outcome: 1 }]);
  const bad = logLoss([{ p: 0.1, outcome: 1 }]);
  assert.ok(bad > good);
});

test('roiFlat: 1 win at odds 2.0, 1 loss = 0', () => {
  // stake 1 each: win returns +1.0 (2.0-1), loss -1.0 → net 0 over 2 bets
  assert.equal(roiFlat([{ odds: 2.0, outcome: 1 }, { odds: 2.0, outcome: 0 }]), 0);
});

test('roiKelly: positive edge yields positive roi', () => {
  const r = roiKelly([{ p: 0.6, odds: 2.0, outcome: 1 }, { p: 0.6, odds: 2.0, outcome: 1 }]);
  assert.ok(r > 0);
});
