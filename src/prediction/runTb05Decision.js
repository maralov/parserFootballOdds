'use strict';

const env = require('../config/env');
const logger = require('../observability/logger');
const matchStore = require('../store/matchStore');
const { computePS } = require('../scoring/pressureScore');
const { tb05OddsAt } = require('../scoring/oddsTable');
const { evaluateEvGate } = require('./evGate');
const { buildTb05Prompt } = require('../ai/prompts/tb05Prompt');
const { validateTb05Response } = require('../ai/schemas/tb05Schema');
const { callAI } = require('../ai/aiClient');

const PS_THRESHOLD_AI = 60;

function findSnapshotByMinute(snapshots, target) {
  if (!snapshots?.length) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const m = s.minute ?? s.observedMinute;
    if (m == null) continue;
    const diff = Math.abs(m - target);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best;
}

/**
 * Decide on TB 0.5 for a match at the 80' snapshot (score still 0:0).
 *
 * @param {string} matchId
 * @param {Object} snapshot80
 * @param {Date}   [date]
 * @param {Object} [deps]
 */
async function runTb05Decision(matchId, snapshot80, date = new Date(), deps = {}) {
  const cfg = deps.env || env;
  const store = deps.matchStore || matchStore;
  const callAIImpl = deps.callAI || callAI;
  const tgDispatcher = deps.tgDispatcher || null;

  const match = store.getMatch(matchId, date);
  if (!match) return { status: 'no_match' };
  if (match.tracking?.status !== 'active') return { status: 'not_active' };

  // Must still be 0:0 at 80'
  if ((snapshot80.scoreHome || 0) + (snapshot80.scoreAway || 0) > 0) {
    return { status: 'not_scoreless' };
  }

  if (match.predictions?.tb05) return { status: 'already_decided' };

  const snapshots = match.snapshots || [];
  const snapshot60 = findSnapshotByMinute(snapshots, 60);

  const ps = computePS(match, snapshot80, snapshot60);
  store.setTb05Decision(matchId, {
    phase: 'ps_computed',
    psScore: ps.score,
    psComponents: ps.components,
    decidedAt: new Date().toISOString(),
  }, date);

  if (ps.score == null || ps.score < PS_THRESHOLD_AI) {
    store.setTb05Decision(matchId, {
      phase: 'skipped_by_ps',
      psScore: ps.score,
      psComponents: ps.components,
      decision: 'SKIP',
      decidedAt: new Date().toISOString(),
    }, date);
    logger.info('runTb05Decision: SKIP by PS', { matchId, ps: ps.score });
    return { status: 'skipped_by_ps', psScore: ps.score };
  }

  if (!cfg.LIVE_AI_ENABLED || !cfg.OPENAI_API_KEY) {
    store.setTb05Decision(matchId, {
      phase: 'ai_disabled',
      psScore: ps.score,
      decidedAt: new Date().toISOString(),
    }, date);
    return { status: 'ai_disabled', psScore: ps.score };
  }

  if (match.statsLevel !== 'detailed') {
    store.setTb05Decision(matchId, {
      phase: 'stats_not_detailed',
      psScore: ps.score,
      decidedAt: new Date().toISOString(),
    }, date);
    return { status: 'stats_not_detailed' };
  }

  const prompt = buildTb05Prompt(match, snapshot80, snapshots, ps);
  const requestedAt = new Date().toISOString();

  logger.info('runTb05Decision: calling AI', { matchId, ps: ps.score, model: cfg.LIVE_AI_MODEL });
  const aiResult = await callAIImpl({
    system: prompt.system,
    user: prompt.user,
    model: cfg.LIVE_AI_MODEL,
    temperature: cfg.LIVE_AI_TEMPERATURE,
    maxTokens: cfg.LIVE_AI_MAX_TOKENS,
    timeoutMs: cfg.LIVE_AI_WEB_SEARCH_TIMEOUT_MS || cfg.LIVE_AI_TIMEOUT_MS,
    maxRetries: cfg.LIVE_AI_MAX_RETRIES,
    apiKey: cfg.OPENAI_API_KEY,
    checkpoint: 'tb05',
    validator: validateTb05Response,
    useWebSearch: true,
  });

  if (aiResult.error || !aiResult.output) {
    store.setTb05Decision(matchId, {
      phase: 'ai_error',
      psScore: ps.score,
      ai: aiResult,
      requestedAt,
      decidedAt: new Date().toISOString(),
    }, date);
    logger.warn('runTb05Decision: AI error', { matchId, error: aiResult.error });
    return { status: 'ai_error', error: aiResult.error };
  }

  const odds = tb05OddsAt(snapshot80.observedMinute || 80);
  const gate = evaluateEvGate({
    decision: aiResult.output.decision,
    probability: aiResult.output.p_goal,
    confidence: aiResult.output.confidence,
    odds,
  });

  const fresh = store.getMatch(matchId, date);
  const lastSnap = fresh?.snapshots?.[fresh.snapshots.length - 1];
  const goalAfterCall = lastSnap && ((lastSnap.scoreHome || 0) + (lastSnap.scoreAway || 0) > 0);
  const finalPhase = goalAfterCall ? 'goal_during_decision'
    : gate.pass ? 'signal' : 'gate_blocked';

  const payload = {
    phase: finalPhase,
    psScore: ps.score,
    psComponents: ps.components,
    ai: aiResult,
    aiDecision: aiResult.output.decision,
    pGoal: aiResult.output.p_goal,
    confidence: aiResult.output.confidence,
    reasoning: aiResult.output.reasoning,
    keySignals: aiResult.output.key_signals,
    odds,
    evGate: gate,
    requestedAt,
    decidedAt: new Date().toISOString(),
  };

  store.setTb05Decision(matchId, payload, date);

  if (finalPhase === 'signal' && tgDispatcher) {
    setImmediate(() => {
      tgDispatcher.enqueueEntry({
        match: store.getMatch(matchId, date) || match,
        prediction: payload,
        decisionKey: 'tb05',
        minute: snapshot80.observedMinute || 80,
        score: '0:0',
        date,
      }).catch((err) => {
        logger.warn('tg.entry.tb05_enqueue_failed', { matchId, err: err?.message || String(err) });
      });
    });
  }

  logger.info('runTb05Decision: done', {
    matchId,
    ps: ps.score,
    aiDecision: aiResult.output.decision,
    ev: gate.ev,
    pass: gate.pass,
    phase: finalPhase,
  });

  return { status: finalPhase, ev: gate.ev, gateReason: gate.reason };
}

module.exports = { runTb05Decision, PS_THRESHOLD_AI };
