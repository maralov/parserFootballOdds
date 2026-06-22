'use strict';

const env = require('../config/env');
const logger = require('../observability/logger');
const matchStore = require('../store/matchStore');
const { callAI } = require('../ai/aiClient');
const { buildHtTotalPrompt } = require('../ai/prompts/htTotal_Prompt');
const { validateHtTotalResponse } = require('../ai/schemas/htTotalSchema');

/**
 * Scope check: match must have a 1H prediction that passed D1's detailed+xG gates.
 * Excluded: no prediction, skipped_by_basic, skipped_by_xg.
 */
function hasHtTotalScope(match) {
  const EXCLUDED = new Set(['skipped_by_basic', 'skipped_by_xg']);
  const tm = match.predictions?.tm05_1h;
  const tb = match.predictions?.tb05_1h;
  const tmOk = tm != null && !EXCLUDED.has(tm.phase);
  const tbOk = tb != null && !EXCLUDED.has(tb.phase);
  return tmOk || tbOk;
}

/**
 * Run HT total prediction for a match at halftime.
 * Triggered once after resolveOneH settles the 1H bet.
 *
 * @param {string} matchId
 * @param {Object} snapshot  Last 1H snapshot
 * @param {{ home: number, away: number }} htScore  HT score
 * @param {Date}   [date]
 * @param {Object} [deps]
 * @returns {Promise<{ status: string }>}
 */
async function runHtTotalDecision(matchId, snapshot, htScore, date = new Date(), deps = {}) {
  const cfg = deps.env || env;
  const store = deps.matchStore || matchStore;
  const aiCall = deps.callAI || callAI;

  const match = store.getMatch(matchId, date);
  if (!match) return { status: 'no_match' };

  // Scope gate: only matches that passed D1's detailed+xG routing
  if (!hasHtTotalScope(match)) return { status: 'out_of_scope' };

  // Idempotency: if already predicted (or pending), skip
  const existing = match.predictions?.htTotal;
  if (existing?.phase === 'ht_pending' || existing?.phase === 'predicted' || existing?.phase === 'ht_error') {
    return { status: existing.phase };
  }

  // Mark pending
  store.setHtTotalDecision(matchId, {
    phase: 'ht_pending',
    decidedAt: new Date().toISOString(),
  }, date);

  const { system, user } = buildHtTotalPrompt(match, snapshot, htScore);

  const aiResult = await aiCall({
    system,
    user,
    model: cfg.LIVE_1H_AI_MODEL || cfg.LIVE_AI_MODEL || 'gpt-4o',
    temperature: cfg.LIVE_AI_TEMPERATURE ?? 0.2,
    maxTokens: cfg.LIVE_AI_MAX_TOKENS ?? 2500,
    maxRetries: cfg.LIVE_AI_MAX_RETRIES ?? 2,
    apiKey: cfg.OPENAI_API_KEY,
    validator: validateHtTotalResponse,
    useWebSearch: true,
    timeoutMs: cfg.LIVE_AI_WEB_SEARCH_TIMEOUT_MS ?? 90_000,
  });

  if (aiResult.error || !aiResult.output) {
    store.setHtTotalDecision(matchId, {
      phase: 'ht_error',
      aiError: aiResult.error || 'no output',
      decidedAt: new Date().toISOString(),
    }, date);
    logger.warn('runHtTotalDecision: AI error', { matchId, error: aiResult.error });
    return { status: 'ht_error', error: aiResult.error };
  }

  const { expected_goals, p_over_1_5, p_over_2_5, confidence, reasoning, key_signals, found_factors } = aiResult.output;

  // Feature log: raw 1H features alongside the prediction (for future statistical model)
  const features1H = {
    htScore,
    xG: snapshot?.cumulative?.expectedGoalsXg ?? null,
    shotsOnTarget: snapshot?.cumulative?.shotsOnTarget ?? null,
    touchesInOppositionBox: snapshot?.cumulative?.touchesInOppositionBox ?? null,
    ballPossession: snapshot?.ballPossession ?? null,
    favorite: match.odds?.isOddsFavorite?.favorite ?? null,
    drawOdds: match.odds?.draw ?? null,
  };

  store.setHtTotalDecision(matchId, {
    phase: 'predicted',
    expGoals: expected_goals,
    pOver15: p_over_1_5,
    pOver25: p_over_2_5,
    confidence,
    reasoning,
    keySignals: key_signals,
    foundFactors: found_factors,
    features1H,
    aiCostUsd: aiResult.costUsd ?? null,
    decidedAt: new Date().toISOString(),
  }, date);

  logger.info('runHtTotalDecision: done', {
    matchId, expGoals: expected_goals, pOver15: p_over_1_5, pOver25: p_over_2_5, confidence,
  });

  return { status: 'predicted', expGoals: expected_goals, pOver15: p_over_1_5, pOver25: p_over_2_5 };
}

module.exports = { runHtTotalDecision, hasHtTotalScope };
