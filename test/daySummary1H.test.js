'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tally1H, formatDayTallyLine, formatDaySummary1H } = require('../src/integrations/telegram/formatters/daySummary1H');

function rec(matchId, status, hit, decisionKey = 'tm05_1h') {
  return { matchId, decisionKey, status, result: { hit } };
}

test('tally1H counts resolved hits/misses, ignores non-1h and pending', () => {
  const records = [
    rec('a', 'resolved', true),
    rec('b', 'resolved', false),
    rec('c', 'resolved', true),
    rec('d', 'pending_result', null),
    rec('e', 'resolved', true, 'tm05'), // different line — ignored
  ];
  const t = tally1H(records);
  assert.equal(t.signals, 4);
  assert.equal(t.hits, 2);
  assert.equal(t.misses, 1);
  assert.equal(t.pending, 1);
  assert.equal(t.settled, 3);
  assert.equal(Math.round(t.dryRate * 100), 67);
});

test('tally1H override: current pending match counted as settled, no double count', () => {
  const records = [
    rec('a', 'resolved', true),
    rec('cur', 'pending_result', null), // the match we are resolving now
  ];
  const t = tally1H(records, { matchId: 'cur', hit: false });
  assert.equal(t.hits, 1);
  assert.equal(t.misses, 1);
  assert.equal(t.pending, 0);
  assert.equal(t.settled, 2);
});

test('formatDayTallyLine renders W/L and dry %', () => {
  const line = formatDayTallyLine({ hits: 2, misses: 1, settled: 3, dryRate: 2 / 3 });
  assert.match(line, /2W\/1L/);
  assert.match(line, /67%/);
});

test('formatDaySummary1H includes counts, dry-rate and ROI', () => {
  const stats = { signals: 5, hits: 3, misses: 2, pending: 0, settled: 5, dryRate: 0.6 };
  const msg = formatDaySummary1H(stats, '2026-06-14');
  assert.match(msg, /1HUNDER/);
  assert.match(msg, /3/);   // hits
  assert.match(msg, /2/);   // misses
  assert.match(msg, /60%/); // dry-rate
  assert.match(msg, /2026/); // date present
  assert.equal(typeof msg, 'string');
});

test('formatDaySummary1H handles a day with no settled bets', () => {
  const stats = { signals: 0, hits: 0, misses: 0, pending: 0, settled: 0, dryRate: null };
  const msg = formatDaySummary1H(stats, '2026-06-14');
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
  assert.doesNotMatch(msg, /NaN/);
});
