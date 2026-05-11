'use strict';

const ABSENCE_REASONS = ['injury', 'suspension', 'rest', 'other'];
const ABSENCE_IMPACT = ['low', 'medium', 'high'];
const LANGUAGE_OF_SOURCES = ['en', 'local', 'mixed'];
const FORM_QUALITY = ['poor', 'below_average', 'average', 'good', 'excellent'];
const TEAM_INTERNAL_STATE = ['stable', 'minor_tension', 'tension', 'crisis'];
const COACH_SITUATION = ['secure', 'under_pressure', 'rumors_of_change', 'newly_appointed'];
const LATE_GAME_PATTERN = ['defensive', 'balanced', 'attacking', 'not_found'];
const PITCH_CONDITION = ['good', 'poor', 'not_found'];
const EXPECTED_2H_PATTERN = ['low_tempo_likely', 'balanced', 'building_pressure', 'high_tempo_likely'];

function coerceNum01(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function coerceInt(v) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  }
  return undefined;
}

function coerceBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return undefined;
}

function normEnum(raw, allowed) {
  if (raw == null) return undefined;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  return allowed.includes(s) ? s : undefined;
}

/**
 * Flatten wrappers (same spirit as schemas.normalizeAIResponse).
 * @param {unknown} parsed
 * @returns {object|null}
 */
function unwrapHalftimePayload(parsed) {
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

function normalizeAbsence(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const player = entry.player != null ? String(entry.player).trim() : '';
  if (!player) return null;
  const source_freshness_days = coerceInt(entry.source_freshness_days);
  return {
    player,
    reason: normEnum(entry.reason, ABSENCE_REASONS) || 'other',
    impact: normEnum(entry.impact, ABSENCE_IMPACT) || 'medium',
    source_freshness_days: source_freshness_days == null || source_freshness_days < 0
      ? 999
      : source_freshness_days,
  };
}

function normalizeFormLast5(v) {
  if (v == null) return 'not_found';
  const s = String(v).trim().toUpperCase();
  return /^[WDL]{5}$/.test(s) ? s : 'not_found';
}

function normalizeTeamSide(side) {
  if (!side || typeof side !== 'object') return null;
  const absRaw = Array.isArray(side.key_absences) ? side.key_absences : [];
  const key_absences = absRaw.map(normalizeAbsence).filter(Boolean);
  const lineupStrength = coerceNum01(side.lineup_strength_vs_normal);
  return {
    starting_lineup_known: Boolean(coerceBool(side.starting_lineup_known)),
    lineup_strength_vs_normal: lineupStrength == null ? 0 : lineupStrength,
    key_absences,
    form_last_5: normalizeFormLast5(side.form_last_5),
    form_quality_assessment: normEnum(side.form_quality_assessment, FORM_QUALITY) || 'average',
    team_internal_state: normEnum(side.team_internal_state, TEAM_INTERNAL_STATE) || 'stable',
    coach_situation: normEnum(side.coach_situation, COACH_SITUATION) || 'secure',
    tactical_style: side.tactical_style == null ? 'not_found' : String(side.tactical_style),
    late_game_pattern: normEnum(side.late_game_pattern, LATE_GAME_PATTERN) || 'not_found',
  };
}

function normalizeImportance(v) {
  const n = coerceInt(v);
  if (n == null) return 0;
  if (n < 0) return 0;
  if (n > 3) return 3;
  return n;
}

function normalizeHalftimeResearchResponse(parsed) {
  const root = unwrapHalftimePayload(parsed);
  if (!root) return null;

  const research_meta = root.research_meta && typeof root.research_meta === 'object'
    ? root.research_meta
    : {};
  const sq = Array.isArray(research_meta.search_queries_made)
    ? research_meta.search_queries_made.map(q => String(q))
    : [];
  const rq = coerceNum01(research_meta.research_quality);
  const dfs = coerceInt(research_meta.data_freshness_days);
  const sc = coerceInt(research_meta.sources_consulted);
  const language_of_sources = normEnum(research_meta.language_of_sources, LANGUAGE_OF_SOURCES) || 'mixed';

  const home_team = normalizeTeamSide(root.home_team);
  const away_team = normalizeTeamSide(root.away_team);

  const contextRaw = root.match_context && typeof root.match_context === 'object' ? root.match_context : {};
  const weatherRaw = contextRaw.weather && typeof contextRaw.weather === 'object' ? contextRaw.weather : {};
  const match_context = {
    tournament_importance_home: normalizeImportance(contextRaw.tournament_importance_home),
    tournament_importance_away: normalizeImportance(contextRaw.tournament_importance_away),
    tournament_importance_explanation_home: contextRaw.tournament_importance_explanation_home == null
      ? ''
      : String(contextRaw.tournament_importance_explanation_home),
    tournament_importance_explanation_away: contextRaw.tournament_importance_explanation_away == null
      ? ''
      : String(contextRaw.tournament_importance_explanation_away),
    rotation_risk_home: coerceNum01(contextRaw.rotation_risk_home) ?? 0,
    rotation_risk_away: coerceNum01(contextRaw.rotation_risk_away) ?? 0,
    is_derby_or_rivalry: Boolean(coerceBool(contextRaw.is_derby_or_rivalry)),
    rivalry_notes: contextRaw.rivalry_notes == null ? null : String(contextRaw.rivalry_notes),
    weather: {
      conditions: weatherRaw.conditions == null ? 'not_found' : String(weatherRaw.conditions),
      may_affect_play: Boolean(coerceBool(weatherRaw.may_affect_play)),
    },
    pitch_condition: normEnum(contextRaw.pitch_condition, PITCH_CONDITION) || 'not_found',
    venue_factor: contextRaw.venue_factor == null ? null : String(contextRaw.venue_factor),
  };

  const h2hRaw = root.h2h_qualitative && typeof root.h2h_qualitative === 'object' ? root.h2h_qualitative : {};
  const h2h_qualitative = {
    common_pattern: h2hRaw.common_pattern == null ? 'not_found' : String(h2hRaw.common_pattern),
    notable_recent_h2h: h2hRaw.notable_recent_h2h == null ? 'not_found' : String(h2hRaw.notable_recent_h2h),
    h2h_low_scoring_tendency: Boolean(coerceBool(h2hRaw.h2h_low_scoring_tendency)),
  };

  const fhRaw = root.first_half_interpretation && typeof root.first_half_interpretation === 'object'
    ? root.first_half_interpretation
    : {};
  const first_half_interpretation = {
    score_consistent_with_research:
      coerceBool(fhRaw.score_consistent_with_research) === undefined
        ? false
        : Boolean(fhRaw.score_consistent_with_research),
    explanation: fhRaw.explanation == null ? '' : String(fhRaw.explanation),
    expected_2h_pattern: normEnum(fhRaw.expected_2h_pattern, EXPECTED_2H_PATTERN) || 'balanced',
    key_factor_driving_pattern: fhRaw.key_factor_driving_pattern == null ? '' : String(fhRaw.key_factor_driving_pattern),
  };

  const probRaw = root.probabilities && typeof root.probabilities === 'object'
    ? root.probabilities
    : {};
  const p00 = coerceNum01(probRaw.p_match_ends_0_0);
  const pg = coerceNum01(probRaw.p_match_has_goal);
  const reasoning_for_probabilities = probRaw.reasoning_for_probabilities != null
    ? String(probRaw.reasoning_for_probabilities)
    : '';

  const topConf = coerceNum01(root.confidence);
  const rf = Array.isArray(root.red_flags)
    ? root.red_flags.map(x => String(x))
    : [];

  if (!home_team || !away_team) return null;

  const out = {
    research_meta: {
      search_queries_made: sq,
      sources_consulted: sc == null || sc < 0 ? 0 : sc,
      research_quality: rq == null ? 0 : rq,
      data_freshness_days: dfs == null || dfs < 0 ? 999 : dfs,
      language_of_sources,
    },
    home_team,
    away_team,
    match_context,
    h2h_qualitative,
    first_half_interpretation,
    probabilities: {
      p_match_ends_0_0: p00,
      p_match_has_goal: pg,
      reasoning_for_probabilities,
    },
    confidence: topConf,
    red_flags: rf,
  };

  return out;
}

function isFiniteProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateHalftimeResearchResponse(parsed) {
  const rawRoot = unwrapHalftimePayload(parsed);
  if (!rawRoot) {
    return { ok: false, error: 'Payload must be an object', normalized: null };
  }

  for (const top of [
    'research_meta',
    'home_team',
    'away_team',
    'match_context',
    'h2h_qualitative',
    'first_half_interpretation',
    'probabilities',
    'confidence',
    'red_flags',
  ]) {
    if (rawRoot[top] === undefined) {
      return { ok: false, error: `Missing: ${top}`, normalized: null };
    }
  }

  const normalized = normalizeHalftimeResearchResponse(parsed);
  if (!normalized || typeof normalized !== 'object') {
    return { ok: false, error: 'Payload must be an object', normalized: null };
  }

  const { research_meta } = normalized;
  if (!Array.isArray(research_meta.search_queries_made)) {
    return { ok: false, error: 'research_meta.search_queries_made must be an array', normalized: null };
  }
  if (!isFiniteProbability(research_meta.research_quality)) {
    return { ok: false, error: 'research_meta.research_quality must be within [0, 1]', normalized: null };
  }
  if (!LANGUAGE_OF_SOURCES.includes(research_meta.language_of_sources)) {
    return { ok: false, error: 'research_meta.language_of_sources invalid', normalized: null };
  }

  for (const side of ['home_team', 'away_team']) {
    const t = normalized[side];
    if (typeof t.starting_lineup_known !== 'boolean') {
      return { ok: false, error: `${side}.starting_lineup_known invalid`, normalized: null };
    }
    if (!isFiniteProbability(t.lineup_strength_vs_normal)) {
      return { ok: false, error: `${side}.lineup_strength_vs_normal invalid`, normalized: null };
    }
    if (!FORM_QUALITY.includes(t.form_quality_assessment)) {
      return { ok: false, error: `${side}.form_quality_assessment invalid`, normalized: null };
    }
    if (!TEAM_INTERNAL_STATE.includes(t.team_internal_state)) {
      return { ok: false, error: `${side}.team_internal_state invalid`, normalized: null };
    }
    if (!COACH_SITUATION.includes(t.coach_situation)) {
      return { ok: false, error: `${side}.coach_situation invalid`, normalized: null };
    }
    if (!LATE_GAME_PATTERN.includes(t.late_game_pattern)) {
      return { ok: false, error: `${side}.late_game_pattern invalid`, normalized: null };
    }
    for (const abs of t.key_absences) {
      if (!abs.player || !ABSENCE_REASONS.includes(abs.reason) || !ABSENCE_IMPACT.includes(abs.impact)) {
        return { ok: false, error: `${side}.key_absences invalid entry`, normalized: null };
      }
    }
  }

  const { match_context } = normalized;
  if (!isFiniteProbability(match_context.rotation_risk_home)
    || !isFiniteProbability(match_context.rotation_risk_away)) {
    return { ok: false, error: 'match_context.rotation_risk_* invalid', normalized: null };
  }
  if (!PITCH_CONDITION.includes(match_context.pitch_condition)) {
    return { ok: false, error: 'match_context.pitch_condition invalid', normalized: null };
  }

  if (!EXPECTED_2H_PATTERN.includes(normalized.first_half_interpretation.expected_2h_pattern)) {
    return { ok: false, error: 'first_half_interpretation.expected_2h_pattern invalid', normalized: null };
  }

  const { probabilities } = normalized;
  if (!isFiniteProbability(probabilities.p_match_ends_0_0)
    || !isFiniteProbability(probabilities.p_match_has_goal)) {
    return { ok: false, error: 'probabilities p_match_* must be within [0, 1]', normalized: null };
  }

  if (!probabilities.reasoning_for_probabilities || probabilities.reasoning_for_probabilities.trim().length === 0) {
    return { ok: false, error: 'probabilities.reasoning_for_probabilities is required', normalized: null };
  }

  if (!normalized.first_half_interpretation.key_factor_driving_pattern.trim()) {
    return { ok: false, error: 'first_half_interpretation.key_factor_driving_pattern is required', normalized: null };
  }

  const sum = probabilities.p_match_ends_0_0 + probabilities.p_match_has_goal;
  if (Math.abs(sum - 1) > 0.05) {
    return { ok: false, error: 'Probabilities must sum to 1.0 within tolerance', normalized: null };
  }

  if (!isFiniteProbability(normalized.confidence)) {
    return { ok: false, error: 'confidence must be within [0, 1]', normalized: null };
  }

  if (!Array.isArray(normalized.red_flags)) {
    return { ok: false, error: 'red_flags must be an array', normalized: null };
  }

  return { ok: true, error: null, normalized };
}

module.exports = {
  normalizeHalftimeResearchResponse,
  validateHalftimeResearchResponse,
  LANGUAGE_OF_SOURCES,
  FORM_QUALITY,
  TEAM_INTERNAL_STATE,
  COACH_SITUATION,
  LATE_GAME_PATTERN,
  PITCH_CONDITION,
  EXPECTED_2H_PATTERN,
};
