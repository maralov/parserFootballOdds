'use strict';

const OpenAI = require('openai');
const { calculateCost } = require('./costCalculator');
const { validateTm05Response } = require('./schemas/tm05Schema');
const { validateTb05Response } = require('./schemas/tb05Schema');

let cachedClient = null;

function getClient(apiKey) {
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function pickValidator(checkpoint) {
  if (checkpoint === 'tm05') return validateTm05Response;
  if (checkpoint === 'tb05') return validateTb05Response;
  throw new Error(`callAI: unsupported checkpoint "${checkpoint}"`);
}

// Extract JSON from text that may include markdown code blocks or prose.
function extractJsonFromText(text) {
  if (!text) return '{}';
  // Try ```json ... ``` block first
  const jsonBlock = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock) return jsonBlock[1].trim();
  // Try ``` ... ``` block
  const codeBlock = text.match(/```\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  // Try to find raw JSON object in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return '{}';
}

// Extract text content from Responses API output array.
function extractResponsesText(output) {
  if (!Array.isArray(output)) return '';
  return output
    .filter((o) => o.type === 'message')
    .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text || '')
    .join('');
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

function defaultWebSearchRequesterFactory(apiKey) {
  return async function webSearchRequester(params) {
    const client = getClient(apiKey);
    if (!client) throw new Error('OPENAI_API_KEY is missing');

    return client.responses.create({
      model: params.model,
      tools: [{ type: 'web_search_preview' }],
      input: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      temperature: params.temperature,
      max_output_tokens: params.maxTokens,
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
    validator,
    useWebSearch = false,
  } = options;

  const validatePayload = output => (validator || pickValidator(checkpoint))(output);

  const isWebSearch = useWebSearch && !deps.requester;
  const requester = deps.requester
    || (isWebSearch
      ? defaultWebSearchRequesterFactory(apiKey)
      : defaultRequesterFactory(apiKey));
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

      // Responses API and Chat Completions API have different output shapes.
      let rawText;
      if (isWebSearch && response?.output) {
        rawText = extractResponsesText(response.output);
      } else {
        rawText = response?.choices?.[0]?.message?.content || '{}';
      }

      const jsonStr = isWebSearch ? extractJsonFromText(rawText) : rawText;
      const output = JSON.parse(jsonStr);
      const validation = validatePayload(output);

      if (!validation.ok) throw new Error(validation.error);

      const usage = response?.usage || {};
      return {
        output: validation.normalized,
        latencyMs: Date.now() - startedAt,
        promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
        model,
        costUsd: calculateCost(usage, model),
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
