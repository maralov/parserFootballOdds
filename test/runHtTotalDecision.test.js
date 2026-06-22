'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runHtTotalDecision } = require('../src/prediction/runHtTotalDecision');

const CFG = {
  LIVE_AI_MODEL: 'gpt-4o',
  LIVE_AI_TEMPERATURE: 0.2,
  LIVE_AI_MAX_TOKENS: 2500,
  LIVE_AI_MAX_RETRIES: 1,
  LIVE_AI_WEB_SEARCH_TIMEOUT_MS: 90_000,
  OPENAI_API_KEY: 'test',
};

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

function mockAI(overrides = {}) {
  return async () => ({
    output: {
      track: 'HT_TOTAL',
      expected_goals: 1.8,
      p_over_1_5: 0.60,
      p_over_2_5: 0.30,
      confidence: 0.40,
      reasoning: 'test',
      key_signals: [],
      found_factors: false,
    },
    latencyMs: 100, costUsd: 0.001, error: null,
    ...overrides,
  });
}

function baseRecord(extra = {}) {
  return {
    matchId: 'm1',
    homeTeam: 'Home', awayTeam: 'Away',
    league: 'TestLeague', country: 'TestCountry',
    statsLevel: 'detailed',
    odds: { isOddsFavorite: { favorite: null }, home: 2.0, draw: 4.2, away: 2.0 },
    predictions: { tm05_1h: { phase: 'signal' }, tb05_1h: null, htTotal: null },
    ...extra,
  };
}

const SNAP = {
  observedMinute: 45,
  cumulative: { expectedGoalsXg: { home: 0.08, away: 0.12 }, shotsOnTarget: { home: 1, away: 2 } },
  ballPossession: { home: 50, away: 50 },
};
const HT_SCORE = { home: 0, away: 0 };

// 1. scope gate: no 1H prediction → out_of_scope
test('scope gate: no 1H prediction → out_of_scope', async () => {
  const record = baseRecord({
    predictions: { tm05_1h: null, tb05_1h: null, htTotal: null },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI,
  });

  assert.equal(res.status, 'out_of_scope');
  assert.equal(aiCalled, false);
});

// 2. scope gate: only skipped_by_basic → out_of_scope
test('scope gate: only skipped_by_basic → out_of_scope', async () => {
  const record = baseRecord({
    predictions: {
      tm05_1h: { phase: 'skipped_by_basic' },
      tb05_1h: { phase: 'skipped_by_basic' },
      htTotal: null,
    },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI,
  });

  assert.equal(res.status, 'out_of_scope');
  assert.equal(aiCalled, false);
});

// 3. scope gate: only skipped_by_xg → out_of_scope
test('scope gate: only skipped_by_xg → out_of_scope', async () => {
  const record = baseRecord({
    predictions: {
      tm05_1h: { phase: 'skipped_by_xg' },
      tb05_1h: { phase: 'skipped_by_xg' },
      htTotal: null,
    },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI,
  });

  assert.equal(res.status, 'out_of_scope');
  assert.equal(aiCalled, false);
});

// 4. scope gate: signal phase passes → predicted
test('scope gate: signal phase passes → predicted', async () => {
  const store = fakeStore(baseRecord()); // tm05_1h: { phase: 'signal' }

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI: mockAI(),
  });

  assert.equal(res.status, 'predicted');
});

// 5. scope gate: skipped_by_min_p passes → predicted
test('scope gate: skipped_by_min_p passes → predicted', async () => {
  const record = baseRecord({
    predictions: {
      tm05_1h: { phase: 'skipped_by_min_p' },
      tb05_1h: null,
      htTotal: null,
    },
  });
  const store = fakeStore(record);

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI: mockAI(),
  });

  assert.equal(res.status, 'predicted');
});

// 6. idempotency: ht_pending → returns ht_pending immediately, AI not called
test('idempotency: ht_pending → returns ht_pending immediately, AI not called', async () => {
  const record = baseRecord({
    predictions: {
      tm05_1h: { phase: 'signal' },
      tb05_1h: null,
      htTotal: { phase: 'ht_pending' },
    },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI,
  });

  assert.equal(res.status, 'ht_pending');
  assert.equal(aiCalled, false);
});

// 7. idempotency: predicted → returns predicted immediately, AI not called
test('idempotency: predicted → returns predicted immediately, AI not called', async () => {
  const record = baseRecord({
    predictions: {
      tm05_1h: { phase: 'signal' },
      tb05_1h: null,
      htTotal: { phase: 'predicted', expGoals: 1.5 },
    },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI,
  });

  assert.equal(res.status, 'predicted');
  assert.equal(aiCalled, false);
});

// 8. AI error → ht_error stored, status=ht_error
test('AI error → ht_error stored, status=ht_error', async () => {
  const store = fakeStore(baseRecord());

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({ output: null, error: 'timeout' }),
  });

  assert.equal(res.status, 'ht_error');
  assert.equal(store.record.predictions.htTotal.phase, 'ht_error');
  assert.equal(store.record.predictions.htTotal.aiError, 'timeout');
});

// 9. success: stores predicted phase with correct fields
test('success: stores predicted phase with correct fields (expGoals, pOver15, pOver25, confidence, features1H)', async () => {
  const store = fakeStore(baseRecord());

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI: mockAI(),
  });

  assert.equal(res.status, 'predicted');
  assert.equal(res.expGoals, 1.8);
  assert.equal(res.pOver15, 0.60);
  assert.equal(res.pOver25, 0.30);

  const stored = store.record.predictions.htTotal;
  assert.equal(stored.phase, 'predicted');
  assert.equal(stored.expGoals, 1.8);
  assert.equal(stored.pOver15, 0.60);
  assert.equal(stored.pOver25, 0.30);
  assert.equal(stored.confidence, 0.40);
  assert.ok(stored.features1H != null, 'features1H must be present');
  assert.ok(stored.decidedAt != null, 'decidedAt must be present');
});

// 10. features1H contains htScore and xG from snapshot
test('features1H contains htScore and xG from snapshot', async () => {
  const store = fakeStore(baseRecord());

  await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI: mockAI(),
  });

  const f = store.record.predictions.htTotal.features1H;
  assert.deepEqual(f.htScore, HT_SCORE);
  assert.deepEqual(f.xG, { home: 0.08, away: 0.12 });
  assert.deepEqual(f.shotsOnTarget, { home: 1, away: 2 });
  assert.deepEqual(f.ballPossession, { home: 50, away: 50 });
});

// 11a. idempotency: ht_error → returns ht_error immediately, AI not called
test('idempotency: ht_error → returns ht_error immediately, AI not called', async () => {
  const record = baseRecord({
    predictions: {
      tm05_1h: { phase: 'signal' },
      tb05_1h: null,
      htTotal: { phase: 'ht_error', aiError: 'prior_timeout' },
    },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runHtTotalDecision('m1', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store, callAI,
  });

  assert.equal(res.status, 'ht_error');
  assert.equal(aiCalled, false);
});

// 11. no_match: returns no_match if matchId unknown
test('no_match: returns no_match if matchId unknown', async () => {
  const store = { getMatch() { return null; }, setHtTotalDecision() {} };

  const res = await runHtTotalDecision('unknown', SNAP, HT_SCORE, new Date(), {
    env: CFG, matchStore: store,
  });

  assert.equal(res.status, 'no_match');
});
