'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateEvGate } = require('../src/prediction/evGate');

test('high prob + full confidence passes when EV >= min', () => {
  const r = evaluateEvGate({ probability: 0.6, confidence: 1.0, odds: 2.0, baseline: 0.45 });
  assert.equal(r.pass, true);
  assert.ok(r.ev >= 1.10);
});

test('low confidence shrinks p toward baseline and can block', () => {
  // p=0.6 conf=0.0 → pAdj=baseline 0.45 → 0.45*2.0=0.9 < 1.10 → block
  const r = evaluateEvGate({ probability: 0.6, confidence: 0.0, odds: 2.0, baseline: 0.45 });
  assert.equal(r.pass, false);
  assert.equal(r.reason, 'negative_ev');
  assert.equal(r.pAdj, 0.45);
});

test('decision field is ignored (no decision_not_bet path)', () => {
  const r = evaluateEvGate({ probability: 0.7, confidence: 1.0, odds: 2.0, baseline: 0.45, decision: 'SKIP' });
  assert.equal(r.pass, true);
});

test('invalid odds blocks', () => {
  const r = evaluateEvGate({ probability: 0.7, confidence: 1.0, odds: null, baseline: 0.45 });
  assert.equal(r.reason, 'odds_invalid');
});
