'use strict';

// First-half (1HUNDER) snapshot cadence.
// Snapshots run densely across the early first half so the decision window
// (25–35') has fresh data. Interval is configurable; default 2 minutes.

const env = require('../config/env');

const SNAPSHOT_START_MINUTE_1H = 20;
const SNAPSHOT_END_MINUTE_1H = 35;

function intervalMin() {
  const n = Number(env.LIVE_1H_SNAPSHOT_INTERVAL_MIN);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

function clampMinute1H(minute) {
  if (minute == null) return SNAPSHOT_START_MINUTE_1H;
  return Math.max(SNAPSHOT_START_MINUTE_1H, minute);
}

/**
 * Normalize an observed minute to its 1H snapshot bucket (20, 22, 24, …).
 * @param {number|null} minute
 * @returns {number}
 */
function getSnapshotMinute1H(minute) {
  const step = intervalMin();
  const current = clampMinute1H(minute);
  const offset = current - SNAPSHOT_START_MINUTE_1H;
  return SNAPSHOT_START_MINUTE_1H + Math.floor(offset / step) * step;
}

/**
 * Milliseconds until the next 1H snapshot bucket.
 * @param {number|null} minute
 * @returns {number}
 */
function getDelayToNextSnapshotMs1H(minute) {
  const step = intervalMin();
  const current = clampMinute1H(minute);
  const currentBucket = getSnapshotMinute1H(current);
  const nextBucket = currentBucket + step;
  return Math.max(0, (nextBucket - current) * 60_000);
}

module.exports = {
  SNAPSHOT_START_MINUTE_1H,
  SNAPSHOT_END_MINUTE_1H,
  getSnapshotMinute1H,
  getDelayToNextSnapshotMs1H,
};
