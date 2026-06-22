'use strict';

const VALID_WEIGHTS = new Set(['high', 'med', 'medium', 'low']);

function isFiniteRange01(v) {
  return Number.isFinite(v) && v >= 0 && v <= 1;
}

function normalizeWeight(w) {
  if (w === 'medium') return 'med';
  return w;
}

/**
 * Validate and normalize the raw LLM JSON for the HT Total prediction.
 *
 * Expected shape:
 * {
 *   "expected_goals": <0..∞>,         // expected goals for the full match
 *   "p_over_1_5": <0..1>,             // P(total ≥ 2)
 *   "p_over_2_5": <0..1>,             // P(total ≥ 3)
 *   "confidence": <0..1>,             // model's own confidence
 *   "reasoning": "<string>",
 *   "key_signals": [{"signal":"…","value":"…","weight":"high"|"med"|"low"}],
 *   "found_factors": <boolean>        // true if a strong 2H factor was found
 * }
 */
function validateHtTotalResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'ht_total: response is not an object' };
  }

  const expected_goals = Number(raw.expected_goals);
  if (!Number.isFinite(expected_goals) || expected_goals < 0) {
    return { ok: false, error: `ht_total: expected_goals must be a finite number ≥ 0, got "${raw.expected_goals}"` };
  }

  const p_over_1_5 = Number(raw.p_over_1_5);
  if (!isFiniteRange01(p_over_1_5)) {
    return { ok: false, error: `ht_total: p_over_1_5 must be 0..1, got "${raw.p_over_1_5}"` };
  }

  const p_over_2_5 = Number(raw.p_over_2_5);
  if (!isFiniteRange01(p_over_2_5)) {
    return { ok: false, error: `ht_total: p_over_2_5 must be 0..1, got "${raw.p_over_2_5}"` };
  }

  const confidence = Number(raw.confidence);
  if (!isFiniteRange01(confidence)) {
    return { ok: false, error: `ht_total: confidence must be 0..1, got "${raw.confidence}"` };
  }

  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : '';

  const signals = Array.isArray(raw.key_signals) ? raw.key_signals : [];
  const normalizedSignals = signals.map((s) => ({
    signal: String(s?.signal || ''),
    value: String(s?.value ?? ''),
    weight: VALID_WEIGHTS.has(s?.weight) ? normalizeWeight(s.weight) : 'med',
  })).filter((s) => s.signal);

  const found_factors = typeof raw.found_factors === 'boolean' ? raw.found_factors : false;

  return {
    ok: true,
    normalized: {
      track: 'HT_TOTAL',
      expected_goals,
      p_over_1_5,
      p_over_2_5,
      confidence,
      reasoning,
      key_signals: normalizedSignals,
      found_factors,
    },
  };
}

module.exports = { validateHtTotalResponse };
