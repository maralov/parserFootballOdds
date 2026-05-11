'use strict';

const { subtractStats } = require('../tracker/deltaCalculator');
const { bundleWindowTotals } = require('./helpers');

function isMinute(m) {
  return typeof m === 'number' && Number.isFinite(m);
}

function snapshotMinute(sn) {
  if (!sn) return null;
  if (sn.minute != null) return sn.minute;
  if (sn.observedMinute != null) return sn.observedMinute;
  return null;
}

function findSnapshotAtOrBefore(snapshots, targetMinute) {
  if (!Array.isArray(snapshots) || targetMinute == null) return null;
  const filtered = snapshots.filter((s) => {
    const m = snapshotMinute(s);
    return isMinute(m) && m <= targetMinute;
  });
  filtered.sort((a, b) => snapshotMinute(a) - snapshotMinute(b));
  return filtered.pop() || null;
}

function findSnapshotAtOrAfter(snapshots, targetMinute) {
  if (!Array.isArray(snapshots) || targetMinute == null) return null;
  const filtered = snapshots.filter((s) => {
    const m = snapshotMinute(s);
    return isMinute(m) && m >= targetMinute;
  });
  filtered.sort((a, b) => snapshotMinute(a) - snapshotMinute(b));
  return filtered[0] || null;
}

function buildWindow(snapshots, fromMin, toMin) {
  const sFrom = findSnapshotAtOrBefore(snapshots, fromMin);
  const sTo = findSnapshotAtOrBefore(snapshots, toMin);
  if (!sFrom?.cumulative || !sTo?.cumulative || snapshotMinute(sTo) <= snapshotMinute(sFrom)) {
    return null;
  }
  const raw = subtractStats(sTo.cumulative, sFrom.cumulative);
  return { raw, totals: bundleWindowTotals(raw), fromMinute: snapshotMinute(sFrom), toMinute: snapshotMinute(sTo) };
}

function buildOpen6075Window(match) {
  const snapshots = match.snapshots || [];
  if (!snapshots.length) return null;
  const last = snapshots[snapshots.length - 1];
  const lm = snapshotMinute(last);
  if (lm == null || lm < 60) return null;

  const sFrom = findSnapshotAtOrAfter(snapshots, 60);
  if (!sFrom?.cumulative) return null;

  const end = Math.min(75, lm);
  const sTo = findSnapshotAtOrBefore(snapshots, end);
  if (!sTo?.cumulative || snapshotMinute(sTo) <= snapshotMinute(sFrom)) return null;

  const raw = subtractStats(sTo.cumulative, sFrom.cumulative);
  return {
    raw,
    totals: bundleWindowTotals(raw),
    fromMinute: snapshotMinute(sFrom),
    toMinute: snapshotMinute(sTo),
  };
}

function buildAllWindows(match) {
  const snapshots = match.snapshots || [];
  return {
    window45_60: buildWindow(snapshots, 45, 60),
    window50_60: buildWindow(snapshots, 50, 60),
    window60_65: buildWindow(snapshots, 60, 65),
    window65_70: buildWindow(snapshots, 65, 70),
    window70_75: buildWindow(snapshots, 70, 75),
    window55_60: buildWindow(snapshots, 55, 60),
    window80_85: buildWindow(snapshots, 80, 85),
    window80_90: buildWindow(snapshots, 80, 90),
    /** Від першого доступного зрізу 60' до min(останній доступний минута фіду, 75'). */
    window60_toTracked75: buildOpen6075Window(match),
    window60_70: buildWindow(snapshots, 60, 70),
    window70_80: buildWindow(snapshots, 70, 80),
    window75_80: buildWindow(snapshots, 75, 80),
  };
}

module.exports = {
  snapshotMinute,
  findSnapshotAtOrBefore,
  findSnapshotAtOrAfter,
  buildWindow,
  buildOpen6075Window,
  buildAllWindows,
};
