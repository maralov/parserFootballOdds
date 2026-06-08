'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dsToProbability1H, P_MIN, P_MAX } = require('../src/prediction/dsToProbability1H');

test('null/NaN DS → null probability', () => {
  assert.equal(dsToProbability1H(null), null);
  assert.equal(dsToProbability1H(NaN), null);
});

test('monotone increasing in DS', () => {
  assert.ok(dsToProbability1H(80) > dsToProbability1H(60));
  assert.ok(dsToProbability1H(95) >= dsToProbability1H(85));
});

test('clamped to [P_MIN, P_MAX]', () => {
  assert.equal(dsToProbability1H(0), P_MIN);          // lower clamp engages
  assert.ok(dsToProbability1H(100) <= P_MAX);          // never exceeds ceiling
  assert.ok(dsToProbability1H(100) > dsToProbability1H(50));
  const mid = dsToProbability1H(80);
  assert.ok(mid >= P_MIN && mid <= P_MAX);
});
