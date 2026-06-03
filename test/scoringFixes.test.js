'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COMPONENTS: DRY } = require('../src/scoring/drynessScore');

test('dryFromCards returns 100 (dry) when zero cards, not null', () => {
  const fn = DRY.find(c => c.key === 'cards').fn;
  const snap = { cumulative: { yellowCards: { home: 0, away: 0 }, redCards: { home: 0, away: 0 } } };
  assert.equal(fn(snap), 100);
});
