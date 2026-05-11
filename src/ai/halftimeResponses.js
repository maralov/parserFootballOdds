'use strict';

const OpenAI = require('openai');
const { calculateResponsesCost } = require('./costCalculator');
const { validateHalftimeResearchResponse } = require('./halftimeSchema');

let cachedClient = null;

function getClient(apiKey) {
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function isFiniteProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function classifyValidationError(message) {
  if (!message) return 'unknown';
  const msg = String(message).toLowerCase();
  if (msg.includes('json parse failed')) return 'json_parse';
  if (msg.includes('schema invalid')) return 'schema';
  if (msg.includes('probabilities don')) return 'probabilities';
  if (msg.includes('timeout after')) return 'timeout';
  return 'other';
}

/**
 * Web search + json_object text format is rejected by the API (400).
 * We request plain text and extract JSON (prompt still demands STRICT JSON only).
 * @param {string} raw
 * @returns {object}
 */
function parseJsonFromResponsesText(raw) {
  if (raw == null || typeof raw !== 'string') {
    throw new Error('JSON parse failed: empty response');
  }
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const tryParse = chunk => {
    const p = JSON.parse(chunk);
    if (p && typeof p === 'object' && !Array.isArray(p)) return p;
    throw new Error('JSON parse failed: root is not an object');
  };

  try {
    return tryParse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return tryParse(s.slice(start, end + 1));
    }
    throw new Error('JSON parse failed: no JSON object in response');
  }
}

function normalizeSource(url, title = '', snippet = '') {
  if (!url) return null;
  return { url, title, snippet };
}

function extractSearchTelemetry(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  const sources = [];
  let webSearchCallsCount = 0;

  for (const item of output) {
    if (item?.type !== 'web_search_call') continue;
    webSearchCallsCount += 1;

    const actionSources = Array.isArray(item?.action?.sources) ? item.action.sources : [];
    for (const src of actionSources) {
      const normalized = normalizeSource(src?.url, src?.title || '', src?.snippet || '');
      if (normalized) sources.push(normalized);
    }

    const results = Array.isArray(item?.results) ? item.results : [];
    for (const r of results) {
      const normalized = normalizeSource(r?.url, r?.title || '', r?.snippet || r?.content || '');
      if (normalized) sources.push(normalized);
    }
  }

  const uniq = [];
  const seen = new Set();
  for (const src of sources) {
    if (seen.has(src.url)) continue;
    seen.add(src.url);
    uniq.push(src);
  }

  return { webSearchCallsCount, citedSources: uniq };
}

function makeQualityFlags(output) {
  const rq = output?.research_meta?.research_quality;
  const sources = output?.research_meta?.sources_consulted;
  const conf = output?.confidence;
  const lowResearch = typeof rq === 'number' && rq < 0.3;
  const noSources = typeof sources === 'number' && sources <= 0;
  const lowConfidence = typeof conf === 'number' && conf < 0.4;
  return {
    useInModel: !(lowResearch || noSources),
    weightMultiplier: lowConfidence ? 0.5 : 1,
  };
}

async function requestWithTimeout(requester, timeoutMs) {
  return Promise.race([
    requester(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/**
 * @param {{ system: string, user: string }} prompt
 * @param {object} cfg
 * @param {{ client?: OpenAI }} [deps]
 */
async function performHalftimeResearch(prompt, cfg, deps = {}) {
  const startedAt = Date.now();
  const model = cfg.LIVE_AI_HT_MODEL || cfg.LIVE_AI_MODEL;
  const timeoutMs = cfg.LIVE_AI_HT_RESPONSES_TIMEOUT_MS || 90_000;
  const baseTemperature = cfg.LIVE_AI_HT_TEMPERATURE ?? 0.3;

  const client = deps.client || getClient(cfg.OPENAI_API_KEY);
  if (!client) {
    return {
      output: null,
      citedSources: [],
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      completionTokens: 0,
      webSearchCallsCount: 0,
      costUsd: null,
      useInModel: false,
      weightMultiplier: 0.5,
      error: 'OPENAI_API_KEY is missing',
    };
  }

  const runOnce = async temperature => {
    const response = await requestWithTimeout(
      () => client.responses.create({
        model,
        tools: [{
          type: 'web_search_preview',
          search_context_size: 'medium',
        }],
        tool_choice: 'auto',
        instructions: prompt.system,
        input: prompt.user,
        temperature,
        max_output_tokens: cfg.LIVE_AI_HT_MAX_TOKENS,
        include: ['web_search_call.results', 'web_search_call.action.sources'],
      }),
      timeoutMs,
    );

    const rawOutput = response?.output_text || '';
    let parsed;
    try {
      parsed = parseJsonFromResponsesText(rawOutput);
    } catch (parseError) {
      throw new Error(`JSON parse failed: ${parseError.message}`);
    }

    const validation = validateHalftimeResearchResponse(parsed);
    if (!validation.ok) {
      throw new Error(`Schema invalid: ${validation.error}`);
    }

    const p0 = validation.normalized?.probabilities?.p_match_ends_0_0;
    const p1 = validation.normalized?.probabilities?.p_match_has_goal;
    const sumProb = (p0 || 0) + (p1 || 0);
    if (!isFiniteProbability(p0) || !isFiniteProbability(p1) || Math.abs(sumProb - 1.0) > 0.05) {
      throw new Error(`Probabilities don't sum to 1.0: ${sumProb}`);
    }

    const usage = response?.usage || {};
    const telemetry = extractSearchTelemetry(response);
    const qualityFlags = makeQualityFlags(validation.normalized);
    return {
      output: validation.normalized,
      citedSources: telemetry.citedSources,
      latencyMs: Date.now() - startedAt,
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
      webSearchCallsCount: telemetry.webSearchCallsCount,
      costUsd: calculateResponsesCost(usage, model),
      useInModel: qualityFlags.useInModel,
      weightMultiplier: qualityFlags.weightMultiplier,
      model,
      error: null,
    };
  };

  try {
    return await runOnce(baseTemperature);
  } catch (firstErr) {
    const kind = classifyValidationError(firstErr.message);
    if (kind === 'timeout') {
      return {
        output: null,
        citedSources: [],
        latencyMs: Date.now() - startedAt,
        promptTokens: 0,
        completionTokens: 0,
        webSearchCallsCount: 0,
        costUsd: null,
        useInModel: false,
        weightMultiplier: 0.5,
        model,
        error: firstErr.message,
      };
    }

    if (kind === 'json_parse' || kind === 'schema' || kind === 'probabilities') {
      try {
        return await runOnce(0.1);
      } catch (secondErr) {
        return {
          output: null,
          citedSources: [],
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          webSearchCallsCount: 0,
          costUsd: null,
          useInModel: false,
          weightMultiplier: 0.5,
          model,
          error: secondErr.message,
        };
      }
    }

    return {
      output: null,
      citedSources: [],
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      completionTokens: 0,
      webSearchCallsCount: 0,
      costUsd: null,
      useInModel: false,
      weightMultiplier: 0.5,
      model,
      error: firstErr.message,
    };
  }
}

module.exports = {
  performHalftimeResearch,
  extractSearchTelemetry,
  parseJsonFromResponsesText,
};
