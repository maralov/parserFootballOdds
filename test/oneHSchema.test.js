'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOneHResponse } = require('../src/ai/schemas/oneHSchema');

test('valid response → ok, normalized fields present', () => {
  const raw = {
    p: 0.65,
    confidence: 0.8,
    reasoning: 'Match is dry, few chances.',
    key_signals: [{ signal: 'xG_low', value: '0.12', weight: 'high' }],
    data_availability: 'rich',
  };
  const result = validateOneHResponse(raw);
  assert.equal(result.ok, true);
  const n = result.normalized;
  assert.equal(n.track, 'ONEH');
  assert.equal(n.p, 0.65);
  assert.equal(n.confidence, 0.8);
  assert.equal(n.reasoning, 'Match is dry, few chances.');
  assert.equal(n.data_availability, 'rich');
  assert.equal(n.key_signals.length, 1);
  assert.equal(n.key_signals[0].signal, 'xG_low');
  assert.equal(n.key_signals[0].weight, 'high');
});

test('missing p → error', () => {
  const result = validateOneHResponse({ confidence: 0.7, reasoning: 'ok', data_availability: 'partial' });
  assert.equal(result.ok, false);
  assert.match(result.error, /p must be 0\.\.1/);
});

test('p out of range (> 1) → error', () => {
  const result = validateOneHResponse({ p: 1.5, confidence: 0.7, reasoning: 'ok', data_availability: 'partial' });
  assert.equal(result.ok, false);
  assert.match(result.error, /p must be 0\.\.1/);
});

test('p out of range (negative) → error', () => {
  const result = validateOneHResponse({ p: -0.1, confidence: 0.7, reasoning: 'ok', data_availability: 'partial' });
  assert.equal(result.ok, false);
  assert.match(result.error, /p must be 0\.\.1/);
});

test('missing confidence → error', () => {
  const result = validateOneHResponse({ p: 0.5, reasoning: 'ok', data_availability: 'partial' });
  assert.equal(result.ok, false);
  assert.match(result.error, /confidence must be 0\.\.1/);
});

test('unknown data_availability → defaults to "none"', () => {
  const result = validateOneHResponse({ p: 0.5, confidence: 0.6, reasoning: 'ok', data_availability: 'unknown_value' });
  assert.equal(result.ok, true);
  assert.equal(result.normalized.data_availability, 'none');
});

test('missing data_availability → defaults to "none"', () => {
  const result = validateOneHResponse({ p: 0.5, confidence: 0.6, reasoning: 'ok' });
  assert.equal(result.ok, true);
  assert.equal(result.normalized.data_availability, 'none');
});

test('empty key_signals → ok, normalizes to []', () => {
  const result = validateOneHResponse({ p: 0.5, confidence: 0.6, reasoning: 'ok', key_signals: [], data_availability: 'none' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.normalized.key_signals, []);
});

test('missing key_signals → ok, normalizes to []', () => {
  const result = validateOneHResponse({ p: 0.5, confidence: 0.6, reasoning: 'ok', data_availability: 'partial' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.normalized.key_signals, []);
});

test('"medium" weight → normalizes to "med"', () => {
  const raw = {
    p: 0.7,
    confidence: 0.75,
    reasoning: 'ok',
    key_signals: [{ signal: 'test', value: '1', weight: 'medium' }],
    data_availability: 'partial',
  };
  const result = validateOneHResponse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.normalized.key_signals[0].weight, 'med');
});

test('unknown weight → defaults to "med"', () => {
  const raw = {
    p: 0.7,
    confidence: 0.75,
    reasoning: 'ok',
    key_signals: [{ signal: 'test', value: '1', weight: 'very_high' }],
    data_availability: 'partial',
  };
  const result = validateOneHResponse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.normalized.key_signals[0].weight, 'med');
});

test('response is not an object → error', () => {
  const result = validateOneHResponse(null);
  assert.equal(result.ok, false);
  assert.match(result.error, /not an object/);
});

test('response is a string → error', () => {
  const result = validateOneHResponse('{"p":0.5}');
  assert.equal(result.ok, false);
  assert.match(result.error, /not an object/);
});

test('p = 0 and p = 1 are valid boundary values', () => {
  const r0 = validateOneHResponse({ p: 0, confidence: 0, reasoning: '', data_availability: 'none' });
  assert.equal(r0.ok, true);
  assert.equal(r0.normalized.p, 0);

  const r1 = validateOneHResponse({ p: 1, confidence: 1, reasoning: '', data_availability: 'rich' });
  assert.equal(r1.ok, true);
  assert.equal(r1.normalized.p, 1);
});

test('signal with empty signal string is filtered out', () => {
  const raw = {
    p: 0.5,
    confidence: 0.6,
    reasoning: 'ok',
    key_signals: [
      { signal: '', value: 'x', weight: 'high' },
      { signal: 'valid', value: 'y', weight: 'low' },
    ],
    data_availability: 'partial',
  };
  const result = validateOneHResponse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.normalized.key_signals.length, 1);
  assert.equal(result.normalized.key_signals[0].signal, 'valid');
});
