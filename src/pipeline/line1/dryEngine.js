'use strict';

const { computePace, computeIntensityRatio, PACE_METRICS } = require('./paceNormalizer');
const { dryFromIntensity, trajectoryDry, oddsDry, prematchDry } = require('./dryScoreComponents');
const { aggregatePDry } = require('./consensusAggregator');
const { applyHardGates } = require('./hardGates');
const { getLeagueBaseline } = require('../../helpers/leagueBaselines');
const { LINE1_DECISION_MIN, LINE1_DECISION_MAX } = require('../../helpers/constants');

/**
 * Compute delta between last two snapshots' raw2H and build a pace from it.
 * Returns { delta, minutesSpan } or null.
 */
function computeLast5MinDelta(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return null;
  const prev = snapshots[snapshots.length - 2];
  const cur  = snapshots[snapshots.length - 1];
  const delta = {};
  for (const k of PACE_METRICS) {
    const a = prev.raw2H?.[k];
    const b = cur.raw2H?.[k];
    if (Number.isFinite(a) && Number.isFinite(b)) delta[k] = b - a;
    else delta[k] = null;
  }
  const minutesSpan = Math.max(1, (cur.matchMinute || 0) - (prev.matchMinute || 0));
  return { delta, minutesSpan };
}

/**
 * Detect if score changed between any two consecutive snapshots.
 */
function detectScoreChange(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return false;
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1].score;
    const b = snapshots[i].score;
    if (!a || !b) continue;
    if (String(a.home) !== String(b.home) || String(a.away) !== String(b.away)) return true;
  }
  return false;
}

/**
 * Main entry point for Line 1. Returns decision + metadata for logging.
 */
function evaluateLine1Dry({ match, features, snapshots, incidents, preMatchAggregates }) {
  // Gate 1: must be 0:0
  const score = match?.score;
  const isZeroZero = score && String(score.home) === '0' && String(score.away) === '0';
  if (!isZeroZero) {
    return { bet: 'SKIP', signalEligible: false, reason: 'not 0:0', components: null, pDry: null };
  }

  // Gate 2: decision window
  const minute = Number(features?.minute);
  if (!Number.isFinite(minute) || minute < LINE1_DECISION_MIN || minute > LINE1_DECISION_MAX) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `minute=${minute} outside window ${LINE1_DECISION_MIN}-${LINE1_DECISION_MAX}`,
      components: null, pDry: null,
    };
  }

  // Gate 3: raw1H required
  if (!features?.raw1H) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: 'raw1H missing — Line 1 requires 1H stats',
      components: null, pDry: null,
    };
  }

  // Layer 1: pace normalization
  const pace1H = computePace(features.raw1H, 45);
  const minutes2H = Math.max(1, minute - 45);
  const pace2H = computePace(features.raw2H, minutes2H);
  const intensityRatio = computeIntensityRatio(pace2H, pace1H);

  // Layer 2: project 2H pace to full 45min for dry_2H component
  const projected2H = pace2H
    ? Object.fromEntries(Object.entries(pace2H).map(([k, v]) => [k, v == null ? null : v * 45]))
    : null;

  const components = {
    dry_1H:     dryFromIntensity(features.raw1H),
    dry_2H:     dryFromIntensity(projected2H),
    trajectory: trajectoryDry(intensityRatio),
    odds:       oddsDry(features.odds1X2),
    prematch:   prematchDry(preMatchAggregates),
  };

  // Layer 4: hard gates (computed before aggregator for early exit)
  const last5 = computeLast5MinDelta(snapshots);
  const intensityRatioLast = last5
    ? computeIntensityRatio(computePace(last5.delta, last5.minutesSpan), pace1H)
    : null;
  const bcDeltaLast = last5 ? (last5.delta.bigChances ?? 0) : 0;
  const scoreChanged = detectScoreChange(snapshots);

  const gate = applyHardGates({ incidents, intensityRatioLast, bcDeltaLast, scoreChanged });
  if (gate.skip) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `hard gate: ${gate.reason}`,
      components, pDry: null, intensityRatio, intensityRatioLast,
    };
  }

  // Layer 3: consensus aggregation
  const baseline = getLeagueBaseline(features.league);
  const agg = aggregatePDry({
    components,
    leagueBaseline: baseline,
    snapshotsCount: Array.isArray(snapshots) ? snapshots.length : 0,
  });

  return {
    bet: agg.signalEligible ? 'UNDER_0_5' : 'SKIP',
    signalEligible: agg.signalEligible,
    reason: agg.signalEligible
      ? `Line1 TM 0.5 — P_dry=${agg.pDry}, consensus=${agg.consensusCount}/5`
      : agg.skipReason,
    pDry: agg.pDry,
    weightedSum: agg.weightedSum,
    consensusCount: agg.consensusCount,
    components,
    leagueBaseline: baseline,
    intensityRatio,
    intensityRatioLast,
    minute,
  };
}

module.exports = { evaluateLine1Dry };
