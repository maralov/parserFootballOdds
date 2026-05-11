'use strict';

const DECISION_80_MATCH_STATES = [
  'dead',
  'low_activity',
  'fake_pressure',
  'pressure_building',
  'late_siege',
  'chaotic',
];

const DECISION_80_LATE_GOAL_SCENARIO = ['unlikely', 'possible', 'likely'];

const DECISION_80_PRESSURE_TEAM = ['home', 'away', 'both', 'none'];

const DECISION_80_PRESSURE_QUALITY = ['none', 'fake', 'real'];

const DECISION_80_RECOMMENDATION_ACTIONS = [
  'no_bet',
  'protect_under',
  'under_candidate',
  'late_goal_candidate',
];

const DECISION_80_REC_CONFIDENCE = ['low', 'medium', 'high'];

const DECISION_80_MOTIVATION_TEAM = ['home', 'away', 'none'];

const DECISION_80_MOTIVATION_STRENGTH = ['high', 'medium', 'low'];

const DECISION_80_RISK_FLAGS = [
  'missing_xg',
  'only_corners_no_shots',
  'favorite_passive',
  'red_card_changed_game',
  'scoreboard_pressure_unclear',
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

function normalizeLastBlock(block) {
  const b = block && typeof block === 'object' ? block : {};
  return {
    shots: coerceNonNeg(b.shots) ?? 0,
    shots_on_target: coerceNonNeg(b.shots_on_target ?? b.shotsOnTarget) ?? 0,
    corners: coerceNonNeg(b.corners) ?? 0,
    xg: b.xg == null || b.xg === '' ? 0 : (coerceProb(b.xg) ?? 0),
    danger_score: coerceProb(b.danger_score ?? b.dangerScore) ?? 0,
  };
}

function normalizeDecision80(root) {
  const probsIn = root.probabilities && typeof root.probabilities === 'object'
    ? root.probabilities
    : {};

  const p00 = coerceProb(probsIn.p_match_ends_0_0 ?? root.p_match_ends_0_0);
  const pAfter80 = coerceProb(probsIn.p_goal_after_80 ?? root.p_goal_after_80);
  const pStoppageRaw = probsIn.p_goal_in_stoppage_time ?? root.p_goal_in_stoppage_time;
  let pStoppage = coerceProb(pStoppageRaw);
  if (pStoppage === undefined) pStoppage = 0;

  const recIn = pickRecommendation(root);

  return {
    checkpoint: 'decision80',
    minute: coerceMinute(root.minute) ?? 80,
    match_state: normEnum(root.match_state, DECISION_80_MATCH_STATES),
    late_goal_scenario: normEnumWithAliases(root.late_goal_scenario, DECISION_80_LATE_GOAL_SCENARIO, {
      low: 'unlikely',
      medium: 'possible',
      high: 'likely',
      very_likely: 'likely',
      very_unlikely: 'unlikely',
    }),
    pressure_team: normEnumWithAliases(root.pressure_team, DECISION_80_PRESSURE_TEAM, {
      home_team: 'home',
      away_team: 'away',
      neutral: 'none',
      neither: 'none',
    }),
    pressure_quality: normEnumWithAliases(root.pressure_quality, DECISION_80_PRESSURE_QUALITY, {
      low: 'none',
      weak: 'fake',
      medium: 'real',
      high: 'real',
      genuine: 'real',
    }),
    last_10_minutes: normalizeLastBlock(root.last_10_minutes),
    last_20_minutes: normalizeLastBlock(root.last_20_minutes),
    probabilities: {
      p_match_ends_0_0: p00,
      p_goal_after_80: pAfter80,
      p_goal_in_stoppage_time: pStoppage,
    },
    recommendation: {
      action: normEnumWithAliases(recIn.action, DECISION_80_RECOMMENDATION_ACTIONS, {
        no_action: 'no_bet',
        under: 'under_candidate',
        lean_under_05: 'protect_under',
        goal: 'late_goal_candidate',
        over: 'late_goal_candidate',
      }),
      confidence: normEnum(recIn.confidence, DECISION_80_REC_CONFIDENCE),
      reason: recIn.reason != null ? String(recIn.reason).trim() : '',
    },
    motivation_asymmetry: {
      team_that_must_score: normEnum(
        root.motivation_asymmetry?.team_that_must_score,
        DECISION_80_MOTIVATION_TEAM
      ),
      strength: normEnum(
        root.motivation_asymmetry?.strength,
        DECISION_80_MOTIVATION_STRENGTH
      ),
      reason: root.motivation_asymmetry?.reason != null
        ? String(root.motivation_asymmetry.reason).trim()
        : '',
    },
    risk_flags: Array.isArray(root.risk_flags)
      ? root.risk_flags.map(x => String(x).trim()).filter(Boolean)
      : [],
    confidence: coerceProb(root.confidence),
  };
}

function validateDecision80Response(parsed) {
  const root = unwrapPayload(parsed);
  if (!root) {
    return { ok: false, error: 'Payload must be an object', normalized: null };
  }

  const n = normalizeDecision80(root);

  if (n.minute !== 80) {
    return { ok: false, error: 'minute must be 80 for decision80', normalized: null };
  }

  if (!n.match_state) {
    return { ok: false, error: 'match_state must be one of the allowed enum values', normalized: null };
  }
  if (!n.late_goal_scenario || !n.pressure_team || !n.pressure_quality) {
    return { ok: false, error: 'late_goal_scenario / pressure_team / pressure_quality enums invalid', normalized: null };
  }

  const { probabilities: p } = n;
  if (!isProb(p.p_match_ends_0_0) || !isProb(p.p_goal_after_80) || !isProb(p.p_goal_in_stoppage_time)) {
    return { ok: false, error: 'probabilities must be numbers within [0, 1]', normalized: null };
  }

  if (Math.abs(p.p_match_ends_0_0 + p.p_goal_after_80 - 1) > 0.08) {
    return { ok: false, error: 'p_match_ends_0_0 + p_goal_after_80 must sum to ~1', normalized: null };
  }

  if (p.p_goal_in_stoppage_time > p.p_goal_after_80 + 0.05) {
    return {
      ok: false,
      error: 'p_goal_in_stoppage_time cannot exceed p_goal_after_80 materially',
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

  const flags = n.risk_flags.filter(f => DECISION_80_RISK_FLAGS.includes(f));
  n.risk_flags = flags;

  return { ok: true, error: null, normalized: n };
}

module.exports = {
  DECISION_80_MATCH_STATES,
  DECISION_80_LATE_GOAL_SCENARIO,
  DECISION_80_PRESSURE_TEAM,
  DECISION_80_PRESSURE_QUALITY,
  DECISION_80_MOTIVATION_TEAM,
  DECISION_80_MOTIVATION_STRENGTH,
  DECISION_80_RISK_FLAGS,
  validateDecision80Response,
  normalizeDecision80,
};
