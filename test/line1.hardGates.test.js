'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyHardGates } = require('../src/pipeline/line1/hardGates');

test('applyHardGates: червона картка → SKIP', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 1, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 0.8 },
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, true);
  assert.ok(r.reason.toLowerCase().includes('red card'));
});

test('applyHardGates: xG burst (ratio≥1.5) → SKIP', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 1.6 },
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, true);
  assert.ok(r.reason.toLowerCase().includes('xg'));
});

test('applyHardGates: BC delta ≥1 → SKIP', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 0.6 },
    bcDeltaLast: 1,
    scoreChanged: false,
  });
  assert.equal(r.skip, true);
  assert.ok(r.reason.toLowerCase().includes('bc'));
});

test('applyHardGates: scoreChanged → SKIP', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 0.5 },
    bcDeltaLast: 0,
    scoreChanged: true,
  });
  assert.equal(r.skip, true);
  assert.ok(r.reason.toLowerCase().includes('score'));
});

test('applyHardGates: чисті inputs → no skip', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 0.6 },
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, false);
  assert.equal(r.reason, null);
});

test('applyHardGates: null incidents → no skip', () => {
  const r = applyHardGates({
    incidents: null,
    intensityRatioLast: { expectedGoalsXg: 0.6 },
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, false);
});

test('applyHardGates: null intensityRatioLast → no xG skip', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: null,
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, false);
});
