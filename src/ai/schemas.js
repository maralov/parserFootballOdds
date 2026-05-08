'use strict';

const { MATCH_STATES, DOMINANT_SIDES } = require('./constants');

const REQUIRED_FIELDS = [
  'p_match_ends_0_0',
  'p_match_has_goal',
  'match_state',
  'dominant_side',
  'key_observations',
  'confidence',
];

function isFiniteProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateAIResponse(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Payload must be an object' };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      return { ok: false, error: `Missing required field: ${field}` };
    }
  }

  if (!isFiniteProbability(parsed.p_match_ends_0_0)) {
    return { ok: false, error: 'p_match_ends_0_0 must be within [0, 1]' };
  }

  if (!isFiniteProbability(parsed.p_match_has_goal)) {
    return { ok: false, error: 'p_match_has_goal must be within [0, 1]' };
  }

  if (!MATCH_STATES.includes(parsed.match_state)) {
    return { ok: false, error: 'match_state must be one of the allowed enum values' };
  }

  if (!DOMINANT_SIDES.includes(parsed.dominant_side)) {
    return { ok: false, error: 'dominant_side must be one of the allowed enum values' };
  }

  if (!Array.isArray(parsed.key_observations)) {
    return { ok: false, error: 'key_observations must be an array' };
  }

  if (!isFiniteProbability(parsed.confidence)) {
    return { ok: false, error: 'confidence must be within [0, 1]' };
  }

  const sum = parsed.p_match_ends_0_0 + parsed.p_match_has_goal;
  if (Math.abs(sum - 1) > 0.05) {
    return { ok: false, error: 'Probabilities must sum to 1.0 within tolerance' };
  }

  return { ok: true, error: null };
}

module.exports = {
  REQUIRED_FIELDS,
  validateAIResponse,
};
