'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOneHPrompt } = require('../src/ai/prompts/oneH_Prompt');

const BASE_MATCH = {
  homeTeam: 'Dynamo Kyiv',
  awayTeam: 'Shakhtar',
  league: 'Premier League Ukraine',
  country: 'Ukraine',
  odds: {
    home: 2.10,
    draw: 3.20,
    away: 3.50,
    isOddsFavorite: { favorite: 'home' },
  },
  standings: {
    home: { position: 1, pts: 45, mp: 20 },
    away: { position: 2, pts: 40, mp: 20 },
  },
};

const BASE_SNAP = {
  observedMinute: 25,
  cumulative: {
    expectedGoalsXg: { home: 0.08, away: 0.12 },
    shotsOnTarget: { home: 1, away: 2 },
    touchesInOppositionBox: { home: 4, away: 6 },
    bigChances: { home: 0, away: 1 },
    yellowCards: { home: 1, away: 0 },
    redCards: { home: 0, away: 0 },
  },
  ballPossession: { home: 48, away: 52 },
};

// ── UNDER direction ──────────────────────────────────────────────────────────

test('under direction → returns {system, user}', () => {
  const result = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  assert.ok(result && typeof result === 'object');
  assert.ok(typeof result.system === 'string');
  assert.ok(typeof result.user === 'string');
});

test('under direction → system contains "ТМ 0,5"', () => {
  const { system } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  assert.ok(system.includes('ТМ 0,5'), `system should contain "ТМ 0,5", got:\n${system.slice(0, 200)}`);
});

test('under direction → user contains "UNDER"', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  assert.ok(user.includes('UNDER'), `user should contain "UNDER", got:\n${user.slice(0, 300)}`);
});

test('under direction → user contains match teams', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  assert.ok(user.includes('Dynamo Kyiv'), 'user should contain homeTeam');
  assert.ok(user.includes('Shakhtar'), 'user should contain awayTeam');
});

test('under direction → user contains snapshot minute', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  assert.ok(user.includes('25'), `user should contain minute 25, got:\n${user.slice(0, 300)}`);
});

test('under direction → user contains the odds value from tm05_1hOddsAt(25)=2.6', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  // tm05_1hOddsAt(25) = 2.6
  assert.ok(user.includes('2.6'), `user should contain odds 2.6, got:\n${user.slice(0, 400)}`);
});

test('under direction → user does not mention favorite as ФАВОРИТ', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  assert.ok(user.includes('РІВНА ГРА'), `under should say РІВНА ГРА, got:\n${user.slice(0, 400)}`);
});

// ── OVER direction ───────────────────────────────────────────────────────────

test('over direction → system contains "ТБ 0,5"', () => {
  const { system } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'over');
  assert.ok(system.includes('ТБ 0,5'), `system should contain "ТБ 0,5", got:\n${system.slice(0, 200)}`);
});

test('over direction → user contains "OVER"', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'over');
  assert.ok(user.includes('OVER'), `user should contain "OVER", got:\n${user.slice(0, 300)}`);
});

test('over direction → user contains the favorite team name', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'over');
  // home is the favorite → should show homeTeam name
  assert.ok(user.includes('Dynamo Kyiv'), `user should contain favorite team Dynamo Kyiv, got:\n${user.slice(0, 400)}`);
  assert.ok(user.includes('ФАВОРИТ'), `user should contain ФАВОРИТ label, got:\n${user.slice(0, 400)}`);
});

test('over direction → user contains match teams', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'over');
  assert.ok(user.includes('Dynamo Kyiv'));
  assert.ok(user.includes('Shakhtar'));
});

test('over direction → user contains snapshot minute', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'over');
  assert.ok(user.includes('25'));
});

test('over direction → user contains the odds value from tb05_1hOddsAt(25)=2.1', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'over');
  // tb05_1hOddsAt(25) = 2.1
  assert.ok(user.includes('2.1'), `user should contain odds 2.1, got:\n${user.slice(0, 400)}`);
});

test('over direction with away favorite → shows away team as favorite', () => {
  const matchAwayFav = {
    ...BASE_MATCH,
    odds: {
      ...BASE_MATCH.odds,
      isOddsFavorite: { favorite: 'away' },
    },
  };
  const { user } = buildOneHPrompt(matchAwayFav, BASE_SNAP, 'over');
  assert.ok(user.includes('Shakhtar'), 'should show away team as favorite');
  assert.ok(user.includes('away'), 'should mention away side');
});

// ── Snapshot table ───────────────────────────────────────────────────────────

test('snapshot table is included in user prompt', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  assert.ok(user.includes('| min |'), 'user should contain snapshot table header');
  assert.ok(user.includes('| 25 |'), 'user should contain snapshot row with minute 25');
});

test('null snapshot uses defaults without crashing', () => {
  const result = buildOneHPrompt(BASE_MATCH, null, 'under');
  assert.ok(result.user.includes('25')); // default minute
});

// ── League and country ───────────────────────────────────────────────────────

test('user contains league and country', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  assert.ok(user.includes('Premier League Ukraine'));
  assert.ok(user.includes('Ukraine'));
});

// ── Standings PPG ────────────────────────────────────────────────────────────

test('user contains PPG calculated from standings', () => {
  const { user } = buildOneHPrompt(BASE_MATCH, BASE_SNAP, 'under');
  // home: 45/20 = 2.25, away: 40/20 = 2.00
  assert.ok(user.includes('2.25'), `user should contain home PPG 2.25, got:\n${user.slice(0, 500)}`);
  assert.ok(user.includes('2.00'), `user should contain away PPG 2.00, got:\n${user.slice(0, 500)}`);
});

test('missing standings → PPG shows n/a', () => {
  const matchNoStandings = { ...BASE_MATCH, standings: {} };
  const { user } = buildOneHPrompt(matchNoStandings, BASE_SNAP, 'under');
  assert.ok(user.includes('n/a'));
});
