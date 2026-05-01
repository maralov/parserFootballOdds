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

const {
  trajectoryDry, oddsDry, prematchDry,
} = require('../src/pipeline/line1/dryScoreComponents');

test('trajectoryDry: 2H темп вдвічі менший за 1H (ratio=0.5) → ≥0.9', () => {
  const ratios = { expectedGoalsXg: 0.5, shotsOnTarget: 0.5, touchesInOppositionBox: 0.5 };
  assert.ok(trajectoryDry(ratios) >= 0.9);
});

test('trajectoryDry: 2H = 1H темп (ratio=1.0) → 0.4-0.6', () => {
  const ratios = { expectedGoalsXg: 1.0, shotsOnTarget: 1.0, touchesInOppositionBox: 1.0 };
  const s = trajectoryDry(ratios);
  assert.ok(s >= 0.4 && s <= 0.6, `got ${s}`);
});

test('trajectoryDry: 2H розкривається (ratio=1.5) → ≤0.1', () => {
  const ratios = { expectedGoalsXg: 1.5, shotsOnTarget: 1.5, touchesInOppositionBox: 1.5 };
  assert.ok(trajectoryDry(ratios) <= 0.1);
});

test('trajectoryDry: null → 0.3 (defensive default)', () => {
  assert.equal(trajectoryDry(null), 0.3);
});

test('trajectoryDry: частково null поля → використовує наявні', () => {
  const ratios = { expectedGoalsXg: 0.5, shotsOnTarget: null, touchesInOppositionBox: null };
  assert.ok(Number.isFinite(trajectoryDry(ratios)));
});

test('oddsDry: нічийний матч (однакові кф) → ≥0.4', () => {
  const odds = { home: 2.8, draw: 2.9, away: 2.8 };
  assert.ok(oddsDry(odds) >= 0.4);
});

test('oddsDry: явний фаворит → ≤0.4', () => {
  const odds = { home: 1.4, draw: 4.5, away: 7.0 };
  assert.ok(oddsDry(odds) <= 0.4);
});

test('oddsDry: null → 0.4', () => {
  assert.equal(oddsDry(null), 0.4);
});

test('prematchDry: обидві команди low-totals + H2H low → ≥0.9', () => {
  const agg = {
    home: { n: 5, avgTotalGoals: 1.6 },
    away: { n: 5, avgTotalGoals: 1.8 },
    mutual: { n: 3, avgTotalGoals: 2.0 },
  };
  assert.ok(prematchDry(agg) >= 0.9);
});

test('prematchDry: high-scoring teams → 0', () => {
  const agg = {
    home: { n: 5, avgTotalGoals: 3.4 },
    away: { n: 5, avgTotalGoals: 3.0 },
    mutual: { n: 3, avgTotalGoals: 3.5 },
  };
  assert.equal(prematchDry(agg), 0);
});

test('prematchDry: null → 0.3', () => {
  assert.equal(prematchDry(null), 0.3);
});
