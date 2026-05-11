'use strict';

function nz(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function sideWeightedPressure(delta, side) {
  if (!delta) return 0;
  const shots = nz(delta.totalShots?.[side]);
  const sot = nz(delta.shotsOnTarget?.[side]);
  const ck = nz(delta.cornerKicks?.[side]);
  const xg = nz(delta.expectedGoalsXg?.[side]);
  const xgot = nz(delta.xgOnTargetXgot?.[side]);
  const sib = nz(delta.shotsInsideTheBox?.[side]);
  const tbox = nz(delta.touchesInOppositionBox?.[side]);
  const bc = nz(delta.bigChances?.[side]);

  return (
    shots * 1 +
    sot * 3 +
    ck * 0.5 +
    xg * 40 +
    xgot * 50 +
    sib * 2 +
    tbox * 0.5 +
    bc * 8
  );
}

/**
 * RFC pressure block for one window delta (usually 45–60 or 70–80).
 *
 * @param {Object|null} windowDelta subtractStats cumulative diff
 */
function evaluatePressure(windowDelta) {
  if (!windowDelta) {
    return {
      team: 'none',
      quality: 'none',
      homeWeighted: 0,
      awayWeighted: 0,
    };
  }
  const hh = sideWeightedPressure(windowDelta, 'home');
  const aa = sideWeightedPressure(windowDelta, 'away');
  let team = 'both';
  if (Math.abs(hh - aa) >= 2) team = hh > aa ? 'home' : 'away';

  return {
    team,
    quality: 'none',
    homeWeighted: hh,
    awayWeighted: aa,
  };
}

function finalizePressureQuality(direction, fakeScore, realScore) {
  let quality = 'none';
  if (fakeScore > realScore + 12 && fakeScore >= 42) quality = 'fake';
  else if (realScore > fakeScore + 12 && realScore >= 45) quality = 'real';

  let dir = direction;
  return {
    direction: dir,
    quality,
  };
}

function classifyDirectionTrend({ totals70_80, totals75_80 }) {
  const bulk = totals70_80?.totalShots ?? 0;
  const late = totals75_80?.totalShots ?? 0;
  const xLate = totals75_80?.xg;
  if (late >= 5 || (typeof xLate === 'number' && xLate >= 0.12)) return 'explosive';
  if (late >= 3 || (bulk >= 8 && late >= bulk * 0.28)) return 'growing';
  if (late <= 1 && bulk <= 4) return 'falling';
  return 'flat';
}

/** Pace pick-up nearer to minute 60 (window 50–60 vs broader 45–60). */
function directionNearKick60(total45_60, total50_60) {
  if (!total45_60 && !total50_60) return 'flat';
  const late = total50_60?.totalShots ?? 0;
  const bulk = total45_60?.totalShots ?? 0;
  const xLate = total50_60?.xg;
  if (late >= 5 || (typeof xLate === 'number' && xLate >= 0.12)) return 'explosive';
  if (late >= 3 || (bulk >= 6 && late >= bulk * 0.35)) return 'growing';
  if (late <= 1 && bulk <= 3) return 'falling';
  return 'flat';
}

module.exports = {
  evaluatePressure,
  finalizePressureQuality,
  classifyDirectionTrend,
  directionNearKick60,
  sideWeightedPressure,
};
