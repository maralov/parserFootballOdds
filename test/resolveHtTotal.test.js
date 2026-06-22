'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveHtTotal } = require('../src/prediction/resolveHtTotal');

// ─── Test Helper: fakeStore ────────────────────────────────────────────────

function fakeStore(record) {
  return {
    record,
    getMatch() { return this.record; },
    setHtTotalDecision(_id, payload) {
      this.record.predictions = this.record.predictions || {};
      this.record.predictions.htTotal = { ...(this.record.predictions.htTotal || {}), ...payload };
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

test('resolveHtTotal: 2:1 final → total=3, over15Hit=true, over25Hit=true', (t) => {
  const match = {
    matchId: 'match-001',
    predictions: {
      htTotal: { phase: 'predicted' },
    },
    final: { scoreHome: 2, scoreAway: 1, totalGoals: 3 },
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-001', new Date(), { matchStore: store });

  assert.ok(outcome, 'outcome should be returned');
  assert.equal(outcome.total, 3);
  assert.equal(outcome.over15Hit, true);
  assert.equal(outcome.over25Hit, true);
  assert.ok(outcome.resolvedAt);

  // Verify store was updated
  assert.equal(store.record.predictions.htTotal.phase, 'resolved');
  assert.deepEqual(store.record.predictions.htTotal.outcome, outcome);
});

test('resolveHtTotal: 1:0 final → total=1, over15Hit=false, over25Hit=false', (t) => {
  const match = {
    matchId: 'match-002',
    predictions: {
      htTotal: { phase: 'predicted' },
    },
    final: { scoreHome: 1, scoreAway: 0, totalGoals: 1 },
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-002', new Date(), { matchStore: store });

  assert.ok(outcome, 'outcome should be returned');
  assert.equal(outcome.total, 1);
  assert.equal(outcome.over15Hit, false);
  assert.equal(outcome.over25Hit, false);
});

test('resolveHtTotal: 1:1 final → total=2, over15Hit=true, over25Hit=false', (t) => {
  const match = {
    matchId: 'match-003',
    predictions: {
      htTotal: { phase: 'predicted' },
    },
    final: { scoreHome: 1, scoreAway: 1, totalGoals: 2 },
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-003', new Date(), { matchStore: store });

  assert.ok(outcome, 'outcome should be returned');
  assert.equal(outcome.total, 2);
  assert.equal(outcome.over15Hit, true);
  assert.equal(outcome.over25Hit, false);
});

test('resolveHtTotal: 0:0 final → total=0, over15Hit=false, over25Hit=false', (t) => {
  const match = {
    matchId: 'match-004',
    predictions: {
      htTotal: { phase: 'predicted' },
    },
    final: { scoreHome: 0, scoreAway: 0, totalGoals: 0 },
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-004', new Date(), { matchStore: store });

  assert.ok(outcome, 'outcome should be returned');
  assert.equal(outcome.total, 0);
  assert.equal(outcome.over15Hit, false);
  assert.equal(outcome.over25Hit, false);
});

test('resolveHtTotal: 3:2 final → total=5, over15Hit=true, over25Hit=true', (t) => {
  const match = {
    matchId: 'match-005',
    predictions: {
      htTotal: { phase: 'predicted' },
    },
    final: { scoreHome: 3, scoreAway: 2, totalGoals: 5 },
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-005', new Date(), { matchStore: store });

  assert.ok(outcome, 'outcome should be returned');
  assert.equal(outcome.total, 5);
  assert.equal(outcome.over15Hit, true);
  assert.equal(outcome.over25Hit, true);
});

test('resolveHtTotal: phase sets to "resolved" + outcome stored', (t) => {
  const match = {
    matchId: 'match-006',
    predictions: {
      htTotal: { phase: 'predicted', someOtherField: 'preserved' },
    },
    final: { scoreHome: 2, scoreAway: 0, totalGoals: 2 },
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-006', new Date(), { matchStore: store });

  assert.ok(outcome);
  assert.equal(store.record.predictions.htTotal.phase, 'resolved');
  assert.ok(store.record.predictions.htTotal.outcome);
  assert.equal(store.record.predictions.htTotal.outcome.total, 2);
  // Verify other fields are preserved (merge behavior)
  assert.equal(store.record.predictions.htTotal.someOtherField, 'preserved');
});

test('resolveHtTotal: no htTotal prediction → returns null, no store call', (t) => {
  const match = {
    matchId: 'match-007',
    predictions: {},
    final: { scoreHome: 1, scoreAway: 1, totalGoals: 2 },
  };
  const store = fakeStore(match);
  const initialHtTotal = store.record.predictions.htTotal;

  const outcome = resolveHtTotal('match-007', new Date(), { matchStore: store });

  assert.equal(outcome, null);
  assert.equal(store.record.predictions.htTotal, initialHtTotal);
});

test('resolveHtTotal: htTotal.phase="resolved" (already) → returns null (idempotent)', (t) => {
  const match = {
    matchId: 'match-008',
    predictions: {
      htTotal: {
        phase: 'resolved',
        outcome: { total: 2, over15Hit: true, over25Hit: false },
      },
    },
    final: { scoreHome: 1, scoreAway: 1, totalGoals: 2 },
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-008', new Date(), { matchStore: store });

  assert.equal(outcome, null);
});

test('resolveHtTotal: htTotal.phase="ht_error" → returns null (not in predicted state)', (t) => {
  const match = {
    matchId: 'match-009',
    predictions: {
      htTotal: { phase: 'ht_error' },
    },
    final: { scoreHome: 1, scoreAway: 0, totalGoals: 1 },
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-009', new Date(), { matchStore: store });

  assert.equal(outcome, null);
});

test('resolveHtTotal: no final → returns null', (t) => {
  const match = {
    matchId: 'match-010',
    predictions: {
      htTotal: { phase: 'predicted' },
    },
    final: null,
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-010', new Date(), { matchStore: store });

  assert.equal(outcome, null);
});

test('resolveHtTotal: no match → returns null', (t) => {
  const store = {
    record: null,
    getMatch() { return this.record; },
    setHtTotalDecision() { /* should not be called */ },
  };

  const outcome = resolveHtTotal('match-missing', new Date(), { matchStore: store });

  assert.equal(outcome, null);
});

test('resolveHtTotal: final.totalGoals fallback to scoreHome + scoreAway', (t) => {
  const match = {
    matchId: 'match-011',
    predictions: {
      htTotal: { phase: 'predicted' },
    },
    final: { scoreHome: 1, scoreAway: 2 },
    // No totalGoals field; should compute as 1 + 2 = 3
  };
  const store = fakeStore(match);

  const outcome = resolveHtTotal('match-011', new Date(), { matchStore: store });

  assert.ok(outcome);
  assert.equal(outcome.total, 3);
  assert.equal(outcome.over15Hit, true);
  assert.equal(outcome.over25Hit, true);
});
