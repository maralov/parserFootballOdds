'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tm05_1hOddsAt } = require('../src/scoring/oddsTable');

test('1H odds at exact breakpoints', () => {
  assert.equal(tm05_1hOddsAt(20), 3.00);
  assert.equal(tm05_1hOddsAt(25), 2.60);
  assert.equal(tm05_1hOddsAt(30), 2.20);
  assert.equal(tm05_1hOddsAt(35), 1.80);
});

test('1H odds floor to nearest lower breakpoint', () => {
  assert.equal(tm05_1hOddsAt(27), 2.60);
  assert.equal(tm05_1hOddsAt(34), 2.20);
});

test('1H odds below 20 clamp to 20 value', () => {
  assert.equal(tm05_1hOddsAt(18), 3.00);
});

test('1H odds past 35 are null (line closed)', () => {
  assert.equal(tm05_1hOddsAt(36), null);
  assert.equal(tm05_1hOddsAt(45), null);
});

test('1H odds invalid input is null', () => {
  assert.equal(tm05_1hOddsAt(null), null);
  assert.equal(tm05_1hOddsAt(NaN), null);
});
