'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tm05_1hOddsAt, tb05_1hOddsAt } = require('../src/scoring/oddsTable');

test('tm05_1hOddsAt: draw-bucketed under odds (favorite-aware)', () => {
  assert.equal(tm05_1hOddsAt(27, { draw: 2.22 }), 1.45);
  assert.equal(tm05_1hOddsAt(27, { draw: 2.9 }),  1.55);
  assert.equal(tm05_1hOddsAt(27, { draw: 3.58 }), 1.70);
  assert.equal(tm05_1hOddsAt(27, { draw: 3.94 }), 1.95);
});
test('tm05_1hOddsAt: fallback base when no draw odds', () => {
  assert.equal(tm05_1hOddsAt(27, {}), 1.60);
  assert.equal(tm05_1hOddsAt(27, undefined), 1.60);
});
test('tm05_1hOddsAt: line closes after the decision window', () => {
  assert.equal(tm05_1hOddsAt(40, { draw: 3.0 }), null);
  assert.equal(tm05_1hOddsAt(null, { draw: 3.0 }), null);
});
test('tb05_1hOddsAt: over odds INCREASE with minute (goal window shrinks)', () => {
  assert.equal(tb05_1hOddsAt(27), 1.80);
  assert.equal(tb05_1hOddsAt(30), 2.10);
  assert.equal(tb05_1hOddsAt(35), 2.50);
  assert.equal(tb05_1hOddsAt(40), null);
});
