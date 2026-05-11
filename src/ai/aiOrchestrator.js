'use strict';

const env = require('../config/env');
const logger = require('../observability/logger');
const matchStore = require('../store/matchStore');
const { appendHalftimeAudit } = require('../store/aiHalftimeAudit');
const { callAI } = require('./aiClient');
const { performHalftimeResearch } = require('./halftimeResponses');
const {
  buildHalftimePrompt,
  buildDecision60Prompt,
  buildDecision80Prompt,
} = require('./prompts');
const { mergeDecision60ServerMetrics } = require('./features/buildDecision60Features');
const { mergeDecision80ServerMetrics } = require('./features/buildDecision80Features');
const { decision60UseInModel, decision80UseInModel } = require('./decisionUseInModel');

function totalFirstHalfXg(match) {
  const home = match?.baseline1H?.expectedGoalsXg?.home;
  const away = match?.baseline1H?.expectedGoalsXg?.away;
  if (home == null || away == null) return null;
  return home + away;
}

function determineCheckpoint(header, match) {
  if (!header || !match) return null;
  const { minute, scoreHome, scoreAway } = header;

  if (scoreHome !== 0 || scoreAway !== 0) return null;

  if (
    minute >= 80 &&
    !match.aiAnalysis?.decision80 &&
    !match.predictionLocks?.blockTb80Plus
  ) {
    return 'decision80';
  }
  if (minute >= 60 && match.tracking?.validForPrediction && !match.aiAnalysis?.decision60) return 'decision60';
  if (minute >= 45 && !match.aiAnalysis?.halftime) return 'halftime';

  return null;
}

function shouldRunCheckpoint(checkpoint, match, cfg = env) {
  if (!cfg.LIVE_AI_ENABLED) return { run: false, skipReason: 'ai_disabled' };
  if (!cfg.OPENAI_API_KEY) return { run: false, skipReason: 'missing_api_key' };
  // GPT лише для detailed: basic збирається окремо без токенів; прогноз — зліт basic+detailed+AI.
  if (match?.statsLevel !== 'detailed') {
    return { run: false, skipReason: 'stats_level_not_detailed' };
  }
  if (match?.aiAnalysis?.[checkpoint] !== undefined) return { run: false, skipReason: 'checkpoint_already_recorded' };

  if (checkpoint === 'halftime') {
    const xg = totalFirstHalfXg(match);
    if (xg == null) return { run: false, skipReason: 'missing_first_half_xg' };
    if (xg >= cfg.LIVE_AI_HT_XG_THRESHOLD) return { run: false, skipReason: 'xg_above_threshold' };
  }

  if (checkpoint === 'decision60' && !match?.tracking?.validForPrediction) {
    return { run: false, skipReason: 'match_not_valid_for_prediction' };
  }

  return { run: true, skipReason: null };
}

async function buildPromptForCheckpoint(checkpoint, match, cfg) {
  if (checkpoint === 'halftime') {
    return buildHalftimePrompt(match, {
      timezone: cfg.LIVE_AI_MATCH_TIMEZONE,
      now: new Date(),
    });
  }
  if (checkpoint === 'decision60') return buildDecision60Prompt(match);
  if (checkpoint === 'decision80') return buildDecision80Prompt(match);
  return null;
}

async function maybeRequestAI(matchId, header, match, date = new Date(), deps = {}) {
  const cfg = deps.env || env;
  const store = deps.matchStore || matchStore;
  const callAIImpl = deps.callAI || callAI;
  const performHalftimeResearchImpl = deps.performHalftimeResearch || performHalftimeResearch;

  const checkpoint = determineCheckpoint(header, match);
  if (!checkpoint) return null;

  const decision = shouldRunCheckpoint(checkpoint, match, cfg);
  if (!decision.run) {
    logger.info('aiOrchestrator: skipped', {
      matchId,
      checkpoint,
      skipReason: decision.skipReason,
    });
    if (checkpoint === 'halftime' && decision.skipReason === 'xg_above_threshold') {
      return store.setAiAnalysis(matchId, checkpoint, {
        output: null,
        skipped: true,
        reason: decision.skipReason,
        requestedAt: new Date().toISOString(),
      }, date);
    }
    return null;
  }

  const requestedAt = new Date().toISOString();
  store.setAiAnalysis(matchId, checkpoint, {
    pending: true,
    requestedAt,
  }, date);

  let prompt;
  try {
    prompt = await buildPromptForCheckpoint(checkpoint, match, cfg);
  } catch (err) {
    store.setAiAnalysis(matchId, checkpoint, {
      output: null,
      latencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      model: cfg.LIVE_AI_MODEL,
      costUsd: null,
      error: err.message,
      requestedAt,
    }, date);
    logger.warn('aiOrchestrator: prompt build failed', {
      matchId,
      checkpoint,
      error: err.message,
    });
    return null;
  }

  if (!prompt) {
    store.setAiAnalysis(matchId, checkpoint, {
      output: null,
      latencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      model: cfg.LIVE_AI_MODEL,
      costUsd: null,
      error: 'prompt_unavailable',
      requestedAt,
    }, date);
    return null;
  }

  logger.info('aiOrchestrator: requesting', {
    matchId,
    checkpoint,
    model: checkpoint === 'halftime' ? cfg.LIVE_AI_HT_MODEL : cfg.LIVE_AI_MODEL,
    statsLevel: match?.statsLevel || 'unknown',
  });

  let result;
  try {
    if (checkpoint === 'halftime') {
      result = await performHalftimeResearchImpl(prompt, cfg);
    } else {
      result = await callAIImpl({
        system: prompt.system,
        user: prompt.user,
        model: cfg.LIVE_AI_MODEL,
        temperature: cfg.LIVE_AI_TEMPERATURE,
        maxTokens: cfg.LIVE_AI_MAX_TOKENS,
        timeoutMs: cfg.LIVE_AI_TIMEOUT_MS,
        maxRetries: cfg.LIVE_AI_MAX_RETRIES,
        apiKey: cfg.OPENAI_API_KEY,
        checkpoint,
      });
    }
  } catch (error) {
    result = {
      output: null,
      latencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      model: cfg.LIVE_AI_MODEL,
      costUsd: null,
      error: error.message,
    };
  }

  let output = result.output;
  let useInModel = false;

  if (!result.error && output) {
    if (checkpoint === 'halftime') {
      useInModel = result.useInModel ?? false;
    } else if (checkpoint === 'decision60') {
      output = mergeDecision60ServerMetrics(match, output);
      useInModel = decision60UseInModel(match, header, output);
    } else if (checkpoint === 'decision80') {
      output = mergeDecision80ServerMetrics(match, output);
      useInModel = decision80UseInModel(match, header, output);
    }
  }

  const payload = {
    ...result,
    output,
    useInModel,
    requestedAt,
  };

  store.setAiAnalysis(matchId, checkpoint, payload, date);
  if (checkpoint === 'halftime') {
    appendHalftimeAudit(matchId, {
      matchInfo: `${match?.homeTeam || 'unknown'} vs ${match?.awayTeam || 'unknown'}`,
      halftimeAI: {
        success: !result.error && !!result.output,
        latencyMs: result.latencyMs,
        webSearches: result.webSearchCallsCount || 0,
        searchQueries: result.output?.research_meta?.search_queries_made || [],
        researchQuality: result.output?.research_meta?.research_quality ?? null,
        dataFreshnessDays: result.output?.research_meta?.data_freshness_days ?? null,
        confidence: result.output?.confidence ?? null,
        redFlags: result.output?.red_flags || [],
        sourcesCount: result.output?.research_meta?.sources_consulted ?? 0,
        costUsd: result.costUsd ?? null,
        useInModel: result.useInModel ?? false,
        weightMultiplier: result.weightMultiplier ?? 0.5,
        error: result.error || null,
      },
    }, date);
  }

  if (result.error) {
    logger.warn('aiOrchestrator: checkpoint failed', {
      matchId,
      checkpoint,
      error: result.error,
      latencyMs: result.latencyMs,
    });
  } else {
    const pZero = result.output?.probabilities?.p_match_ends_0_0;
    logger.info('aiOrchestrator: checkpoint completed', {
      matchId,
      checkpoint,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: result.costUsd,
      pZero,
      confidence: result.output?.confidence,
    });
  }
  return payload;
}

module.exports = {
  maybeRequestAI,
  determineCheckpoint,
  shouldRunCheckpoint,
  buildPromptForCheckpoint,
};
