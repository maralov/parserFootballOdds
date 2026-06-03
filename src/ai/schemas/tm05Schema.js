'use strict';

const VALID_DECISIONS = new Set(['BET', 'SKIP']);
const VALID_WEIGHTS = new Set(['high', 'med', 'medium', 'low']);

function isFiniteRange01(v) {
  return Number.isFinite(v) && v >= 0 && v <= 1;
}

function normalizeWeight(w) {
  if (w === 'medium') return 'med';
  return w;
}

function validateTm05Response(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'tm05: response is not an object' };
  }

  const decision = raw.decision ?? null; // optional, diagnostic only
  if (decision != null && !VALID_DECISIONS.has(decision)) {
    return { ok: false, error: `tm05: decision, if present, must be BET or SKIP, got "${decision}"` };
  }

  const pNoGoal = Number(raw.p_no_goal);
  if (!isFiniteRange01(pNoGoal)) {
    return { ok: false, error: `tm05: p_no_goal must be 0..1, got "${raw.p_no_goal}"` };
  }

  const confidence = Number(raw.confidence);
  if (!isFiniteRange01(confidence)) {
    return { ok: false, error: `tm05: confidence must be 0..1, got "${raw.confidence}"` };
  }

  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : '';
  const signals = Array.isArray(raw.key_signals) ? raw.key_signals : [];
  const normalizedSignals = signals.map((s) => ({
    signal: String(s?.signal || ''),
    value: String(s?.value ?? ''),
    weight: VALID_WEIGHTS.has(s?.weight) ? normalizeWeight(s.weight) : 'med',
  })).filter((s) => s.signal);

  return {
    ok: true,
    normalized: {
      track: 'TM05',
      decision: decision ?? null,
      p_no_goal: pNoGoal,
      confidence,
      reasoning,
      key_signals: normalizedSignals,
    },
  };
}

module.exports = { validateTm05Response };
