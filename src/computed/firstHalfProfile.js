'use strict';

function nn(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Режим «повний набір метрик першого тайму» для RFC-прапорців 2H-detailed (xG + xGOT є в даних). */
function hasHtDetailedPair(ov) {
  const xg = ov.expectedGoalsXg != null ? Number(ov.expectedGoalsXg) : null;
  const xgot = ov.xgOnTargetXgot != null ? Number(ov.xgOnTargetXgot) : null;
  return nn(xg) && nn(xgot);
}

/**
 * Lightweight 1H profile from enrichment (HT statistics), independent of snapshots.
 *
 * @param {Object|null} statistics
 */
function buildFirstHalfProfile(statistics) {
  const ov = statistics?.['1half']?.overall;
  if (!ov) return null;

  const totalXg = ov.expectedGoalsXg != null ? Number(ov.expectedGoalsXg) : null;
  const totalXgot = ov.xgOnTargetXgot != null ? Number(ov.xgOnTargetXgot) : null;
  const totalShotsOnTarget = ov.shotsOnTarget != null ? Number(ov.shotsOnTarget) : null;
  const totalBigChances = ov.bigChances != null ? Number(ov.bigChances) : null;
  const totalCorners = ov.cornerKicks != null ? Number(ov.cornerKicks) : null;
  const totalGoalkeeperSaves = ov.goalkeeperSaves != null ? Number(ov.goalkeeperSaves) : null;
  const totalShots1H = ov.totalShots != null ? Number(ov.totalShots) : null;
  const totalBlockedShots1H = ov.blockedShots != null ? Number(ov.blockedShots) : null;

  const detailedDryInputsOk =
    nn(totalXg) && nn(totalXgot)
    && totalShotsOnTarget != null && nn(totalShotsOnTarget)
    && totalBigChances != null && Number.isFinite(Number(totalBigChances));

  const detailedDryFormula =
    totalXg <= 0.55 &&
    totalShotsOnTarget <= 2 &&
    Number(totalBigChances) === 0 &&
    totalXgot <= 0.35;

  const basicInputsOk =
    totalShotsOnTarget != null && nn(totalShotsOnTarget)
    && totalShots1H != null && nn(totalShots1H)
    && totalCorners != null && nn(totalCorners);

  const basicDry =
    basicInputsOk &&
    totalShotsOnTarget <= 2 &&
    totalShots1H <= 7 &&
    totalCorners <= 5;

  let isDryFirstHalf = null;
  if (detailedDryInputsOk) {
    isDryFirstHalf = detailedDryFormula;
  } else if (basicInputsOk) {
    isDryFirstHalf = basicDry;
  }

  const htDetailed = hasHtDetailedPair(ov);

  let isHotButNoGoal = null;
  let isFakePressure1H = null;
  let isHighQualityNoGoal = null;

  if (htDetailed && nn(totalXg) && nn(totalXgot)) {
    const xg = totalXg;
    const xgot = totalXgot;
    const sot = totalShotsOnTarget;
    const saves = totalGoalkeeperSaves;
    const corners = totalCorners;
    const bcVal = totalBigChances != null ? Number(totalBigChances) : null;

    const sotKnown = nn(sot);

    isHotButNoGoal =
      (xg >= 1.0) ||
      (xgot >= 0.8) ||
      (bcVal != null && bcVal >= 1) ||
      (sotKnown && sot >= 4) ||
      (saves != null && nn(saves) && saves >= 3);

    isFakePressure1H =
      corners != null && nn(corners)
      && sotKnown &&
      bcVal !== null &&
      corners >= 6 &&
      sot <= 1 &&
      xg <= 0.45 &&
      xgot <= 0.2 &&
      Number(bcVal) === 0;

    isHighQualityNoGoal =
      (bcVal != null && bcVal >= 1) ||
      (xg >= 0.8 && sotKnown && sot >= 3) ||
      (xgot >= 0.7);
  }

  return {
    totalXg,
    totalXgot,
    totalShotsOnTarget,
    totalBigChances,
    totalCorners,
    totalGoalkeeperSaves,
    totalTouchesInOppositionBox: ov.touchesInOppositionBox != null
      ? Number(ov.touchesInOppositionBox)
      : null,
    totalShotsInsideBox: ov.shotsInsideTheBox != null ? Number(ov.shotsInsideTheBox) : null,
    totalShots1H,
    totalBlockedShots1H,
    isDryFirstHalf,
    isHotButNoGoal,
    isFakePressure1H,
    isHighQualityNoGoal,
  };
}

module.exports = { buildFirstHalfProfile };
