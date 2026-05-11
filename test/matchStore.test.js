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
