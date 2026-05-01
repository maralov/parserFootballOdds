'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { appendShadowEntry, loadShadowEntries } = require('../src/pipeline/line1/shadowLogger');

test('round-trip: append + load', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line1-'));
  process.env.LINE1_SHADOW_DIR_OVERRIDE = tmpDir;
  const date = '2026-05-01';
  appendShadowEntry(date, { matchId: 'M1', minute: 65, pDry: 0.71, bet: 'UNDER_0_5' });
  const loaded = loadShadowEntries(date);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].matchId, 'M1');
  assert.equal(loaded[0].pDry, 0.71);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LINE1_SHADOW_DIR_OVERRIDE;
});

test('dedup по matchId+minute (overwrite)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line1-'));
  process.env.LINE1_SHADOW_DIR_OVERRIDE = tmpDir;
  const date = '2026-05-01';
  appendShadowEntry(date, { matchId: 'M1', minute: 65, pDry: 0.70 });
  appendShadowEntry(date, { matchId: 'M1', minute: 65, pDry: 0.75 });
  const loaded = loadShadowEntries(date);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].pDry, 0.75);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LINE1_SHADOW_DIR_OVERRIDE;
});

test('loadShadowEntries: non-existent date → []', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line1-'));
  process.env.LINE1_SHADOW_DIR_OVERRIDE = tmpDir;
  const loaded = loadShadowEntries('2026-01-01');
  assert.deepEqual(loaded, []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LINE1_SHADOW_DIR_OVERRIDE;
});
