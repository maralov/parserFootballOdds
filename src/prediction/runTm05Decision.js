'use strict';

const env = require('../config/env');
const logger = require('../observability/logger');
const matchStore = require('../store/matchStore');
const { computeDS } = require('../scoring/drynessScore');
const { tm05OddsAt } = require('../scoring/oddsTable');
const { evaluateEvGate } = require('./evGate');
const { buildTm05Prompt } = require('../ai/prompts/tm05Prompt');
const { validateTm05Response } = require('../ai/schemas/tm05Schema');
const { callAI } = require('../ai/aiClient');

const DS_THRESHOLD_AI = 60;

/**
 * Decide on TM 0.5 for a match at the 60' snapshot.
 * Single-call-per-match contract: idempotent via matchStore.predictions.tm05.
 *
 * @param {string} matchId
 * @param {Object} snapshot60  the just-stored snapshot at observedMinute >= 60
 * @param {Date}   [date]
 * @param {Object} [deps]
 * @returns {Promise<{status: string, ev?: number, gateReason?: string}>}
 */
async function runTm05Decision(matchId, snapshot60, date = new Date(), deps = {}) {
  const cfg = deps.env || env;
  const store = deps.matchStore || matchStore;
  const callAIImpl = deps.callAI || callAI;
  const tgDispatcher = deps.tgDispatcher || null;

  const match = store.getMatch(matchId, date);
  if (!match) return { status: 'no_match' };
  if (match.tracking?.status !== 'active') return { status: 'not_active' };

  // Idempotency: only one AI call per match per track
  if (match.predictions?.tm05) return { status: 'already_decided' };

  // Compute DS using hydrated snapshot60 + older snapshots for delta context
  const hydrated = store.getHydratedSnapshots(matchId, date);
  const snap60 = hydrated.find(s => s.capturedAt === snapshot60.capturedAt) || snapshot60;
  const snapshotsBefore60 = hydrated.filter(s => (s.observedMinute || 0) < 60);

  const ds = computeDS(match, snap60);
  store.setTm05Decision(matchId, {
    phase: 'ds_computed',
    dsScore: ds.score,
    dsComponents: ds.components,
    decidedAt: new Date().toISOString(),
  }, date);

  if (ds.score == null || ds.score < DS_THRESHOLD_AI) {
    store.setTm05Decision(matchId, {
      phase: 'skipped_by_ds',
      dsScore: ds.score,
      dsComponents: ds.components,
      decision: 'SKIP',
      decidedAt: new Date().toISOString(),
    }, date);
    logger.info('runTm05Decision: SKIP by DS', { matchId, ds: ds.score });
    return { status: 'skipped_by_ds', dsScore: ds.score };
  }

  if (!cfg.LIVE_AI_ENABLED || !cfg.OPENAI_API_KEY) {
    store.setTm05Decision(matchId, {
      phase: 'ai_disabled',
      dsScore: ds.score,
      dsComponents: ds.components,
      decidedAt: new Date().toISOString(),
    }, date);
    return { status: 'ai_disabled', dsScore: ds.score };
  }

  // Skip if stats level not detailed (DS would be unreliable anyway)
  if (match.statsLevel !== 'detailed') {
    store.setTm05Decision(matchId, {
      phase: 'stats_not_detailed',
      dsScore: ds.score,
      decidedAt: new Date().toISOString(),
    }, date);
    return { status: 'stats_not_detailed' };
  }

  const enrichment = require('../store/enrichmentStore').getEnrichment(matchId, date) || {};
  const promptMatch = { ...match,
    standings: enrichment.standings || null,
    h2h: enrichment.h2h || null,
    statistics: enrichment.statistics || null };

  const prompt = buildTm05Prompt(promptMatch, snap60, snapshotsBefore60, ds);
  const requestedAt = new Date().toISOString();

  logger.info('runTm05Decision: calling AI', { matchId, ds: ds.score, model: cfg.LIVE_AI_MODEL });
  const aiResult = await callAIImpl({
    system: prompt.system,
    user: prompt.user,
    model: cfg.LIVE_AI_MODEL,
    temperature: cfg.LIVE_AI_TEMPERATURE,
    maxTokens: cfg.LIVE_AI_MAX_TOKENS,
    timeoutMs: cfg.LIVE_AI_WEB_SEARCH_TIMEOUT_MS || cfg.LIVE_AI_TIMEOUT_MS,
    maxRetries: cfg.LIVE_AI_MAX_RETRIES,
    apiKey: cfg.OPENAI_API_KEY,
    checkpoint: 'tm05',
    validator: validateTm05Response,
    useWebSearch: true,
  });

  if (aiResult.error || !aiResult.output) {
    store.setTm05Decision(matchId, {
      phase: 'ai_error',
      dsScore: ds.score,
      ai: aiResult,
      requestedAt,
      decidedAt: new Date().toISOString(),
    }, date);
    logger.warn('runTm05Decision: AI error', { matchId, error: aiResult.error });
    return { status: 'ai_error', error: aiResult.error };
  }

  const odds = tm05OddsAt(snap60.observedMinute || 60);
  const gate = evaluateEvGate({
    decision: aiResult.output.decision,
    probability: aiResult.output.p_no_goal,
    confidence: aiResult.output.confidence,
    odds,
  });

  // Goal-during-decision race check
  const fresh = store.getMatch(matchId, date);
  const lastSnap = fresh?.snapshots?.[fresh.snapshots.length - 1];
  const goalAfterCall = lastSnap && ((lastSnap.scoreHome || 0) + (lastSnap.scoreAway || 0) > 0);

  const finalPhase = goalAfterCall ? 'goal_during_decision'
    : gate.pass ? 'signal' : 'gate_blocked';

  const payload = {
    phase: finalPhase,
    dsScore: ds.score,
    dsComponents: ds.components,
    ai: aiResult,
    aiDecision: aiResult.output.decision,
    pNoGoal: aiResult.output.p_no_goal,
    confidence: aiResult.output.confidence,
    reasoning: aiResult.output.reasoning,
    keySignals: aiResult.output.key_signals,
    odds,
    evGate: gate,
    requestedAt,
    decidedAt: new Date().toISOString(),
  };

  store.setTm05Decision(matchId, payload, date);

  if (finalPhase === 'signal' && tgDispatcher) {
    setImmediate(() => {
      tgDispatcher.enqueueEntry({
        match: store.getMatch(matchId, date) || match,
        prediction: payload,
        decisionKey: 'tm05',
        minute: snap60.observedMinute || 60,
        score: '0:0',
        date,
      }).catch((err) => {
        logger.warn('tg.entry.tm05_enqueue_failed', { matchId, err: err?.message || String(err) });
      });
    });
  }

  logger.info('runTm05Decision: done', {
    matchId,
    ds: ds.score,
    aiDecision: aiResult.output.decision,
    ev: gate.ev,
    pass: gate.pass,
    phase: finalPhase,
  });

  return { status: finalPhase, ev: gate.ev, gateReason: gate.reason };
}

module.exports = { runTm05Decision, DS_THRESHOLD_AI };
