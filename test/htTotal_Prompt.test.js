'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHtTotalPrompt } = require('../src/ai/prompts/htTotal_Prompt');

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
  observedMinute: 45,
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

const HT_SCORE_00 = { home: 0, away: 0 };

// ── 1. Returns { system, user } with string values ────────────────────────────

test('returns { system, user } with string values', () => {
  const result = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(result && typeof result === 'object');
  assert.ok(typeof result.system === 'string', 'system should be a string');
  assert.ok(typeof result.user === 'string', 'user should be a string');
});

// ── 2. System contains 'БАЗОВА ЛІНІЯ' ────────────────────────────────────────

test('system contains БАЗОВА ЛІНІЯ (base anchor)', () => {
  const { system } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(system.includes('БАЗОВА ЛІНІЯ'), `system should contain "БАЗОВА ЛІНІЯ", got:\n${system.slice(0, 300)}`);
});

// ── 3. System contains 'ЯКІР' keyword ────────────────────────────────────────

test('system contains ЯКІР keyword', () => {
  const { system } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.match(system, /ЯКІР/i);
});

// ── 4. System contains 'НЕ РОЗДУВАЙ' (anti-inflation rule) ───────────────────

test('system contains НЕ РОЗДУВАЙ (anti-inflation rule)', () => {
  const { system } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.match(system, /НЕ РОЗДУВАЙ/i);
});

// ── 5. System contains 'ОБОВ'ЯЗКОВО' (quality search instruction) ─────────────

test("system contains ОБОВ'ЯЗКОВО (quality search instruction)", () => {
  const { system } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.match(system, /ОБОВ.{1,5}ЯЗКОВО/i);
});

// ── 6. System contains 'web_search' ──────────────────────────────────────────

test('system contains web_search', () => {
  const { system } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(system.includes('web_search'), `system should contain "web_search", got:\n${system.slice(0, 300)}`);
});

// ── 7. User contains homeTeam and awayTeam ────────────────────────────────────

test('user contains homeTeam and awayTeam', () => {
  const { user } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(user.includes('Dynamo Kyiv'), 'user should contain homeTeam');
  assert.ok(user.includes('Shakhtar'), 'user should contain awayTeam');
});

// ── 8. User contains HT score ─────────────────────────────────────────────────

test('user contains HT score (0:0)', () => {
  const { user } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(user.includes('0:0'), `user should contain HT score 0:0, got:\n${user.slice(0, 400)}`);
});

test('user contains HT score (1:0)', () => {
  const { user } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, { home: 1, away: 0 });
  assert.ok(user.includes('1:0'), `user should contain HT score 1:0, got:\n${user.slice(0, 400)}`);
});

// ── 9. User contains league and country ───────────────────────────────────────

test('user contains league and country', () => {
  const { user } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(user.includes('Premier League Ukraine'), 'user should contain league');
  assert.ok(user.includes('Ukraine'), 'user should contain country');
});

// ── 10. System instructs confidence ≤ 0.40 baseline ─────────────────────────

test('system instructs confidence ≤ 0.40 baseline', () => {
  const { system } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(
    system.includes('0.40') || system.includes('≤ 0.40') || system.includes('<= 0.40'),
    `system should contain confidence ≤ 0.40 instruction, got:\n${system.slice(0, 400)}`
  );
});

// ── Additional: xG values in user ────────────────────────────────────────────

test('user contains 1H xG values', () => {
  const { user } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  // total xG = 0.08 + 0.12 = 0.2
  assert.ok(user.includes('0.2'), `user should contain total xG, got:\n${user.slice(0, 400)}`);
});

test('null snapshot does not crash and uses n/a for stats', () => {
  const result = buildHtTotalPrompt(BASE_MATCH, null, HT_SCORE_00);
  assert.ok(typeof result.system === 'string');
  assert.ok(typeof result.user === 'string');
  assert.ok(result.user.includes('n/a'));
});

test('null htScore defaults to 0:0', () => {
  const { user } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, null);
  assert.ok(user.includes('0:0'), 'null htScore should default to 0:0');
});

test('user contains draw odds', () => {
  const { user } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(user.includes('3.2'), `user should contain draw odds 3.2, got:\n${user.slice(0, 400)}`);
});

test('user contains favorite team info', () => {
  const { user } = buildHtTotalPrompt(BASE_MATCH, BASE_SNAP, HT_SCORE_00);
  assert.ok(user.includes('ФАВОРИТ'), 'user should contain ФАВОРИТ label');
  assert.ok(user.includes('Dynamo Kyiv'), 'user should show home team as favorite');
});

test('missing standings → PPG shows n/a', () => {
  const matchNoStandings = { ...BASE_MATCH, standings: {} };
  const { user } = buildHtTotalPrompt(matchNoStandings, BASE_SNAP, HT_SCORE_00);
  assert.ok(user.includes('n/a'));
});
