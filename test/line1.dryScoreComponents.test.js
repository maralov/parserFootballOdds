'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dryFromIntensity } = require('../src/pipeline/line1/dryScoreComponents');

test('dryFromIntensity: повністю порожній half (нулі) → ≥0.9', () => {
  const raw = { shotsOnTarget: 0, expectedGoalsXg: 0, bigChances: 0, touchesInOppositionBox: 0 };
  const score = dryFromIntensity(raw);
  assert.ok(score >= 0.9, `expected ≥0.9 for empty half, got ${score}`);
});

test('dryFromIntensity: дуже інтенсивний half → ≤0.15', () => {
  const raw = { shotsOnTarget: 8, expectedGoalsXg: 2.0, bigChances: 4, touchesInOppositionBox: 25 };
  const score = dryFromIntensity(raw);
  assert.ok(score <= 0.15, `expected ≤0.15 for intensive half, got ${score}`);
});

test('dryFromIntensity: середній half → 0.3-0.7', () => {
  const raw = { shotsOnTarget: 3, expectedGoalsXg: 0.8, bigChances: 1, touchesInOppositionBox: 12 };
  const score = dryFromIntensity(raw);
  assert.ok(score >= 0.3 && score <= 0.7, `expected mid-range, got ${score}`);
});

test('dryFromIntensity: null/відсутні поля → не падати, повернути finite', () => {
  const raw = { shotsOnTarget: null, expectedGoalsXg: 0.5 };
  const score = dryFromIntensity(raw);
  assert.ok(Number.isFinite(score), 'score має бути finite навіть з null-полями');
});

test('dryFromIntensity: null raw → 0.5 (нейтрально)', () => {
  assert.equal(dryFromIntensity(null), 0.5);
});
