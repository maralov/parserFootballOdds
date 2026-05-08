'use strict';

const env = require('../config/env');
const logger = require('../observability/logger');
const matchStore = require('../store/matchStore');
const { callAI } = require('./aiClient');
const {
  buildHalftimePrompt,
  buildDecision60Prompt,
  buildDecision80Prompt,
} = require('./prompts');

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

  if (minute >= 80 && !match.aiAnalysis?.decision80) return 'decision80';
  if (minute >= 60 && match.tracking?.validForPrediction && !match.aiAnalysis?.decision60) return 'decision60';
  if (minute >= 45 && !match.aiAnalysis?.halftime) return 'halftime';

  return null;
}

function shouldRunCheckpoint(checkpoint, match, cfg = env) {
  if (!cfg.LIVE_AI_ENABLED) return { run: false, skipReason: 'ai_disabled' };
  if (!cfg.OPENAI_API_KEY) return { run: false, skipReason: 'missing_api_key' };
  if (match?.statsLevel !== 'detailed') return { run: false, skipReason: 'stats_level_not_detailed' };
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

function buildPromptForCheckpoint(checkpoint, match) {
  if (checkpoint === 'halftime') return buildHalftimePrompt(match);
  if (checkpoint === 'decision60') return buildDecision60Prompt(match);
  if (checkpoint === 'decision80') return buildDecision80Prompt(match);
  return null;
}

async function maybeRequestAI(matchId, header, match, date = new Date(), deps = {}) {
  const cfg = deps.env || env;
  const store = deps.matchStore || matchStore;
  const callAIImpl = deps.callAI || callAI;

  const checkpoint = determineCheckpoint(header, match);
  if (!checkpoint) return null;

  const decision = shouldRunCheckpoint(checkpoint, match, cfg);
  if (!decision.run) {
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

  const prompt = buildPromptForCheckpoint(checkpoint, match);
  if (!prompt) return null;

  const requestedAt = new Date().toISOString();
  store.setAiAnalysis(matchId, checkpoint, {
    pending: true,
    requestedAt,
  }, date);

  let result;
  try {
    result = await callAIImpl({
      system: prompt.system,
      user: prompt.user,
      model: cfg.LIVE_AI_MODEL,
      temperature: cfg.LIVE_AI_TEMPERATURE,
      maxTokens: cfg.LIVE_AI_MAX_TOKENS,
      timeoutMs: cfg.LIVE_AI_TIMEOUT_MS,
      maxRetries: cfg.LIVE_AI_MAX_RETRIES,
      apiKey: cfg.OPENAI_API_KEY,
    });
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

  const payload = {
    ...result,
    requestedAt,
  };

  store.setAiAnalysis(matchId, checkpoint, payload, date);
  logger.info('aiOrchestrator: checkpoint processed', {
    matchId,
    checkpoint,
    error: result.error,
  });
  return payload;
}

module.exports = {
  maybeRequestAI,
  determineCheckpoint,
  shouldRunCheckpoint,
};
