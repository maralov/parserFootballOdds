'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLine2LateSurge } = require('../src/pipeline/line2/lateSurgeEngine');

function snap(min, raw, score = { home: '0', away: '0' }) {
  return { matchMinute: min, raw2H: raw, score };
}

const baseFeatures = (minute) => ({
  minute,
  odds1X2: { home: 1.5, draw: 4.0, away: 6.5 },
  league: 'TEST',
});

const baseSnaps = [
  snap(60, { expectedGoalsXg: 0.2, shotsOnTarget: 1, bigChances: 0, touchesInOppositionBox: 8, totalShots: 3 }),
  snap(75, { expectedGoalsXg: 0.4, shotsOnTarget: 2, bigChances: 0, touchesInOppositionBox: 12, totalShots: 4 }),
  snap(80, { expectedGoalsXg: 0.7, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 16, totalShots: 6 }),
  snap(85, { expectedGoalsXg: 1.1, shotsOnTarget: 4, bigChances: 2, touchesInOppositionBox: 22, totalShots: 9 }),
];

test('happy path: 0:0, 85, favorite 1.5, surge → OVER_0_5', () => {
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures(85),
    snapshots: baseSnaps,
    incidents: { homeRedCards: 0, awayRedCards: 0 },
  });
  assert.equal(r.bet, 'OVER_0_5');
  assert.equal(r.signalEligible, true);
  assert.equal(r.favoriteSide, 'home');
  assert.equal(r.favoriteOdds, 1.5);
});

test('not 0:0 → SKIP', () => {
  const r = evaluateLine2LateSurge({
    match: { score: { home: '1', away: '0' } },
    features: baseFeatures(85),
    snapshots: baseSnaps,
    incidents: null,
  });
  assert.equal(r.bet, 'SKIP');
  assert.match(r.reason, /score not 0:0/);
});

test('minute < 75 → SKIP (before window)', () => {
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures(70),
    snapshots: baseSnaps,
    incidents: null,
  });
  assert.equal(r.bet, 'SKIP');
  assert.match(r.reason, /before window/);
});

test('minute > 90 → SKIP (after window)', () => {
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures(91),
    snapshots: baseSnaps,
    incidents: null,
  });
  assert.equal(r.bet, 'SKIP');
  assert.match(r.reason, /after window/);
});

test('no favorite (odds > 1.8) → SKIP', () => {
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: { minute: 85, odds1X2: { home: 2.5, draw: 3.2, away: 2.8 } },
    snapshots: baseSnaps,
    incidents: null,
  });
  assert.equal(r.bet, 'SKIP');
  assert.match(r.reason, /favorite odds/);
});

test('red card to favorite → SKIP', () => {
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures(85),  // home is favorite
    snapshots: baseSnaps,
    incidents: { homeRedCards: 1, awayRedCards: 0 },
  });
  assert.equal(r.bet, 'SKIP');
  assert.match(r.reason, /red card to favorite/);
});

test('red card to underdog → BOOST signal (relaxed gates)', () => {
  // Менш виражений surge (не пройшов би при стандартних порогах)
  const milderSnaps = [
    snap(75, { expectedGoalsXg: 0.4, shotsOnTarget: 2, bigChances: 0, touchesInOppositionBox: 12, totalShots: 4 }),
    snap(82, { expectedGoalsXg: 0.6, shotsOnTarget: 3, bigChances: 0, touchesInOppositionBox: 16, totalShots: 6 }),
    snap(86, { expectedGoalsXg: 0.75, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 18, totalShots: 7 }),
  ];
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures(86),
    snapshots: milderSnaps,
    incidents: { homeRedCards: 0, awayRedCards: 1 },  // away (underdog) red
  });
  assert.equal(r.signalEligible, true);
  assert.equal(r.bet, 'OVER_0_5');
  assert.equal(r.underdogRedCard, true);
  assert.match(r.reason, /UNDERDOG_RED_CARD/);
});

test('score changed → SKIP', () => {
  const snaps = [
    snap(75, { expectedGoalsXg: 0.4, shotsOnTarget: 2, bigChances: 0, touchesInOppositionBox: 12, totalShots: 4 }, { home: '0', away: '0' }),
    snap(80, { expectedGoalsXg: 0.7, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 16, totalShots: 6 }, { home: '1', away: '0' }),
  ];
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures(85),
    snapshots: snaps,
    incidents: null,
  });
  assert.equal(r.bet, 'SKIP');
  assert.match(r.reason, /score changed/);
});

test('only 1 snapshot in window → SKIP', () => {
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures(76),
    snapshots: [
      snap(60, { expectedGoalsXg: 0.2, shotsOnTarget: 1, totalShots: 3, bigChances: 0, touchesInOppositionBox: 8 }),
      snap(76, { expectedGoalsXg: 0.4, shotsOnTarget: 2, totalShots: 4, bigChances: 0, touchesInOppositionBox: 12 }),
    ],
    incidents: null,
  });
  assert.equal(r.bet, 'SKIP');
  assert.match(r.reason, /snapshots in late window=1/);
});

test('lockedFavorite ігнорує live odds, використовує закешовані', () => {
  // live odds кажуть аутсайдер — але lock каже що home був фаворитом до матчу
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: { minute: 85, odds1X2: { home: 5.0, draw: 3.5, away: 1.6 } },  // live: away favorite
    snapshots: baseSnaps,
    incidents: null,
    lockedFavorite: { favoriteSide: 'home', favoriteOdds: 1.5, lockedAtMinute: 60 },
  });
  assert.equal(r.bet, 'OVER_0_5');
  assert.equal(r.favoriteSide, 'home');  // взяв з lock, не з live
  assert.equal(r.favoriteOdds, 1.5);
  assert.equal(r.favoriteLocked, true);
});

test('lockedFavorite з odds > порогу → SKIP без перевірки live', () => {
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: { minute: 85, odds1X2: { home: 1.5, draw: 4.0, away: 6.0 } },  // live: hot favorite
    snapshots: baseSnaps,
    incidents: null,
    lockedFavorite: { favoriteSide: 'home', favoriteOdds: 2.1, lockedAtMinute: 60 },
  });
  assert.equal(r.bet, 'SKIP');
  assert.match(r.reason, /locked favorite odds=2.1/);
  assert.equal(r.favoriteLocked, true);
});

test('flat pressure → SKIP', () => {
  const flatSnaps = [
    snap(60, { expectedGoalsXg: 0.5, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 10, totalShots: 5 }),
    snap(76, { expectedGoalsXg: 0.55, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 11, totalShots: 5 }),
    snap(85, { expectedGoalsXg: 0.6, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 12, totalShots: 5 }),
  ];
  const r = evaluateLine2LateSurge({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures(85),
    snapshots: flatSnaps,
    incidents: null,
  });
  assert.equal(r.bet, 'SKIP');
});
