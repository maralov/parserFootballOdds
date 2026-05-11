'use strict';

const SNAPSHOT_START_MINUTE = 45;
const SNAPSHOT_INTERVAL_MINUTES = 5;

function clampMinute(minute) {
  if (minute == null) return SNAPSHOT_START_MINUTE;
  return Math.max(SNAPSHOT_START_MINUTE, minute);
}

function getSnapshotMinute(minute) {
  const current = clampMinute(minute);
  const offset = current - SNAPSHOT_START_MINUTE;
  return SNAPSHOT_START_MINUTE + (Math.floor(offset / SNAPSHOT_INTERVAL_MINUTES) * SNAPSHOT_INTERVAL_MINUTES);
}

function getDelayToNextSnapshotMs(minute) {
  const current = clampMinute(minute);
  const currentBucket = getSnapshotMinute(current);
  const nextBucket = currentBucket + SNAPSHOT_INTERVAL_MINUTES;
  return Math.max(0, (nextBucket - current) * 60_000);
}

module.exports = {
  SNAPSHOT_START_MINUTE,
  SNAPSHOT_INTERVAL_MINUTES,
  getSnapshotMinute,
  getDelayToNextSnapshotMs,
};
