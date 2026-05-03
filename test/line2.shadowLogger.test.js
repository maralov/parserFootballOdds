'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { appendLine2Entry, loadLine2Entries } = require('../src/pipeline/line2/shadowLogger');

test('round-trip: append + load', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line2-'));
  process.env.LINE2_LOG_DIR_OVERRIDE = tmpDir;
  appendLine2Entry('2026-05-03', { matchId: 'L2A', minute: 80, pressureScore: 0.71, bet: 'OVER_0_5' });
  const loaded = loadLine2Entries('2026-05-03');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].matchId, 'L2A');
  assert.equal(loaded[0].pressureScore, 0.71);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LINE2_LOG_DIR_OVERRIDE;
});

test('dedup by matchId+minute', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line2-'));
  process.env.LINE2_LOG_DIR_OVERRIDE = tmpDir;
  appendLine2Entry('2026-05-03', { matchId: 'X', minute: 80, pressureScore: 0.5 });
  appendLine2Entry('2026-05-03', { matchId: 'X', minute: 80, pressureScore: 0.7 });
  const loaded = loadLine2Entries('2026-05-03');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].pressureScore, 0.7);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LINE2_LOG_DIR_OVERRIDE;
});

test('non-existent date → []', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line2-'));
  process.env.LINE2_LOG_DIR_OVERRIDE = tmpDir;
  assert.deepEqual(loadLine2Entries('1999-01-01'), []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LINE2_LOG_DIR_OVERRIDE;
});
