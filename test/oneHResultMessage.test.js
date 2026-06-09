'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatOneHResultMessage } = require('../src/integrations/telegram/formatters/resultMessage');

test('HIT when first half stayed 0:0', () => {
  const msg = formatOneHResultMessage({ htScoreHome: 0, htScoreAway: 0, hit: true, firstGoalMinute: null });
  assert.match(msg, /HIT/);
  assert.match(msg, /1HUNDER/);
  assert.match(msg, /0:0/);
  assert.doesNotMatch(msg, /MISS/);
});

test('MISS when a goal fell before halftime, shows the minute', () => {
  const msg = formatOneHResultMessage({ htScoreHome: 1, htScoreAway: 0, hit: false, firstGoalMinute: 38 });
  assert.match(msg, /MISS/);
  assert.match(msg, /1:0/);
  assert.match(msg, /38/);
});

test('returns a non-empty string', () => {
  const msg = formatOneHResultMessage({ htScoreHome: 0, htScoreAway: 0, hit: true, firstGoalMinute: null });
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
});
