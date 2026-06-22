'use strict';

const env = require('../config/env');
const logger = require('../observability/logger');
const matchStore = require('../store/matchStore');
const { callAI } = require('../ai/aiClient');
const { buildOneHPrompt } = require('../ai/prompts/oneH_Prompt');
const { validateOneHResponse } = require('../ai/schemas/oneHSchema');
const { tm05_1hOddsAt, tb05_1hOddsAt } = require('../scoring/oddsTable');
const { evaluateEvGate } = require('./evGate');
const { isLockedPhase } = require('./lockPolicy');
const { evaluateConsensus } = require('./signalConsensus');
const { routeByXg } = require('./xgRouting');

/**
 * Re-read the live score from a cache-busted fetch of the match page. Used to
 * confirm the board is still 0:0 immediately before sending a signal, so a
 * stale 0:0 (live page lagging the real match) can't fire a doomed bet.
 *
 * @param {string} matchId
 * @returns {Promise<{scoreHome:number, scoreAway:number, minute:number|null}>}
 */
async function defaultConfirmLiveScore(matchId) {
  const { fetchResilient } = require('../fetcher/resilientFetcher');
  const { buildLiveStatsUrl, withCacheBuster } = require('../enrichment/helpers/urlBuilder');
  const { parseLiveHeader } = require('../tracker/parsers/liveHeaderParser');
  const { html } = await fetchResilient(withCacheBuster(buildLiveStatsUrl(matchId)));
  const h = parseLiveHeader(html);
  return { scoreHome: h.scoreHome, scoreAway: h.scoreAway, minute: h.minute };
}

/**
 * AI-powered decision engine for 1H UNDER/OVER.
 * Gate order:
 *   1. Detailed gate: skip if match.statsLevel !== 'detailed' (when LIVE_1H_DETAILED_ONLY !== false)
 *   2. xG routing: compute cumulative xG from snapshot, call routeByXg → direction or skip
 *   3. Mark ai_pending for the xG-determined direction
 *   4. AI call, consensus, min_p, goal-race, confirm-read
 *   5. EV gate: recorded for ROI analysis only (never blocks signal)
 * Idempotent via predictions.tm05_1h / predictions.tb05_1h (locked on terminal phases).
 *
 * @param {string} matchId
 * @param {Object} snapshot  the just-stored 1H snapshot
 * @param {Date}   [date]
 * @param {Object} [deps]
 * @returns {Promise<{status: string, ev?: number, direction?: string, dataAvailability?: string}>}
 */
async function runOneH_AiDecision(matchId, snapshot, date = new Date(), deps = {}) {
  const cfg = deps.env || env;
  const store = deps.matchStore || matchStore;
  const tgDispatcher = deps.tgDispatcher || null;
  const aiCall = deps.callAI || callAI;
  const confirmLiveScore = deps.confirmLiveScore || defaultConfirmLiveScore;

  const match = store.getMatch(matchId, date);
  if (!match) return { status: 'no_match' };
  if (match.tracking?.status !== 'active') return { status: 'not_active' };

  // Gate 1 — Detailed-only: skip matches without detailed stats
  if (cfg.LIVE_1H_DETAILED_ONLY !== false && match.statsLevel !== 'detailed') {
    const skippedAt = new Date().toISOString();
    store.setTm05_1hDecision(matchId, { phase: 'skipped_by_basic', decidedAt: skippedAt }, date);
    store.setTb05_1hDecision(matchId, { phase: 'skipped_by_basic', decidedAt: skippedAt }, date);
    logger.info('runOneH_AiDecision: SKIP by basic stats', { matchId, statsLevel: match.statsLevel });
    return { status: 'skipped_by_basic' };
  }

  // Gate 2 — xG routing: derive direction from cumulative expected goals
  const xgHome = snapshot?.cumulative?.expectedGoalsXg?.home ?? null;
  const xgAway = snapshot?.cumulative?.expectedGoalsXg?.away ?? null;
  const liveXg = (xgHome != null && xgAway != null) ? xgHome + xgAway : null;
  const xgRoute = routeByXg(liveXg, cfg);

  if (xgRoute === 'skip') {
    const skippedAt = new Date().toISOString();
    store.setTm05_1hDecision(matchId, { phase: 'skipped_by_xg', liveXg, decidedAt: skippedAt }, date);
    store.setTb05_1hDecision(matchId, { phase: 'skipped_by_xg', liveXg, decidedAt: skippedAt }, date);
    logger.info('runOneH_AiDecision: SKIP by xG routing', { matchId, liveXg });
    return { status: 'skipped_by_xg' };
  }

  const direction = xgRoute; // 'under' | 'over'
  const storeKey = direction === 'over' ? 'tb05_1h' : 'tm05_1h';
  const setDecision = direction === 'over'
    ? (id, payload, d) => store.setTb05_1hDecision(id, payload, d)
    : (id, payload, d) => store.setTm05_1hDecision(id, payload, d);

  const existing = match.predictions?.[storeKey];
  if (isLockedPhase(existing?.phase)) return { status: 'already_decided' };
  if (existing?.phase === 'ai_pending') return { status: 'ai_pending' };

  const minute = snapshot.observedMinute || snapshot.minute || cfg.LIVE_1H_DECISION_MIN || 25;

  // Mark pending immediately to prevent double-fire during slow AI call (~90s)
  setDecision(matchId, {
    phase: 'ai_pending',
    direction,
    decidedAt: new Date().toISOString(),
  }, date);

  const { system, user } = buildOneHPrompt(match, snapshot, direction);

  const aiResult = await aiCall({
    system,
    user,
    model: cfg.LIVE_1H_AI_MODEL || cfg.LIVE_AI_MODEL || 'gpt-4o',
    temperature: cfg.LIVE_AI_TEMPERATURE ?? 0.2,
    maxTokens: cfg.LIVE_AI_MAX_TOKENS ?? 2500,
    maxRetries: cfg.LIVE_AI_MAX_RETRIES ?? 2,
    apiKey: cfg.OPENAI_API_KEY,
    validator: validateOneHResponse,
    useWebSearch: true,
    timeoutMs: cfg.LIVE_AI_WEB_SEARCH_TIMEOUT_MS ?? 90_000,
  });

  if (aiResult.error || !aiResult.output) {
    setDecision(matchId, {
      phase: 'ai_error',
      direction,
      aiError: aiResult.error || 'no output',
      decidedAt: new Date().toISOString(),
    }, date);
    logger.warn('runOneH_AiDecision: AI error', { matchId, direction, error: aiResult.error });
    if (tgDispatcher?.sendAlert) {
      const matchName = `${match.homeTeam || '?'} — ${match.awayTeam || '?'}`;
      const errSnippet = String(aiResult.error || 'no output').slice(0, 120);
      tgDispatcher.sendAlert(`⚠️ AI помилка [${storeKey}]\n${matchName}\n${errSnippet}`).catch(() => {});
    }
    return { status: 'ai_error', error: aiResult.error };
  }

  const { p, confidence, reasoning, key_signals, data_availability } = aiResult.output;

  // P1 — consensus gate: flip-when-confident / skip-when-weak.
  // Directions are complementary (HT 0:0 vs ≥1 goal) → pComplement = 1 - p.
  let effDirection = direction;
  let effP = p;
  let consensus = null;
  if (cfg.LIVE_1H_CONSENSUS_GATE !== false) {
    consensus = evaluateConsensus({ direction, keySignals: key_signals });
    if (consensus.verdict === 'skip') {
      setDecision(matchId, {
        phase: 'skipped_by_consensus', direction, p, confidence,
        keySignals: key_signals, consensus, requestedAtMinute: minute,
        decidedAt: new Date().toISOString(),
      }, date);
      logger.info('runOneH_AiDecision: SKIP by consensus', { matchId, direction, reason: consensus.reason });
      return { status: 'skipped_by_consensus', direction };
    }
    if (consensus.verdict === 'flip') {
      effDirection = direction === 'over' ? 'under' : 'over';
      effP = +(1 - p).toFixed(4);
    }
  }

  // P2 — probability floor (after any flip). Never bet against our own probability.
  const minP = cfg.LIVE_1H_MIN_P ?? 0.50;
  if (effP < minP) {
    setDecision(matchId, {
      phase: 'skipped_by_min_p', direction: effDirection, p: effP, confidence,
      keySignals: key_signals, ...(consensus ? { consensus } : {}), requestedAtMinute: minute,
      decidedAt: new Date().toISOString(),
    }, date);
    logger.info('runOneH_AiDecision: SKIP by min_p', { matchId, direction: effDirection, p: effP, minP });
    return { status: 'skipped_by_min_p', direction: effDirection };
  }

  // Re-bind store target for the (possibly flipped) effective direction.
  const effStoreKey = effDirection === 'over' ? 'tb05_1h' : 'tm05_1h';
  const effSetDecision = effDirection === 'over'
    ? (id, payload, d) => store.setTb05_1hDecision(id, payload, d)
    : (id, payload, d) => store.setTm05_1hDecision(id, payload, d);
  if (effStoreKey !== storeKey && isLockedPhase(match.predictions?.[effStoreKey]?.phase)) {
    return { status: 'already_decided' };
  }
  if (effStoreKey !== storeKey) {
    setDecision(matchId, {
      phase: 'flipped_away', direction, flippedTo: effDirection,
      decidedAt: new Date().toISOString(),
    }, date);
  }

  const odds = effDirection === 'over' ? tb05_1hOddsAt(minute, match.odds) : tm05_1hOddsAt(minute, match.odds);
  const baseline = effDirection === 'over'
    ? (cfg.LIVE_1H_OVER_BASELINE_P ?? 0.40)
    : (cfg.LIVE_1H_UNDER_BASELINE_P ?? cfg.LIVE_1H_BASELINE_P ?? 0.42);

  const gate = evaluateEvGate({ probability: effP, confidence, odds, baseline });

  // Goal-during-decision race: if a goal appeared during the ~90s AI call, the live
  // 0:0 line is already closed — we can't place a bet regardless of direction.
  // For UNDER this is a MISS; for OVER this would have been a HIT, but we still
  // abort the TG signal (no entry sent). The htOutcome IS still written at halftime
  // via resolveOneH, so this case is visible in offline analysis.
  const freshMatch = store.getMatch(matchId, date);
  const goalBeforeHalftime = freshMatch?.tracking?.firstGoalMinute != null
    && freshMatch.tracking.firstGoalMinute <= 45;

  if (goalBeforeHalftime) {
    logger.info('runOneH_AiDecision: goal during AI call — signal aborted', {
      matchId, direction: effDirection,
      // For OVER: this goal would have been a HIT, but the live line is closed once a goal shows.
      // htOutcome is still recorded at halftime via resolveOneH for offline analysis.
      wouldBeHit: effDirection === 'over',
    });
  }

  // EV gate is record-only: result stored in payload for ROI analysis, never blocks the signal.
  let finalPhase = goalBeforeHalftime ? 'goal_during_decision' : 'signal';

  // Stale-0:0 guard: re-read live score before committing a signal
  let confirm = null;
  if (finalPhase === 'signal' && cfg.LIVE_1H_CONFIRM_BEFORE_SIGNAL === true) {
    try {
      const live = await confirmLiveScore(matchId);
      if (live && (live.scoreHome + live.scoreAway) > 0) {
        finalPhase = 'goal_during_decision';
        confirm = { ok: false, score: `${live.scoreHome}:${live.scoreAway}`, minute: live.minute ?? null };
        logger.info('runOneH_AiDecision: signal aborted — goal on confirm read', {
          matchId, direction: effDirection, confirmScore: confirm.score,
          // For OVER: goal confirms the OVER bet would win, but live line is now closed.
          wouldBeHit: effDirection === 'over',
        });
      } else if (live) {
        confirm = { ok: true, score: `${live.scoreHome}:${live.scoreAway}`, minute: live.minute ?? null };
      } else {
        confirm = { ok: null, reason: 'no_data' };
      }
    } catch (err) {
      confirm = { ok: null, reason: err.message };
      logger.warn('runOneH_AiDecision: confirm read failed, proceeding', { matchId, err: err.message });
    }
  }

  const payload = {
    phase: finalPhase,
    direction: effDirection,
    p: effP,
    confidence,
    dataAvailability: data_availability,
    reasoning,
    keySignals: key_signals,
    odds,
    evGate: gate,
    aiCostUsd: aiResult.costUsd ?? null,
    requestedAtMinute: minute,
    ...(effDirection !== direction ? { flippedFrom: direction } : {}),
    ...(consensus ? { consensus } : {}),
    ...(confirm ? { confirm } : {}),
    decidedAt: new Date().toISOString(),
  };

  effSetDecision(matchId, payload, date);

  if (finalPhase === 'signal' && tgDispatcher && cfg.LIVE_1H_TG_ENABLED) {
    setImmediate(() => {
      tgDispatcher.enqueueEntry({
        match: store.getMatch(matchId, date) || match,
        prediction: payload,
        decisionKey: effStoreKey,
        minute,
        score: '0:0',
        date,
      }).catch((err) => {
        logger.warn('tg.entry.oneh_ai_enqueue_failed', { matchId, err: err?.message || String(err) });
      });
    });
  }

  logger.info('runOneH_AiDecision: done', {
    matchId, direction: effDirection, p: effP, confidence, dataAvailability: data_availability,
    odds, ev: gate.ev, pass: gate.pass, phase: finalPhase,
  });

  return { status: finalPhase, ev: gate.ev, direction: effDirection, dataAvailability: data_availability };
}

module.exports = { runOneH_AiDecision };
