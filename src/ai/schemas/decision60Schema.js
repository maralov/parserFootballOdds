'use strict';

const DECISION_60_MATCH_STATES = [
  'dead',
  'low_activity',
  'balanced',
  'pressure_building',
  'high_pressure',
  'chaotic',
];

const DECISION_60_TEMPO_STATES = ['falling', 'flat', 'growing', 'explosive'];

const DECISION_60_FAVORITE_PRESSURE = ['none', 'weak', 'moderate', 'strong'];

const DECISION_60_UNDERDOG_RESISTANCE = ['comfortable', 'under_pressure', 'breaking'];

const DECISION_60_ATTACKING_TREND = ['down', 'flat', 'up'];

const DECISION_60_CHANCE_QUALITY_TREND = ['none', 'low', 'medium', 'high'];

const DECISION_60_PRESSURE_DIRECTION = ['home', 'away', 'both', 'none'];

const DECISION_60_RECOMMENDATION_ACTIONS = [
  'no_bet',
  'lean_under',
  'under_candidate',
  'lean_goal',
  'goal_candidate',
];

const DECISION_60_REC_CONFIDENCE = ['low', 'medium', 'high'];

const DECISION_60_RISK_FLAGS = [
  'missing_xg',
  'basic_stats_only',
  'favorite_not_pressing',
  'random_late_goal_risk',
  'red_card',
  'data_inconsistent',
];

function unwrapPayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  let root = { ...parsed };
  for (const wrap of ['analysis', 'result', 'response', 'data', 'output']) {
    const inner = root[wrap];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      root = { ...inner, ...root };
    }
  }
  return root;
}

function normEnum(raw, allowed) {
  if (raw == null) return undefined;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  return allowed.includes(s) ? s : undefined;
}

function normEnumWithAliases(raw, allowed, aliases = {}) {
  const normalized = normEnum(raw, allowed);
  if (normalized) return normalized;
  if (raw == null) return undefined;
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  const mapped = aliases[key];
  return mapped && allowed.includes(mapped) ? mapped : undefined;
}

function coerceProb(v) {
  if (v == null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function isProb(v) {
  return Number.isFinite(v) && v >= 0 && v <= 1;
}

function coerceMinute(v) {
  const n = coerceProb(v);
  return n == null ? undefined : Math.round(n);
}

function coerceNonNeg(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function pickRecommendation(root) {
  const rec =
    root.recommendation && typeof root.recommendation === 'object'
      ? root.recommendation
      : {};

  const action =
    rec.action
    ?? root.recommendation_action
    ?? root.recommendationAction
    ?? root.action;

  const confidence =
    rec.confidence
    ?? root.recommendation_confidence
    ?? root.recommendationConfidence
    ?? root.action_confidence;

  const reason =
    rec.reason
    ?? root.recommendation_reason
    ?? root.recommendationReason
    ?? root.reason;

  return { action, confidence, reason };
}

function normalizeDecision60(root) {
  const probsIn = root.probabilities && typeof root.probabilities === 'object'
    ? root.probabilities
    : {};

  const p00 = coerceProb(probsIn.p_match_ends_0_0 ?? root.p_match_ends_0_0);
  const pAfter60 = coerceProb(probsIn.p_goal_after_60 ?? root.p_goal_after_60);
  const p6075 = coerceProb(probsIn.p_goal_60_75 ?? root.p_goal_60_75);
  const pAfter75 = coerceProb(probsIn.p_goal_after_75 ?? root.p_goal_after_75);

  const trendIn = root.trend_45_60 && typeof root.trend_45_60 === 'object'
    ? root.trend_45_60
    : {};

  const recIn = pickRecommendation(root);

  const shaIn = root.second_half_activity && typeof root.second_half_activity === 'object'
    ? root.second_half_activity
    : {};

  return {
    checkpoint: 'decision60',
    minute: coerceMinute(root.minute) ?? 60,
    match_state: normEnum(root.match_state, DECISION_60_MATCH_STATES),
    tempo_state: normEnum(root.tempo_state, DECISION_60_TEMPO_STATES),
    favorite_pressure: normEnumWithAliases(root.favorite_pressure, DECISION_60_FAVORITE_PRESSURE, {
      low: 'weak',
      medium: 'moderate',
      high: 'strong',
      passive: 'weak',
      no_pressure: 'none',
      no_favorite_pressure: 'none',
      weak_pressure: 'weak',
      medium_pressure: 'moderate',
      strong_pressure: 'strong',
    }),
    underdog_resistance: normEnumWithAliases(root.underdog_resistance, DECISION_60_UNDERDOG_RESISTANCE, {
      stable: 'comfortable',
      holding: 'comfortable',
      resilient: 'comfortable',
      uncomfortable: 'under_pressure',
      pressured: 'under_pressure',
      underpressure: 'under_pressure',
      collapse: 'breaking',
      collapsing: 'breaking',
    }),
    second_half_activity: {
      shots_since_ht: coerceNonNeg(shaIn.shots_since_ht) ?? 0,
      shots_on_target_since_ht: coerceNonNeg(shaIn.shots_on_target_since_ht) ?? 0,
      corners_since_ht: coerceNonNeg(shaIn.corners_since_ht) ?? 0,
      xg_since_ht: shaIn.xg_since_ht == null || shaIn.xg_since_ht === ''
        ? 0
        : (coerceProb(shaIn.xg_since_ht) ?? 0),
      danger_score: coerceProb(shaIn.danger_score) ?? 0,
    },
    trend_45_60: {
      attacking_trend: normEnum(trendIn.attacking_trend, DECISION_60_ATTACKING_TREND),
      chance_quality_trend: normEnum(trendIn.chance_quality_trend, DECISION_60_CHANCE_QUALITY_TREND),
      pressure_direction: normEnum(trendIn.pressure_direction, DECISION_60_PRESSURE_DIRECTION),
    },
    probabilities: {
      p_match_ends_0_0: p00,
      p_goal_after_60: pAfter60,
      p_goal_60_75: p6075,
      p_goal_after_75: pAfter75,
    },
    recommendation: {
      action: normEnumWithAliases(recIn.action, DECISION_60_RECOMMENDATION_ACTIONS, {
        under: 'under_candidate',
        lean_under_05: 'lean_under',
        under_candidate_05: 'under_candidate',
        over: 'goal_candidate',
        goal: 'goal_candidate',
        lean_goal_05: 'lean_goal',
      }),
      confidence: normEnum(recIn.confidence, DECISION_60_REC_CONFIDENCE),
      reason: recIn.reason != null ? String(recIn.reason).trim() : '',
    },
    risk_flags: Array.isArray(root.risk_flags)
      ? root.risk_flags.map(x => String(x).trim()).filter(Boolean)
      : [],
    confidence: coerceProb(root.confidence),
  };
}

function validateDecision60Response(parsed) {
  const root = unwrapPayload(parsed);
  if (!root) {
    return { ok: false, error: 'Payload must be an object', normalized: null };
  }

  const n = normalizeDecision60(root);

  if (n.minute !== 60) {
    return { ok: false, error: 'minute must be 60 for decision60', normalized: null };
  }

  if (!n.match_state) {
    return { ok: false, error: 'match_state must be one of the allowed enum values', normalized: null };
  }
  if (!n.tempo_state) {
    return { ok: false, error: 'tempo_state must be one of the allowed enum values', normalized: null };
  }
  if (!n.favorite_pressure) {
    return { ok: false, error: 'favorite_pressure must be one of the allowed enum values', normalized: null };
  }
  if (!n.underdog_resistance) {
    return { ok: false, error: 'underdog_resistance must be one of the allowed enum values', normalized: null };
  }

  const t = n.trend_45_60;
  if (!t.attacking_trend || !t.chance_quality_trend || !t.pressure_direction) {
    return { ok: false, error: 'trend_45_60 enums invalid or missing', normalized: null };
  }

  const { probabilities: p } = n;
  if (!isProb(p.p_match_ends_0_0) || !isProb(p.p_goal_after_60)
    || !isProb(p.p_goal_60_75) || !isProb(p.p_goal_after_75)) {
    return { ok: false, error: 'probabilities must be numbers within [0, 1]', normalized: null };
  }

  if (Math.abs(p.p_match_ends_0_0 + p.p_goal_after_60 - 1) > 0.08) {
    return { ok: false, error: 'p_match_ends_0_0 + p_goal_after_60 must sum to ~1', normalized: null };
  }

  if (Math.abs(p.p_goal_60_75 + p.p_goal_after_75 - p.p_goal_after_60) > 0.15) {
    return {
      ok: false,
      error: 'p_goal_60_75 + p_goal_after_75 must approximate p_goal_after_60',
      normalized: null,
    };
  }

  if (!n.recommendation.action || !n.recommendation.confidence) {
    return { ok: false, error: 'recommendation.action and recommendation.confidence required', normalized: null };
  }

  if (!n.recommendation.reason) {
    return { ok: false, error: 'recommendation.reason must be non-empty', normalized: null };
  }

  if (!isProb(n.confidence)) {
    return { ok: false, error: 'confidence must be within [0, 1]', normalized: null };
  }

  const flags = n.risk_flags.filter(f => DECISION_60_RISK_FLAGS.includes(f));
  n.risk_flags = flags;

  return { ok: true, error: null, normalized: n };
}

module.exports = {
  DECISION_60_MATCH_STATES,
  DECISION_60_TEMPO_STATES,
  DECISION_60_FAVORITE_PRESSURE,
  DECISION_60_UNDERDOG_RESISTANCE,
  DECISION_60_RISK_FLAGS,
  validateDecision60Response,
  normalizeDecision60,
};
