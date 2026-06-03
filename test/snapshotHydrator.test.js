'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hydrateSnapshot, hydrateAll } = require('../src/tracker/snapshotHydrator');

const baseline1H = { expectedGoalsXg: { home: 0.2, away: 0.1 } };
const prev = { cumulative: { expectedGoalsXg: { home: 0.3, away: 0.2 } } };
const cur  = { cumulative: { expectedGoalsXg: { home: 0.5, away: 0.4 } } };

test('hydrateSnapshot computes since2H = cumulative - baseline1H', () => {
  const h = hydrateSnapshot(cur, baseline1H, prev);
  assert.ok(Math.abs(h.since2H.expectedGoalsXg.home - 0.3) < 1e-9); // 0.5-0.2
  assert.ok(Math.abs(h.since2H.expectedGoalsXg.away - 0.3) < 1e-9); // 0.4-0.1
});

test('hydrateSnapshot computes delta = cumulative - prev', () => {
  const h = hydrateSnapshot(cur, baseline1H, prev);
  assert.ok(Math.abs(h.delta.expectedGoalsXg.home - 0.2) < 1e-9); // 0.5-0.3
});

test('hydrateSnapshot with no prev → delta null', () => {
  const h = hydrateSnapshot(cur, baseline1H, null);
  assert.equal(h.delta, null);
});

test('hydrateAll chains prev correctly', () => {
  const out = hydrateAll([prev, cur], baseline1H);
  assert.equal(out[0].delta, null);
  assert.ok(out[1].delta.expectedGoalsXg.home != null);
});
