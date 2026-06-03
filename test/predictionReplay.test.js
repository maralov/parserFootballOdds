'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSamplesFromStore } = require('../scripts/predictionReplay');

const store = {
  m1: {
    final: { scoreHome: 0, scoreAway: 0 },
    predictions: {
      tm05: { phase: 'signal', pNoGoal: 0.6, confidence: 0.7, odds: 2.0 },
      tb05: null,
    },
  },
  m2: {
    final: { scoreHome: 1, scoreAway: 0 },
    predictions: {
      tm05: { phase: 'gate_blocked', pNoGoal: 0.5, confidence: 0.6, odds: 2.0 },
      tb05: { phase: 'signal', pGoal: 0.55, confidence: 0.7, odds: 1.9 },
    },
  },
};

test('buildSamplesFromStore extracts tm05 samples with correct outcomes', () => {
  const { tm05 } = buildSamplesFromStore(store);
  // m1: final 0:0 → tm05 outcome 1; m2: final 1:0 → tm05 outcome 0
  const m1 = tm05.find(s => s.matchId === 'm1');
  const m2 = tm05.find(s => s.matchId === 'm2');
  assert.equal(m1.outcome, 1);
  assert.equal(m2.outcome, 0);
  assert.equal(m1.p, 0.6);
});

test('buildSamplesFromStore extracts tb05 outcome from goal presence', () => {
  const { tb05 } = buildSamplesFromStore(store);
  const m2 = tb05.find(s => s.matchId === 'm2');
  assert.equal(m2.outcome, 1); // 1:0 → at least one goal
});
