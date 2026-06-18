'use strict';

// Maps a first-half Dryness Score (0..100) to P(0:0 at halftime).
//
// 1HUNDER does not use AI at launch — this monotone mapping is the probability
// source feeding evGate. It is intentionally a single, well-documented function:
// this is THE calibration point. As real outcomes accumulate, refit slope/intercept
// from scripts/firstHalfCalibration.js.
//
// Calibration note (2026-06-18, P0): SLOPE/INTERCEPT were updated from
// (0.0045/0.30) to (0.006/0.52) to align with real market odds (max ~1.95
// for 1H UNDER vs the stale fictional 2.60). At DS=90 (very dry match):
// p≈0.76, pAdj≈0.62 at conf=0.6, ev≈1.22 at odds=1.95 — +EV confirmed.

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const SLOPE = 0.006;       // probability gained per DS point above the pivot
const PIVOT = 50;          // DS at which p == INTERCEPT
const INTERCEPT = 0.52;
const P_MIN = 0.30;
const P_MAX = 0.80;

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
