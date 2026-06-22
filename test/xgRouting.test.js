'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { routeByXg } = require('../src/prediction/xgRouting');

test('routeByXg - xG=0.10 (≤0.15) → under', () => {
  const result = routeByXg(0.10, {});
  assert.equal(result, 'under');
});

test('routeByXg - xG=0.15 (boundary) → under', () => {
  const result = routeByXg(0.15, {});
  assert.equal(result, 'under');
});

test('routeByXg - xG=0.30 (in 0.15–0.50 zone) → over', () => {
  const result = routeByXg(0.30, {});
  assert.equal(result, 'over');
});

test('routeByXg - xG=0.50 (boundary) → over', () => {
  const result = routeByXg(0.50, {});
  assert.equal(result, 'over');
});

test('routeByXg - xG=0.70 (>0.50) → skip', () => {
  const result = routeByXg(0.70, {});
  assert.equal(result, 'skip');
});

test('routeByXg - xG=null → skip', () => {
  const result = routeByXg(null, {});
  assert.equal(result, 'skip');
});

test('routeByXg - xG=undefined → skip', () => {
  const result = routeByXg(undefined, {});
  assert.equal(result, 'skip');
});

test('routeByXg - custom thresholds: LIVE_1H_XG_UNDER_MAX=0.20, LIVE_1H_XG_OVER_MAX=0.40', () => {
  const cfg = {
    LIVE_1H_XG_UNDER_MAX: 0.20,
    LIVE_1H_XG_OVER_MAX: 0.40,
  };

  // xG=0.18 → 'under'
  assert.equal(routeByXg(0.18, cfg), 'under');

  // xG=0.35 → 'over'
  assert.equal(routeByXg(0.35, cfg), 'over');

  // xG=0.45 → 'skip'
  assert.equal(routeByXg(0.45, cfg), 'skip');
});

test('routeByXg - empty cfg ({}) uses defaults', () => {
  // Verify defaults are applied: LIVE_1H_XG_UNDER_MAX=0.15, LIVE_1H_XG_OVER_MAX=0.50
  assert.equal(routeByXg(0.15, {}), 'under');
  assert.equal(routeByXg(0.30, {}), 'over');
  assert.equal(routeByXg(0.50, {}), 'over');
});
