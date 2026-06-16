'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tally1H, formatDayTallyLine, formatDaySummary1H } = require('../src/integrations/telegram/formatters/daySummary1H');

function rec(matchId, status, hit, decisionKey = 'tm05_1h', dataAvailability = undefined) {
  return { matchId, decisionKey, status, result: { hit }, dataAvailability };
}

// ---------------------------------------------------------------------------
// Existing tests (backward compat — dryRate still present)
// ---------------------------------------------------------------------------

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

test('formatDayTallyLine renders W/L and HR %', () => {
  const line = formatDayTallyLine({ hits: 2, misses: 1, settled: 3, dryRate: 2 / 3 });
  assert.match(line, /2W\/1L/);
  assert.match(line, /67%/);
});

test('formatDaySummary1H includes counts and ROI', () => {
  const stats = tally1H([
    rec('a', 'resolved', true),
    rec('b', 'resolved', true),
    rec('c', 'resolved', true),
    rec('d', 'resolved', false),
    rec('e', 'resolved', false),
  ]);
  const msg = formatDaySummary1H(stats, '2026-06-14');
  assert.match(msg, /3/);   // hits
  assert.match(msg, /2/);   // misses
  assert.match(msg, /60%/); // hit rate
  assert.match(msg, /2026/); // date present
  assert.equal(typeof msg, 'string');
});

test('formatDaySummary1H handles a day with no settled bets', () => {
  const stats = tally1H([]);
  const msg = formatDaySummary1H(stats, '2026-06-14');
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
  assert.doesNotMatch(msg, /NaN/);
});

// ---------------------------------------------------------------------------
// New tests: UNDER + OVER direction split
// ---------------------------------------------------------------------------

test('tally1H with mixed tm05_1h + tb05_1h records — under/over signals correct', () => {
  const records = [
    rec('a', 'resolved', true,  'tm05_1h'),
    rec('b', 'resolved', false, 'tm05_1h'),
    rec('c', 'resolved', true,  'tb05_1h'),
    rec('d', 'pending_result', null, 'tb05_1h'),
  ];
  const t = tally1H(records);
  assert.equal(t.signals, 4);
  assert.equal(t.under.signals, 2);
  assert.equal(t.over.signals, 2);
  assert.equal(t.under.hits, 1);
  assert.equal(t.under.misses, 1);
  assert.equal(t.over.hits, 1);
  assert.equal(t.over.misses, 0);
  assert.equal(t.over.pending, 1);
  assert.equal(t.under.settled, 2);
  assert.equal(t.over.settled, 1);
  assert.equal(t.under.rate, 0.5);
  assert.equal(t.over.rate, 1.0);
});

test('tally1H override for tb05_1h uses correct bucket', () => {
  const records = [
    rec('a', 'resolved', true,  'tm05_1h'),
    rec('cur', 'pending_result', null, 'tb05_1h'),
  ];
  const t = tally1H(records, { matchId: 'cur', hit: false, decisionKey: 'tb05_1h' });
  // under: 1 hit (from 'a'), over: 1 miss (from cur override)
  assert.equal(t.under.hits, 1);
  assert.equal(t.under.misses, 0);
  assert.equal(t.over.hits, 0);
  assert.equal(t.over.misses, 1);
  assert.equal(t.pending, 0);
  assert.equal(t.settled, 2);
});

test('tally1H with resolved records having dataAvailability=rich — byAvailability.rich correct', () => {
  const records = [
    rec('a', 'resolved', true,  'tm05_1h', 'rich'),
    rec('b', 'resolved', false, 'tm05_1h', 'rich'),
    rec('c', 'resolved', true,  'tb05_1h', 'partial'),
    rec('d', 'resolved', false, 'tb05_1h', undefined), // → 'none'
  ];
  const t = tally1H(records);
  assert.equal(t.byAvailability.rich.signals, 2);
  assert.equal(t.byAvailability.rich.hits, 1);
  assert.equal(t.byAvailability.rich.misses, 1);
  assert.equal(t.byAvailability.rich.settled, 2);
  assert.equal(t.byAvailability.rich.rate, 0.5);
  assert.equal(t.byAvailability.partial.signals, 1);
  assert.equal(t.byAvailability.partial.hits, 1);
  assert.equal(t.byAvailability.none.signals, 1);
  assert.equal(t.byAvailability.none.misses, 1);
  assert.equal(t.byAvailability.none.rate, 0);
});

test('formatDayTallyLine backward compat: shows W/L format', () => {
  const line = formatDayTallyLine({ hits: 3, misses: 1, settled: 4, dryRate: 0.75 });
  assert.match(line, /3W\/1L/);
  assert.match(line, /75%/);
});

test('formatDaySummary1H with both under+over signals contains direction labels', () => {
  const records = [
    rec('a', 'resolved', true,  'tm05_1h'),
    rec('b', 'resolved', false, 'tb05_1h'),
  ];
  const stats = tally1H(records);
  const msg = formatDaySummary1H(stats, '2026-06-16');
  assert.match(msg, /UNDER/);
  assert.match(msg, /OVER/);
  assert.match(msg, /🟡/);
  assert.match(msg, /🟠/);
});

test('formatDaySummary1H with data_availability — contains rich section', () => {
  const records = [
    rec('a', 'resolved', true,  'tm05_1h', 'rich'),
    rec('b', 'resolved', false, 'tm05_1h', 'partial'),
  ];
  const stats = tally1H(records);
  const msg = formatDaySummary1H(stats, '2026-06-16');
  assert.match(msg, /rich/);
  assert.match(msg, /partial/);
  assert.match(msg, /Data availability/);
});
