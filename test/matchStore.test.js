'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const matchStore = require('../src/store/matchStore');

function makeTempDate(label) {
  return new Date(`2099-12-${label}T12:00:00.000Z`);
}

test('writeStore is atomic (no .tmp left behind on success)', () => {
  const date = makeTempDate('01');
  matchStore.writeStore({ atomicTest: { matchId: 'atomicTest' } }, date);

  const dir = matchStore.dayLogsAbsolute(date);
  const file = path.join(dir, 'matches.json');
  const tmpFile = file + '.tmp';

  assert.ok(fs.existsSync(file), 'matches.json повинен існувати');
  assert.ok(!fs.existsSync(tmpFile), '.tmp файл не має залишатися після успішного запису');

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.atomicTest.matchId, 'atomicTest');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeStore overwrites atomically without truncate-window', () => {
  const date = makeTempDate('02');
  matchStore.writeStore({ a: { matchId: 'a' } }, date);
  matchStore.writeStore({ b: { matchId: 'b' } }, date);

  const dir = matchStore.dayLogsAbsolute(date);
  const file = path.join(dir, 'matches.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(onDisk), ['b']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('flushSync writes pending data to disk (no-op when no cache)', () => {
  const date = makeTempDate('03');
  matchStore.writeStore({ x: { matchId: 'x' } }, date);
  matchStore.flushSync(date);

  const dir = matchStore.dayLogsAbsolute(date);
  const file = path.join(dir, 'matches.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.x.matchId, 'x');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('flushAll iterates all cached dates', () => {
  const d1 = makeTempDate('04');
  const d2 = makeTempDate('05');
  matchStore.writeStore({ a: { matchId: 'a' } }, d1);
  matchStore.writeStore({ b: { matchId: 'b' } }, d2);
  matchStore.flushAll();

  for (const d of [d1, d2]) {
    const dir = matchStore.dayLogsAbsolute(d);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('debounced writeStore defers disk write until flushSync', () => {
  process.env.MATCHSTORE_DEBOUNCE_MS = '5000';
  delete require.cache[require.resolve('../src/store/matchStore')];
  const debounced = require('../src/store/matchStore');

  const date = makeTempDate('06');
  const dir = debounced.dayLogsAbsolute(date);
  const file = path.join(dir, 'matches.json');

  debounced.writeStore({ pending: { matchId: 'pending' } }, date);

  assert.ok(
    !fs.existsSync(file) || JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) === '{}',
    'файл не повинен містити запис до flushSync'
  );

  debounced.flushSync(date);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.pending.matchId, 'pending');

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MATCHSTORE_DEBOUNCE_MS;
  delete require.cache[require.resolve('../src/store/matchStore')];
});

test('debounced writeStore — readStore returns latest cached state immediately', () => {
  process.env.MATCHSTORE_DEBOUNCE_MS = '5000';
  delete require.cache[require.resolve('../src/store/matchStore')];
  const debounced = require('../src/store/matchStore');

  const date = makeTempDate('07');
  debounced.writeStore({ live: { matchId: 'live' } }, date);
  const got = debounced.readStore(date);
  assert.equal(got.live.matchId, 'live', 'readStore має повертати cached state без flush');

  debounced.flushSync(date);
  fs.rmSync(debounced.dayLogsAbsolute(date), { recursive: true, force: true });
  delete process.env.MATCHSTORE_DEBOUNCE_MS;
  delete require.cache[require.resolve('../src/store/matchStore')];
});

test('finalize flushes synchronously even in debounced mode', () => {
  process.env.MATCHSTORE_DEBOUNCE_MS = '60000';
  delete require.cache[require.resolve('../src/store/matchStore')];
  const debounced = require('../src/store/matchStore');

  const date = makeTempDate('08');
  debounced.upsertFromEnrichment({
    matchId: 'fin-1',
    homeTeam: 'H', awayTeam: 'A',
    statistics: { '1half': { home: {}, away: {} } },
    statsLevel: 'detailed',
    odds: { home: 2.0, draw: 3.2, away: 3.6 },
    standings: { home: { pts: 10, mp: 5 }, away: { pts: 10, mp: 5 } },
  }, date);

  debounced.finalize('fin-1', {
    scoreHome: 0, scoreAway: 0, totalGoals: 0,
    resultTM05: true, resultTB05: false,
    firstGoalMinute: null, goals: [],
    finishedAt: new Date().toISOString(),
  }, {}, date);

  const file = path.join(debounced.dayLogsAbsolute(date), 'matches.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk['fin-1'].tracking.status, 'finished',
    'finalize має sync-flushити навіть при увімкненому debouncing');

  fs.rmSync(debounced.dayLogsAbsolute(date), { recursive: true, force: true });
  delete process.env.MATCHSTORE_DEBOUNCE_MS;
  delete require.cache[require.resolve('../src/store/matchStore')];
});
