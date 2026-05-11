'use strict';

const OpenAI = require('openai');
const { calculateCost } = require('./costCalculator');
const { validateDecision60Response } = require('./schemas/decision60Schema');
const { validateDecision80Response } = require('./schemas/decision80Schema');

let cachedClient = null;

function getClient(apiKey) {
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function pickValidator(checkpoint) {
  if (checkpoint === 'decision60') return validateDecision60Response;
  if (checkpoint === 'decision80') return validateDecision80Response;
  throw new Error(`callAI: unsupported checkpoint "${checkpoint}"`);
}

function defaultRequesterFactory(apiKey) {
  return async function requester(params) {
    const client = getClient(apiKey);
    if (!client) throw new Error('OPENAI_API_KEY is missing');

    return client.chat.completions.create({
      model: params.model,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      response_format: { type: 'json_object' },
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    });
  };
}

async function defaultSleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function callAI(options, deps = {}) {
  const {
    system,
    user,
    model,
    temperature,
    maxTokens,
    timeoutMs,
    maxRetries = 2,
    apiKey,
    checkpoint,
  } = options;

  const validatePayload = output => pickValidator(checkpoint)(output);

  const requester = deps.requester || defaultRequesterFactory(apiKey);
  const sleep = deps.sleep || defaultSleep;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await Promise.race([
        requester({ system, user, model, temperature, maxTokens }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);

      const raw = response?.choices?.[0]?.message?.content || '{}';
      const output = JSON.parse(raw);
      const validation = validatePayload(output);

      if (!validation.ok) throw new Error(validation.error);

      return {
        output: validation.normalized,
        latencyMs: Date.now() - startedAt,
        promptTokens: response?.usage?.prompt_tokens || 0,
        completionTokens: response?.usage?.completion_tokens || 0,
        model,
        costUsd: calculateCost(response?.usage, model),
        error: null,
      };
    } catch (error) {
      if (attempt >= maxRetries) {
        return {
          output: null,
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          model,
          costUsd: null,
          error: error.message,
        };
      }

      await sleep(1000 * attempt);
    }
  }

  return {
    output: null,
    latencyMs: Date.now() - startedAt,
    promptTokens: 0,
    completionTokens: 0,
    model,
    costUsd: null,
    error: 'Unknown AI client failure',
  };
}

module.exports = { callAI };
