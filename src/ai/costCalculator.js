'use strict';

const { MODEL_PRICING } = require('./constants');

function round(value, digits = 6) {
  return Math.round(value * (10 ** digits)) / (10 ** digits);
}

function calculateCost(usage, model) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const inputTokens = usage?.prompt_tokens || 0;
  const outputTokens = usage?.completion_tokens || 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return round(inputCost + outputCost);
}

function calculateResponsesCost(usage, model) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return round(inputCost + outputCost);
}

module.exports = { calculateCost, calculateResponsesCost, round };
