'use strict';

const DEFAULTS = {
  evMin: 1.10,
  baseline: 0.45, // per-track baseline probability; pass explicitly per track
};

/**
 * EV gate — sole BET/SKIP decision-maker.
 * Confidence is a soft shrink toward baseline, NOT a hard cutoff:
 *   pAdj = baseline + (probability - baseline) * confidence
 *
 * @returns {{ pass:boolean, reason:string|null, ev:number|null, pAdj:number|null }}
 */
function evaluateEvGate({ probability, confidence, odds, baseline, thresholds } = {}) {
  const T = { ...DEFAULTS, ...(thresholds || {}) };
  const base = Number.isFinite(baseline) ? baseline : T.baseline;

  if (probability == null || !Number.isFinite(probability)) {
    return { pass: false, reason: 'probability_missing', ev: null, pAdj: null };
  }
  if (probability < 0 || probability > 1) {
    return { pass: false, reason: 'probability_out_of_range', ev: null, pAdj: null };
  }
  const conf = (confidence == null || !Number.isFinite(confidence))
    ? 1 : Math.min(1, Math.max(0, confidence));
  if (odds == null || !Number.isFinite(odds) || odds <= 1) {
    return { pass: false, reason: 'odds_invalid', ev: null, pAdj: null };
  }

  const pAdj = +(base + (probability - base) * conf).toFixed(4);
  const ev = +(pAdj * odds).toFixed(4);
  if (ev < T.evMin) {
    return { pass: false, reason: 'negative_ev', ev, pAdj };
  }
  return { pass: true, reason: null, ev, pAdj };
}

module.exports = { evaluateEvGate, DEFAULTS };
