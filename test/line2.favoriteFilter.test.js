'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectFavorite } = require('../src/pipeline/line2/favoriteFilter');

test('home favorite ≤1.8 → eligible', () => {
  const r = detectFavorite({ home: 1.5, draw: 4.0, away: 6.0 }, 1.8);
  assert.equal(r.eligible, true);
  assert.equal(r.favoriteSide, 'home');
  assert.equal(r.favoriteOdds, 1.5);
});

test('away favorite ≤1.8 → eligible', () => {
  const r = detectFavorite({ home: 6.0, draw: 4.0, away: 1.6 }, 1.8);
  assert.equal(r.eligible, true);
  assert.equal(r.favoriteSide, 'away');
  assert.equal(r.favoriteOdds, 1.6);
});

test('odds = 1.85 (>1.8) → not eligible', () => {
  const r = detectFavorite({ home: 1.85, draw: 3.6, away: 4.5 }, 1.8);
  assert.equal(r.eligible, false);
  assert.equal(r.favoriteSide, 'home');
  assert.match(r.reason, /favorite odds=1.85 > 1.8/);
});

test('no odds → not eligible', () => {
  const r = detectFavorite(null, 1.8);
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no odds 1X2');
});

test('invalid odds (≤1) → not eligible', () => {
  const r = detectFavorite({ home: 0.5, draw: 1.0, away: 2.0 }, 1.8);
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'invalid odds 1X2');
});

test('equal odds → home wins tie', () => {
  const r = detectFavorite({ home: 1.7, draw: 3.5, away: 1.7 }, 1.8);
  assert.equal(r.favoriteSide, 'home');
  assert.equal(r.eligible, true);
});
