'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nn(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Sum home+away for one field when both numeric; otherwise best-effort partial. */
function summable(delta, key) {
  const b = delta?.[key];
  if (!b) return null;
  const h = b.home;
  const a = b.away;
  if (nn(h) && nn(a)) return h + a;
  if (nn(h)) return h;
  if (nn(a)) return a;
  return null;
}

/**
 * Normalize a subtractStats()-style delta into convenient totals bundle.
 */
function bundleWindowTotals(delta) {
  if (!delta) return null;
  const totalShots = summable(delta, 'totalShots');
  const shotsOnTarget = summable(delta, 'shotsOnTarget');
  const corners = summable(delta, 'cornerKicks');
  const xg = summable(delta, 'expectedGoalsXg');
  const xgot = summable(delta, 'xgOnTargetXgot');
  const bigChances = summable(delta, 'bigChances');
  const shotsInsideBox = summable(delta, 'shotsInsideTheBox');
  const touchesInBox = summable(delta, 'touchesInOppositionBox');
  const goalkeeperSaves = summable(delta, 'goalkeeperSaves');
  const crossesMade = summable(delta, 'crossesMade');
  const crossesAttempted = summable(delta, 'crossesAttempted');
  const blockedShots = summable(delta, 'blockedShots');
  const shotsOutsideBox = summable(delta, 'shotsOutsideTheBox');
  const expectedAssistsXa = summable(delta, 'expectedAssistsXa');

  return {
    totalShots: totalShots ?? 0,
    shotsOnTarget: shotsOnTarget ?? 0,
    corners: corners ?? 0,
    xg,
    xgot: xgot ?? 0,
    bigChances: bigChances ?? 0,
    shotsInsideBox: shotsInsideBox ?? 0,
    touchesInBox: touchesInBox ?? 0,
    goalkeeperSaves: goalkeeperSaves ?? 0,
    crossesMade: crossesMade ?? 0,
    crossesAttempted: crossesAttempted ?? 0,
    blockedShots: blockedShots ?? 0,
    shotsOutsideBox: shotsOutsideBox ?? 0,
    expectedAssistsXa: expectedAssistsXa ?? 0,
  };
}

module.exports = { clamp, nn, summable, bundleWindowTotals };
