'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDS1H, favoriteSide } = require('../src/scoring/drynessScore1H');

function snap(cumulative, possession) {
  return { cumulative, ballPossession: possession || { home: 50, away: 50 } };
}

const favHome = { odds: { isOddsFavorite: { favorite: 'home' } } };

test('favoriteSide reads pre-match favorite', () => {
  assert.equal(favoriteSide(favHome), 'home');
  assert.equal(favoriteSide({ odds: { isOddsFavorite: { favorite: null } } }), null);
  assert.equal(favoriteSide({}), null);
});

test('suppressed favorite → high dryness score', () => {
  const s = snap({
    expectedGoalsXg: { home: 0.05, away: 0.10 },
    shotsOnTarget: { home: 0, away: 1 },
    touchesInOppositionBox: { home: 2, away: 5 },
    bigChances: { home: 0, away: 0 },
    yellowCards: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
  });
  const { score, favorite } = computeDS1H(favHome, s);
  assert.equal(favorite, 'home');
  assert.ok(score >= 80, `expected high score, got ${score}`);
});

test('active favorite → lower dryness score', () => {
  const s = snap({
    expectedGoalsXg: { home: 0.9, away: 0.1 },
    shotsOnTarget: { home: 4, away: 0 },
    touchesInOppositionBox: { home: 18, away: 3 },
    bigChances: { home: 2, away: 0 },
    yellowCards: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
  });
  const dry = computeDS1H(favHome, s).score;
  const calm = computeDS1H(favHome, snap({
    expectedGoalsXg: { home: 0.05, away: 0.10 },
    shotsOnTarget: { home: 0, away: 1 },
    touchesInOppositionBox: { home: 2, away: 5 },
    bigChances: { home: 0, away: 0 },
    yellowCards: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
  })).score;
  assert.ok(dry < calm, `active (${dry}) should score lower than calm (${calm})`);
});

test('missing favorite → fav components null, still scores on match-level stats', () => {
  const noFav = { odds: { isOddsFavorite: { favorite: null } } };
  const { score, components } = computeDS1H(noFav, snap({
    expectedGoalsXg: { home: 0.1, away: 0.1 },
    bigChances: { home: 0, away: 0 },
    yellowCards: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
  }));
  assert.equal(components.fav_xg_suppressed, null);
  assert.ok(score != null);
});

test('normalizes by used weight when stats missing (no crash, 0..100)', () => {
  const { score } = computeDS1H(favHome, snap({}));
  assert.ok(score == null || (score >= 0 && score <= 100));
});
