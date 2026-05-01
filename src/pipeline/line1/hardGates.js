'use strict';

const XG_BURST_RATIO = 1.5;

/**
 * Hard SKIP gates for Line 1. Override consensus decision.
 * @param {{ incidents, intensityRatioLast, bcDeltaLast, scoreChanged }} input
 * @returns {{ skip: boolean, reason: string|null }}
 */
function applyHardGates({ incidents, intensityRatioLast, bcDeltaLast, scoreChanged }) {
  if (scoreChanged) {
    return { skip: true, reason: 'score changed between snapshots' };
  }
  const rcHome = incidents?.homeRedCards ?? 0;
  const rcAway = incidents?.awayRedCards ?? 0;
  if (rcHome > 0 || rcAway > 0) {
    return { skip: true, reason: `red card (h=${rcHome}, a=${rcAway})` };
  }
  const xgRatio = intensityRatioLast?.expectedGoalsXg;
  if (Number.isFinite(xgRatio) && xgRatio >= XG_BURST_RATIO) {
    return { skip: true, reason: `xG burst ratio=${xgRatio} >= ${XG_BURST_RATIO}` };
  }
  if (Number.isFinite(bcDeltaLast) && bcDeltaLast >= 1) {
    return { skip: true, reason: `BC delta=${bcDeltaLast} >= 1` };
  }
  return { skip: false, reason: null };
}

module.exports = { applyHardGates, XG_BURST_RATIO };
