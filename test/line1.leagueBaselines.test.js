'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getLeagueBaseline, DEFAULT_LEAGUE_BASELINE } = require('../src/helpers/leagueBaselines');

test('getLeagueBaseline: невідома ліга → DEFAULT_LEAGUE_BASELINE', () => {
  const b = getLeagueBaseline('Some Random League XYZ');
  assert.equal(b, DEFAULT_LEAGUE_BASELINE);
});

test('getLeagueBaseline: Serie A → більше за DEFAULT', () => {
  const b = getLeagueBaseline('Італія: Серія А');
  assert.ok(b > DEFAULT_LEAGUE_BASELINE, `Serie A baseline ${b} should be > default ${DEFAULT_LEAGUE_BASELINE}`);
});

test('getLeagueBaseline: case-insensitive', () => {
  const b1 = getLeagueBaseline('італія: серія а');
  const b2 = getLeagueBaseline('Італія: Серія А');
  assert.equal(b1, b2);
});

test('getLeagueBaseline: null/empty → DEFAULT', () => {
  assert.equal(getLeagueBaseline(null), DEFAULT_LEAGUE_BASELINE);
  assert.equal(getLeagueBaseline(''), DEFAULT_LEAGUE_BASELINE);
});

test('getLeagueBaseline: Bundesliga → менше за DEFAULT (атакуюча ліга)', () => {
  const b = getLeagueBaseline('Німеччина: Бундесліга');
  assert.ok(b < DEFAULT_LEAGUE_BASELINE, `Bundesliga baseline ${b} should be < default ${DEFAULT_LEAGUE_BASELINE}`);
});
