'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeHit, formatResultMessage } = require('../src/integrations/telegram/formatters/resultMessage');

// ─── computeHit ───────────────────────────────────────────────────────────────

test('computeHit tm05_1h: no goals → true', () => {
  const match = { final: { goals: [] } };
  assert.equal(computeHit('tm05_1h', match), true);
});

test('computeHit tm05_1h: goal at 50 (2H) → true', () => {
  const match = { final: { goals: [{ minute: 50 }] } };
  assert.equal(computeHit('tm05_1h', match), true);
});

test('computeHit tm05_1h: goal at 38 → false', () => {
  const match = { final: { goals: [{ minute: 38 }] } };
  assert.equal(computeHit('tm05_1h', match), false);
});

test('computeHit tb05_1h: goal at 37 → true', () => {
  const match = { final: { goals: [{ minute: 37 }] } };
  assert.equal(computeHit('tb05_1h', match), true);
});

test('computeHit tb05_1h: goal at 45 → true (boundary)', () => {
  const match = { final: { goals: [{ minute: 45 }] } };
  assert.equal(computeHit('tb05_1h', match), true);
});

test('computeHit tb05_1h: no goals → false', () => {
  const match = { final: { goals: [] } };
  assert.equal(computeHit('tb05_1h', match), false);
});

test('computeHit tb05_1h: goal at 50 (2H only) → false', () => {
  const match = { final: { goals: [{ minute: 50 }] } };
  assert.equal(computeHit('tb05_1h', match), false);
});

// ─── formatResultMessage ──────────────────────────────────────────────────────

function makeOutboxRecord(decisionKey) {
  return { decisionKey, entry: { messageId: 1 } };
}

function makeMatch(goals) {
  return {
    final: {
      scoreHome: goals.length,
      scoreAway: 0,
      goals: goals.map((m) => ({ minute: m })),
    },
  };
}

test('formatResultMessage tb05_1h HIT shows 1HOVER and HIT', () => {
  const record = makeOutboxRecord('tb05_1h');
  const match = makeMatch([37]);
  const msg = formatResultMessage({ outboxRecord: record, match });
  assert.ok(msg !== null, 'expected non-null message');
  assert.match(msg, /HIT/);
  assert.match(msg, /1HOVER/);
  assert.doesNotMatch(msg, /MISS/);
});

test('formatResultMessage tb05_1h HIT shows goal minute', () => {
  const record = makeOutboxRecord('tb05_1h');
  const match = makeMatch([37]);
  const msg = formatResultMessage({ outboxRecord: record, match });
  assert.match(msg, /37/);
});

test('formatResultMessage tb05_1h MISS when no goals in 1H', () => {
  const record = makeOutboxRecord('tb05_1h');
  const match = makeMatch([]);
  const msg = formatResultMessage({ outboxRecord: record, match });
  assert.ok(msg !== null);
  assert.match(msg, /MISS/);
  assert.match(msg, /1HOVER/);
});

test('formatResultMessage returns null for unknown decisionKey', () => {
  const record = makeOutboxRecord('unknown_key');
  const match = makeMatch([]);
  const msg = formatResultMessage({ outboxRecord: record, match });
  assert.equal(msg, null);
});

test('formatResultMessage tb05_1h still works when outboxRecord.result.hit overrides', () => {
  const record = { decisionKey: 'tb05_1h', entry: { messageId: 1 }, result: { hit: true } };
  const match = makeMatch([]);  // no goals — computeHit would be false, but result.hit overrides
  const msg = formatResultMessage({ outboxRecord: record, match });
  assert.ok(msg !== null);
  assert.match(msg, /HIT/);
});
