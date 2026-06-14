'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { passesFavoriteGate1H } = require('../src/scoring/favoriteGate1H');

const FAV_HOME = (favOdd) => ({
  home: favOdd, draw: 3.5, away: 5.0,
  isOddsFavorite: { favorite: 'home', margin: 1.8 - favOdd, threshold: 1.8 },
});

const FAV_AWAY = (favOdd) => ({
  home: 5.0, draw: 3.5, away: favOdd,
  isOddsFavorite: { favorite: 'away', margin: 1.8 - favOdd, threshold: 1.8 },
});

test('no clear favorite → blocked', () => {
  const r = passesFavoriteGate1H({ home: 2.5, draw: 3.3, away: 2.6, isOddsFavorite: { favorite: null } }, { LIVE_1H_FAV_ODDS_MIN: 0 });
  assert.equal(r.pass, false);
  assert.equal(r.reason, 'no_favorite');
});

test('min disabled (0) → any favorite passes', () => {
  const r = passesFavoriteGate1H(FAV_HOME(1.10), { LIVE_1H_FAV_ODDS_MIN: 0 });
  assert.equal(r.pass, true);
});

test('heavy favorite below min → blocked as too strong', () => {
  const r = passesFavoriteGate1H(FAV_HOME(1.30), { LIVE_1H_FAV_ODDS_MIN: 1.45 });
  assert.equal(r.pass, false);
  assert.equal(r.reason, 'fav_too_strong');
  assert.equal(r.favOdd, 1.30);
});

test('weaker favorite above min → passes', () => {
  const r = passesFavoriteGate1H(FAV_HOME(1.70), { LIVE_1H_FAV_ODDS_MIN: 1.45 });
  assert.equal(r.pass, true);
  assert.equal(r.favorite, 'home');
});

test('favorite exactly at min → passes (inclusive lower bound)', () => {
  const r = passesFavoriteGate1H(FAV_HOME(1.45), { LIVE_1H_FAV_ODDS_MIN: 1.45 });
  assert.equal(r.pass, true);
});

test('away-only on, home favorite → blocked as not-away', () => {
  const r = passesFavoriteGate1H(FAV_HOME(1.70), { LIVE_1H_AWAY_FAV_ONLY: true });
  assert.equal(r.pass, false);
  assert.equal(r.reason, 'fav_not_away');
});

test('away-only on, away favorite → passes', () => {
  const r = passesFavoriteGate1H(FAV_AWAY(1.70), { LIVE_1H_AWAY_FAV_ONLY: true });
  assert.equal(r.pass, true);
  assert.equal(r.favorite, 'away');
});

test('away-only off → home favorite still passes', () => {
  const r = passesFavoriteGate1H(FAV_HOME(1.70), { LIVE_1H_AWAY_FAV_ONLY: false });
  assert.equal(r.pass, true);
});

test('strength check precedes away check: away fav too strong → fav_too_strong', () => {
  const r = passesFavoriteGate1H(FAV_AWAY(1.30), { LIVE_1H_FAV_ODDS_MIN: 1.45, LIVE_1H_AWAY_FAV_ONLY: true });
  assert.equal(r.pass, false);
  assert.equal(r.reason, 'fav_too_strong');
});
