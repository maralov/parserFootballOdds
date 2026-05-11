'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSnapshotMinute,
  getDelayToNextSnapshotMs,
} = require('../src/tracker/snapshotCadence');

test('getSnapshotMinute aligns live minutes to 45/50/55 cadence buckets', () => {
  assert.equal(getSnapshotMinute(45), 45);
  assert.equal(getSnapshotMinute(46), 45);
  assert.equal(getSnapshotMinute(49), 45);
  assert.equal(getSnapshotMinute(50), 50);
  assert.equal(getSnapshotMinute(54), 50);
  assert.equal(getSnapshotMinute(67), 65);
});

test('getDelayToNextSnapshotMs schedules the next 5-minute checkpoint', () => {
  assert.equal(getDelayToNextSnapshotMs(45), 5 * 60_000);
  assert.equal(getDelayToNextSnapshotMs(47), 3 * 60_000);
  assert.equal(getDelayToNextSnapshotMs(50), 5 * 60_000);
  assert.equal(getDelayToNextSnapshotMs(52), 3 * 60_000);
  assert.equal(getDelayToNextSnapshotMs(67), 3 * 60_000);
});
