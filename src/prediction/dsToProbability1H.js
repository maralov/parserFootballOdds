'use strict';

// Maps a first-half Dryness Score (0..100) to P(0:0 at halftime).
//
// 1HUNDER does not use AI at launch — this monotone mapping is the probability
// source feeding evGate. It is intentionally a single, well-documented function:
// this is THE calibration point. As real outcomes accumulate, refit slope/intercept
// from scripts/firstHalfCalibration.js.

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const SLOPE = 0.0045;      // probability gained per DS point above the pivot
const PIVOT = 50;          // DS at which p == INTERCEPT
const INTERCEPT = 0.30;
const P_MIN = 0.30;
const P_MAX = 0.75;

/**
 * @param {number|null} dsScore  first-half dryness score (0..100)
 * @returns {number|null} probability in [P_MIN, P_MAX], or null if dsScore missing
 */
function dsToProbability1H(dsScore) {
  if (dsScore == null || !Number.isFinite(dsScore)) return null;
  const p = INTERCEPT + SLOPE * (dsScore - PIVOT);
  return +clamp(p, P_MIN, P_MAX).toFixed(4);
}

module.exports = { dsToProbability1H, SLOPE, PIVOT, INTERCEPT, P_MIN, P_MAX };
