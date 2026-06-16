'use strict';

const VALID_WEIGHTS = new Set(['high', 'med', 'medium', 'low']);
const VALID_DATA_AVAILABILITY = new Set(['rich', 'partial', 'none']);

function isFiniteRange01(v) {
  return Number.isFinite(v) && v >= 0 && v <= 1;
}

function normalizeWeight(w) {
  if (w === 'medium') return 'med';
  return w;
}

/**
 * Validate and normalize the raw LLM JSON for the 1H UNDER/OVER prediction.
 *
 * Expected shape:
 * {
 *   "p": <0..1>,                   // probability of the predicted outcome
 *   "confidence": <0..1>,           // model's own confidence
 *   "reasoning": "<string>",
 *   "key_signals": [{"signal":"…","value":"…","weight":"high"|"med"|"low"}],
 *   "data_availability": "rich"|"partial"|"none"
 * }
 */
function validateOneHResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'oneh: response is not an object' };
  }

  const p = Number(raw.p);
  if (!isFiniteRange01(p)) {
    return { ok: false, error: `oneh: p must be 0..1, got "${raw.p}"` };
  }

  const confidence = Number(raw.confidence);
  if (!isFiniteRange01(confidence)) {
    return { ok: false, error: `oneh: confidence must be 0..1, got "${raw.confidence}"` };
  }

  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : '';

  const signals = Array.isArray(raw.key_signals) ? raw.key_signals : [];
  const normalizedSignals = signals.map((s) => ({
    signal: String(s?.signal || ''),
    value: String(s?.value ?? ''),
    weight: VALID_WEIGHTS.has(s?.weight) ? normalizeWeight(s.weight) : 'med',
  })).filter((s) => s.signal);

  const rawAvail = raw.data_availability;
  const data_availability = VALID_DATA_AVAILABILITY.has(rawAvail) ? rawAvail : 'none';

  return {
    ok: true,
    normalized: {
      track: 'ONEH',
      p,
      confidence,
      reasoning,
      key_signals: normalizedSignals,
      data_availability,
    },
  };
}

module.exports = { validateOneHResponse };
