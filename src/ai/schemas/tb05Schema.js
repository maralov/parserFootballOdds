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

function validateTb05Response(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'tb05: response is not an object' };
  }

  const decision = raw.decision;
  if (!VALID_DECISIONS.has(decision)) {
    return { ok: false, error: `tb05: decision must be BET or SKIP, got "${decision}"` };
  }

  const pGoal = Number(raw.p_goal);
  if (!isFiniteRange01(pGoal)) {
    return { ok: false, error: `tb05: p_goal must be 0..1, got "${raw.p_goal}"` };
  }

  const confidence = Number(raw.confidence);
  if (!isFiniteRange01(confidence)) {
    return { ok: false, error: `tb05: confidence must be 0..1, got "${raw.confidence}"` };
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
      track: 'TB05',
      decision,
      p_goal: pGoal,
      confidence,
      reasoning,
      key_signals: normalizedSignals,
    },
  };
}

module.exports = { validateTb05Response };
