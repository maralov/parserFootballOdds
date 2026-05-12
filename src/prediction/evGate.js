'use strict';

const DEFAULTS = {
  evMin: 1.10,
  confidenceMin: 0.65,
};

/**
 * Final mathematical sanity check before dispatching a bet signal.
 *
 * @param {Object} args
 * @param {'BET'|'SKIP'|string} args.decision
 * @param {number|null}         args.probability  AI-returned probability for the bet outcome (0..1)
 * @param {number|null}         args.confidence   AI-stated confidence (0..1)
 * @param {number|null}         args.odds         odds from normative table for the minute
 * @param {Object}              [args.thresholds] override defaults
 * @returns {{ pass: boolean, reason: string|null, ev: number|null }}
 */
function evaluateEvGate({ decision, probability, confidence, odds, thresholds } = {}) {
  const T = { ...DEFAULTS, ...(thresholds || {}) };

  if (decision !== 'BET') {
    return { pass: false, reason: 'decision_not_bet', ev: null };
  }
  if (probability == null || !Number.isFinite(probability)) {
    return { pass: false, reason: 'probability_missing', ev: null };
  }
  if (probability < 0 || probability > 1) {
    return { pass: false, reason: 'probability_out_of_range', ev: null };
  }
  if (confidence == null || !Number.isFinite(confidence)) {
    return { pass: false, reason: 'confidence_missing', ev: null };
  }
  if (confidence < T.confidenceMin) {
    return { pass: false, reason: 'low_confidence', ev: null };
  }
  if (odds == null || !Number.isFinite(odds) || odds <= 1) {
    return { pass: false, reason: 'odds_invalid', ev: null };
  }

  const ev = +(probability * odds).toFixed(4);
  if (ev < T.evMin) {
    return { pass: false, reason: 'negative_ev', ev };
  }

  return { pass: true, reason: null, ev };
}

module.exports = { evaluateEvGate, DEFAULTS };
