'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runOneH_AiDecision } = require('../src/prediction/runOneH_AiDecision');

const CFG = {
  LIVE_1H_DECISION_MIN: 25,
  LIVE_1H_AI_ENABLED: true,
  LIVE_1H_TG_ENABLED: true,
  LIVE_1H_UNDER_BASELINE_P: 0.42,
  LIVE_1H_OVER_BASELINE_P: 0.40,
  LIVE_1H_CONFIRM_BEFORE_SIGNAL: false,
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
    setTm05_1hDecision(_id, payload) {
      this.record.predictions = this.record.predictions || {};
      this.record.predictions.tm05_1h = { ...(this.record.predictions.tm05_1h || {}), ...payload };
    },
    setTb05_1hDecision(_id, payload) {
      this.record.predictions = this.record.predictions || {};
      this.record.predictions.tb05_1h = { ...(this.record.predictions.tb05_1h || {}), ...payload };
    },
  };
}

function mockAI(overrides = {}) {
  return async () => ({
    output: { track: 'ONEH', p: 0.70, confidence: 0.65, reasoning: 'test', key_signals: [], data_availability: 'partial' },
    latencyMs: 100,
    costUsd: 0.001,
    error: null,
    ...overrides,
  });
}

function baseRecord(extra = {}) {
  return {
    matchId: 'm1',
    homeTeam: 'Home',
    awayTeam: 'Away',
    league: 'TestLeague',
    country: 'TestCountry',
    odds: { isOddsFavorite: { favorite: null }, home: 2.0, draw: 3.0, away: 2.0 },
    tracking: { status: 'active', firstGoalMinute: null },
    predictions: { tm05_1h: null, tb05_1h: null },
    ...extra,
  };
}

const SNAP = {
  observedMinute: 25,
  cumulative: {
    expectedGoalsXg: { home: 0.05, away: 0.10 },
    shotsOnTarget: { home: 0, away: 1 },
  },
  ballPossession: { home: 50, away: 50 },
};

// 1. Direction routing — no favorite → under → tm05_1h key
test('no favorite → direction=under → prediction saved to tm05_1h, tb05_1h untouched', async () => {
  const record = baseRecord(); // favorite: null
  const store = fakeStore(record);
  const res = await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI(),
  });

  // Result must be signal or gate_blocked (both indicate correct routing)
  assert.ok(['signal', 'gate_blocked'].includes(res.status), `unexpected status: ${res.status}`);
  assert.equal(res.direction, 'under');
  assert.ok(store.record.predictions.tm05_1h != null, 'tm05_1h must be set');
  // tb05_1h should remain null (never touched)
  assert.equal(store.record.predictions.tb05_1h, null);
});

// 2. Direction routing — favorite → over → tb05_1h key
test('favorite=home → direction=over → prediction saved to tb05_1h, tm05_1h untouched', async () => {
  const record = baseRecord({
    odds: { isOddsFavorite: { favorite: 'home' }, home: 1.5, draw: 4.0, away: 6.0 },
    predictions: { tm05_1h: null, tb05_1h: null },
  });
  const store = fakeStore(record);
  const res = await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI(),
  });

  assert.equal(res.direction, 'over');
  assert.ok(store.record.predictions.tb05_1h != null, 'tb05_1h must be set');
  assert.equal(store.record.predictions.tm05_1h, null);
});

// 3. ai_pending prevents double-fire
test('ai_pending phase → returns ai_pending immediately, callAI NOT called', async () => {
  const record = baseRecord({
    predictions: { tm05_1h: { phase: 'ai_pending' }, tb05_1h: null },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };
  const res = await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI,
  });

  assert.equal(res.status, 'ai_pending');
  assert.equal(aiCalled, false);
});

// 4. locked phase → already_decided
test('locked phase (signal) → already_decided', async () => {
  const record = baseRecord({
    odds: { isOddsFavorite: { favorite: 'home' } },
    predictions: { tm05_1h: null, tb05_1h: { phase: 'signal' } },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };
  const res = await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI,
  });

  assert.equal(res.status, 'already_decided');
  assert.equal(aiCalled, false);
});

// 5. AI error → recorded, status='ai_error'
test('AI returns error → status ai_error, phase=ai_error recorded', async () => {
  const store = fakeStore(baseRecord());
  const res = await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({ output: null, error: 'timeout' }),
  });

  assert.equal(res.status, 'ai_error');
  assert.equal(store.record.predictions.tm05_1h.phase, 'ai_error');
});

// 6. EV gate blocks signal (low p → negative EV)
test('low p (0.30) → gate_blocked', async () => {
  const store = fakeStore(baseRecord());
  // p=0.30, odds at 25'=2.60, baseline=0.42, confidence=0.65
  // pAdj = 0.42 + (0.30-0.42)*0.65 = 0.42 - 0.078 = 0.342, ev = 0.342*2.60 = 0.889 < 1.10 → blocked
  const res = await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({ output: { track: 'ONEH', p: 0.30, confidence: 0.65, reasoning: 'test', key_signals: [], data_availability: 'partial' } }),
  });

  assert.equal(res.status, 'gate_blocked');
});

// 7. goal before halftime → goal_during_decision
test('firstGoalMinute <= 45 → goal_during_decision despite high p', async () => {
  const record = baseRecord({
    tracking: { status: 'active', firstGoalMinute: 30 },
  });
  const store = fakeStore(record);
  const res = await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({ output: { track: 'ONEH', p: 0.90, confidence: 0.90, reasoning: 'test', key_signals: [], data_availability: 'rich' } }),
  });

  assert.equal(res.status, 'goal_during_decision');
});

// 8. signal enqueues TG with correct decisionKey
test('under direction signal → TG enqueued with decisionKey=tm05_1h', async () => {
  const store = fakeStore(baseRecord()); // no favorite → under
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI(),
    tgDispatcher: tg,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].decisionKey, 'tm05_1h');
});

test('over direction signal → TG enqueued with decisionKey=tb05_1h', async () => {
  const record = baseRecord({
    odds: { isOddsFavorite: { favorite: 'away' }, home: 3.0, draw: 3.5, away: 1.6 },
    predictions: { tm05_1h: null, tb05_1h: null },
  });
  const store = fakeStore(record);
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({ output: { track: 'ONEH', p: 0.85, confidence: 0.80, reasoning: 'test', key_signals: [], data_availability: 'rich' } }),
    tgDispatcher: tg,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].decisionKey, 'tb05_1h');
});

// 9. confirm read shows goal → signal aborted
test('confirmLiveScore returns goal → status=goal_during_decision, no TG enqueue', async () => {
  const cfg = { ...CFG, LIVE_1H_CONFIRM_BEFORE_SIGNAL: true };
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  const confirmLiveScore = async () => ({ scoreHome: 1, scoreAway: 0, minute: 28 });
  const res = await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: cfg,
    matchStore: store,
    callAI: mockAI(),
    tgDispatcher: tg,
    confirmLiveScore,
  });

  assert.equal(res.status, 'goal_during_decision');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 0);
  const pred = store.record.predictions.tm05_1h;
  assert.equal(pred.confirm.ok, false);
  assert.equal(pred.confirm.score, '1:0');
});

// 10. dataAvailability recorded in payload
test('data_availability="partial" from AI → recorded in payload as dataAvailability', async () => {
  const store = fakeStore(baseRecord());
  await runOneH_AiDecision('m1', SNAP, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({ output: { track: 'ONEH', p: 0.70, confidence: 0.65, reasoning: 'test', key_signals: [], data_availability: 'partial' } }),
  });

  const pred = store.record.predictions.tm05_1h;
  assert.equal(pred.dataAvailability, 'partial');
});
