'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SNAPSHOT_START_MINUTE_1H,
  getSnapshotMinute1H,
  getDelayToNextSnapshotMs1H,
} = require('../src/tracker/snapshotCadence1H');

test('start minute is 20', () => {
  assert.equal(SNAPSHOT_START_MINUTE_1H, 20);
});

test('buckets snap to 2-minute grid from 20 (default interval)', () => {
  assert.equal(getSnapshotMinute1H(20), 20);
  assert.equal(getSnapshotMinute1H(21), 20);
  assert.equal(getSnapshotMinute1H(22), 22);
  assert.equal(getSnapshotMinute1H(29), 28);
});

test('minutes before 20 clamp to 20', () => {
  assert.equal(getSnapshotMinute1H(15), 20);
  assert.equal(getSnapshotMinute1H(null), 20);
});

test('delay to next bucket is positive and bounded', () => {
  assert.equal(getDelayToNextSnapshotMs1H(20), 2 * 60_000);
  assert.equal(getDelayToNextSnapshotMs1H(21), 1 * 60_000);
  assert.ok(getDelayToNextSnapshotMs1H(24) > 0);
});
