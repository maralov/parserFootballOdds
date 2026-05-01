'use strict';

const {
  LINE1_PDRY_THRESHOLD,
  LINE1_CONSENSUS_REQUIRED,
  LINE1_TRAJECTORY_MIN,
} = require('../../helpers/constants');

const WEIGHTS = {
  dry_1H:     0.12,
  dry_2H:     0.15,
  trajectory: 0.18,
  odds:       0.08,
  prematch:   0.07,
};

const PDRY_THRESHOLD          = LINE1_PDRY_THRESHOLD;
const CONSENSUS_REQUIRED      = LINE1_CONSENSUS_REQUIRED;
const CONSENSUS_MIN_PER_SCORE = 0.5;
const TRAJECTORY_HARD_GATE    = LINE1_TRAJECTORY_MIN;
const MIN_SNAPSHOTS           = 2;

/**
 * @param {{ components, leagueBaseline, snapshotsCount }} input
 * @returns {{ pDry, signalEligible, consensusCount, weightedSum, skipReason }}
 */
function aggregatePDry({ components, leagueBaseline, snapshotsCount }) {
  const c = components || {};
  let weightedSum = 0;
  let consensusCount = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const v = Number.isFinite(c[key]) ? c[key] : 0;
    weightedSum += v * WEIGHTS[key];
    if (v >= CONSENSUS_MIN_PER_SCORE) consensusCount++;
  }
  let pDry = (Number.isFinite(leagueBaseline) ? leagueBaseline : 0.50) + weightedSum;
  pDry = Number(Math.max(0.10, Math.min(0.92, pDry)).toFixed(4));

  let signalEligible = true;
  let skipReason = null;

  if (!Number.isFinite(snapshotsCount) || snapshotsCount < MIN_SNAPSHOTS) {
    signalEligible = false;
    skipReason = `snapshots=${snapshotsCount} < ${MIN_SNAPSHOTS}`;
  } else if ((c.trajectory ?? 0) < TRAJECTORY_HARD_GATE) {
    signalEligible = false;
    skipReason = `trajectory=${c.trajectory} < ${TRAJECTORY_HARD_GATE}`;
  } else if (consensusCount < CONSENSUS_REQUIRED) {
    // Виняток: trajectory=1.0 + дуже сильний P_dry → знижуємо поріг до 3/5
    // (один слабкий компонент типу prematch/odds не блокує очевидно сухий матч)
    const strongTrajectory = (c.trajectory ?? 0) >= 1.0;
    const highPDry = pDry >= 0.88;
    if (strongTrajectory && highPDry && consensusCount >= 3) {
      skipReason = null; // пропускаємо
    } else {
      signalEligible = false;
      skipReason = `consensus=${consensusCount} < ${CONSENSUS_REQUIRED}`;
    }
  } else if (pDry < PDRY_THRESHOLD) {
    signalEligible = false;
    skipReason = `P_dry=${pDry} < ${PDRY_THRESHOLD}`;
  }

  return { pDry, weightedSum: Number(weightedSum.toFixed(4)), consensusCount, signalEligible, skipReason };
}

module.exports = {
  aggregatePDry,
  WEIGHTS,
  PDRY_THRESHOLD,
  CONSENSUS_REQUIRED,
  CONSENSUS_MIN_PER_SCORE,
  TRAJECTORY_HARD_GATE,
  MIN_SNAPSHOTS,
};
