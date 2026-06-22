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
  LIVE_1H_DETAILED_ONLY: true,
  LIVE_1H_XG_UNDER_MAX: 0.15,
  LIVE_1H_XG_OVER_MAX: 0.50,
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
    output: {
      track: 'ONEH',
      p: 0.70,
      confidence: 0.65,
      reasoning: 'test',
      key_signals: [],
      data_availability: 'partial',
    },
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
    statsLevel: 'detailed',
    odds: { isOddsFavorite: { favorite: null }, home: 2.0, draw: 4.2, away: 2.0 },
    tracking: { status: 'active', firstGoalMinute: null },
    predictions: { tm05_1h: null, tb05_1h: null },
    ...extra,
  };
}

// SNAP_UNDER: liveXg = 0.05 + 0.08 = 0.13 <= 0.15 → 'under'
const SNAP_UNDER = {
  observedMinute: 25,
  cumulative: {
    expectedGoalsXg: { home: 0.05, away: 0.08 },
    shotsOnTarget: { home: 0, away: 1 },
  },
  ballPossession: { home: 50, away: 50 },
};

// SNAP_OVER: liveXg = 0.15 + 0.18 = 0.33, 0.15 < 0.33 <= 0.50 → 'over'
const SNAP_OVER = {
  observedMinute: 25,
  cumulative: {
    expectedGoalsXg: { home: 0.15, away: 0.18 },
    shotsOnTarget: { home: 1, away: 2 },
  },
  ballPossession: { home: 48, away: 52 },
};

// 1. Detailed gate — basic league skipped
test('detailed gate: statsLevel=basic → skipped_by_basic in both keys, AI not called', async () => {
  const record = baseRecord({ statsLevel: 'basic' });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI,
  });

  assert.equal(res.status, 'skipped_by_basic');
  assert.equal(store.record.predictions.tm05_1h.phase, 'skipped_by_basic');
  assert.equal(store.record.predictions.tb05_1h.phase, 'skipped_by_basic');
  assert.equal(aiCalled, false);
});

// 2. Detailed gate disabled by config (LIVE_1H_DETAILED_ONLY: false)
test('detailed gate disabled (LIVE_1H_DETAILED_ONLY: false) + xG null → skipped_by_xg', async () => {
  const record = baseRecord({ statsLevel: undefined });
  const store = fakeStore(record);
  const snapNoXg = { observedMinute: 25, cumulative: {}, ballPossession: { home: 50, away: 50 } };

  const res = await runOneH_AiDecision('m1', snapNoXg, new Date(), {
    env: { ...CFG, LIVE_1H_DETAILED_ONLY: false },
    matchStore: store,
  });

  assert.equal(res.status, 'skipped_by_xg');
});

// 3. xG routing — liveXg=null → skipped_by_xg
test('xG routing: cumulative has no xG → liveXg=null → skipped_by_xg in both keys, AI not called', async () => {
  const record = baseRecord();
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };
  const snapNoXg = { observedMinute: 25, cumulative: {}, ballPossession: { home: 50, away: 50 } };

  const res = await runOneH_AiDecision('m1', snapNoXg, new Date(), {
    env: CFG,
    matchStore: store,
    callAI,
  });

  assert.equal(res.status, 'skipped_by_xg');
  assert.equal(store.record.predictions.tm05_1h.phase, 'skipped_by_xg');
  assert.equal(store.record.predictions.tb05_1h.phase, 'skipped_by_xg');
  assert.equal(aiCalled, false);
});

// 4. xG routing — liveXg=0.70 → skipped_by_xg
test('xG routing: liveXg=0.70 (>0.50) → skipped_by_xg', async () => {
  const record = baseRecord();
  const store = fakeStore(record);
  const snapHighXg = {
    observedMinute: 25,
    cumulative: { expectedGoalsXg: { home: 0.30, away: 0.40 } },
    ballPossession: { home: 50, away: 50 },
  };

  const res = await runOneH_AiDecision('m1', snapHighXg, new Date(), {
    env: CFG,
    matchStore: store,
  });

  assert.equal(res.status, 'skipped_by_xg');
});

// 5. xG routing — liveXg=0.13 → direction=under → prediction saved to tm05_1h
test('xG routing: liveXg=0.13 → direction=under → tm05_1h set, tb05_1h untouched, status=signal', async () => {
  const record = baseRecord();
  const store = fakeStore(record);

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI(),
  });

  assert.equal(res.direction, 'under');
  assert.equal(res.status, 'signal');
  assert.ok(store.record.predictions.tm05_1h != null, 'tm05_1h must be set');
  assert.equal(store.record.predictions.tb05_1h, null);
});

// 6. xG routing — liveXg=0.33 → direction=over → prediction saved to tb05_1h
test('xG routing: liveXg=0.33 → direction=over → tb05_1h set, tm05_1h untouched', async () => {
  const record = baseRecord();
  const store = fakeStore(record);

  const res = await runOneH_AiDecision('m1', SNAP_OVER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI(),
  });

  assert.equal(res.direction, 'over');
  assert.ok(store.record.predictions.tb05_1h != null, 'tb05_1h must be set');
  assert.equal(store.record.predictions.tm05_1h, null);
});

// 7. ai_pending prevents double-fire
test('ai_pending phase on tm05_1h (SNAP_UNDER direction) → returns ai_pending immediately, AI not called', async () => {
  const record = baseRecord({
    predictions: { tm05_1h: { phase: 'ai_pending' }, tb05_1h: null },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI,
  });

  assert.equal(res.status, 'ai_pending');
  assert.equal(aiCalled, false);
});

// 8. locked phase (signal) → already_decided
test('locked phase (signal) on tm05_1h (SNAP_UNDER direction) → already_decided, AI not called', async () => {
  const record = baseRecord({
    predictions: { tm05_1h: { phase: 'signal' }, tb05_1h: null },
  });
  const store = fakeStore(record);
  let aiCalled = false;
  const callAI = async () => { aiCalled = true; return mockAI()(); };

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI,
  });

  assert.equal(res.status, 'already_decided');
  assert.equal(aiCalled, false);
});

// 9. AI error → status ai_error, phase=ai_error recorded
test('AI returns error → status=ai_error, tm05_1h.phase=ai_error', async () => {
  const store = fakeStore(baseRecord());

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({ output: null, error: 'timeout' }),
  });

  assert.equal(res.status, 'ai_error');
  assert.equal(store.record.predictions.tm05_1h.phase, 'ai_error');
});

// 10. Low p — EV gate does NOT block (new behavior: always 'signal')
test('EV gate is record-only: low p=0.30 still results in status=signal', async () => {
  const store = fakeStore(baseRecord());

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: { ...CFG, LIVE_1H_MIN_P: 0 },
    matchStore: store,
    callAI: mockAI({
      output: {
        track: 'ONEH',
        p: 0.30,
        confidence: 0.65,
        reasoning: 'test',
        key_signals: [],
        data_availability: 'partial',
      },
    }),
  });

  assert.equal(res.status, 'signal');
});

// 11. goal before halftime → goal_during_decision
test('firstGoalMinute=30 → goal_during_decision despite high p', async () => {
  const record = baseRecord({
    tracking: { status: 'active', firstGoalMinute: 30 },
  });
  const store = fakeStore(record);

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({
      output: {
        track: 'ONEH',
        p: 0.90,
        confidence: 0.90,
        reasoning: 'test',
        key_signals: [],
        data_availability: 'rich',
      },
    }),
  });

  assert.equal(res.status, 'goal_during_decision');
});

// 12. signal enqueues TG with decisionKey=tm05_1h (under direction)
test('under direction signal → TG enqueueEntry called with decisionKey=tm05_1h', async () => {
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };

  await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI(),
    tgDispatcher: tg,
  });
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].decisionKey, 'tm05_1h');
});

// 13. signal enqueues TG with decisionKey=tb05_1h (over direction)
test('over direction signal → TG enqueueEntry called with decisionKey=tb05_1h', async () => {
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };

  await runOneH_AiDecision('m1', SNAP_OVER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({
      output: {
        track: 'ONEH',
        p: 0.85,
        confidence: 0.80,
        reasoning: 'test',
        key_signals: [],
        data_availability: 'rich',
      },
    }),
    tgDispatcher: tg,
  });
  await new Promise((r) => setImmediate(r));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].decisionKey, 'tb05_1h');
});

// 14. confirm read shows goal → signal aborted, no TG
test('confirmLiveScore returns goal → status=goal_during_decision, TG not called', async () => {
  const cfg = { ...CFG, LIVE_1H_CONFIRM_BEFORE_SIGNAL: true };
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  const confirmLiveScore = async () => ({ scoreHome: 1, scoreAway: 0, minute: 28 });

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: cfg,
    matchStore: store,
    callAI: mockAI(),
    tgDispatcher: tg,
    confirmLiveScore,
  });

  assert.equal(res.status, 'goal_during_decision');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 0);
});

// 15. confirm still 0:0 → signal sent
test('confirmLiveScore returns 0:0 → status=signal, TG called once', async () => {
  const cfg = { ...CFG, LIVE_1H_CONFIRM_BEFORE_SIGNAL: true };
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  const confirmLiveScore = async () => ({ scoreHome: 0, scoreAway: 0, minute: 27 });

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: cfg,
    matchStore: store,
    callAI: mockAI(),
    tgDispatcher: tg,
    confirmLiveScore,
  });

  assert.equal(res.status, 'signal');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
});

// 16. confirm fetch fails → signal still sent
test('confirmLiveScore throws → signal still sent (confirm failure is non-blocking)', async () => {
  const cfg = { ...CFG, LIVE_1H_CONFIRM_BEFORE_SIGNAL: true };
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  const confirmLiveScore = async () => { throw new Error('network'); };

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: cfg,
    matchStore: store,
    callAI: mockAI(),
    tgDispatcher: tg,
    confirmLiveScore,
  });

  assert.equal(res.status, 'signal');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
});

// 17. data_availability recorded in payload
test('AI returns data_availability="partial" → recorded as dataAvailability in tm05_1h', async () => {
  const store = fakeStore(baseRecord());

  await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: CFG,
    matchStore: store,
    callAI: mockAI({
      output: {
        track: 'ONEH',
        p: 0.70,
        confidence: 0.65,
        reasoning: 'test',
        key_signals: [],
        data_availability: 'partial',
      },
    }),
  });

  assert.equal(store.record.predictions.tm05_1h.dataAvailability, 'partial');
});

// 18. P1 consensus flip: under + high goal-leaning signals → flips to over, stored under tb05_1h
test('P1 consensus flip: under + high goal-leaning signals → flips to over, stored under tb05_1h', async () => {
  const store = fakeStore(baseRecord()); // SNAP_UNDER → direction=under

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: { ...CFG, LIVE_1H_CONSENSUS_GATE: true, LIVE_1H_MIN_P: 0.50 },
    matchStore: store,
    callAI: mockAI({
      output: {
        track: 'ONEH',
        p: 0.46,
        confidence: 0.6,
        reasoning: 'x',
        data_availability: 'partial',
        key_signals: [{ signal: 'both_defensive_issues', value: 'пропустили 5/6', weight: 'high' }],
      },
    }),
  });

  assert.equal(res.direction, 'over');
  assert.equal(store.record.predictions.tm05_1h.phase, 'flipped_away');
  assert.ok(store.record.predictions.tb05_1h, 'tb05_1h must be set after flip');
});

// 19. P2 min_p: under p<0.50 with no contradiction → skipped_by_min_p
test('P2 min_p: under p=0.45 with no contradiction → skipped_by_min_p', async () => {
  const store = fakeStore(baseRecord());

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: { ...CFG, LIVE_1H_CONSENSUS_GATE: true, LIVE_1H_MIN_P: 0.50 },
    matchStore: store,
    callAI: mockAI({
      output: {
        track: 'ONEH',
        p: 0.45,
        confidence: 0.6,
        reasoning: 'x',
        data_availability: 'partial',
        key_signals: [{ signal: 'low_first_half_goals', value: '0.7', weight: 'high' }],
      },
    }),
  });

  assert.equal(res.status, 'skipped_by_min_p');
});

// 20. P1 consensus skip: under + only med goal-leaning → skipped_by_consensus
test('P1 consensus skip: under + only med goal-leaning signal → skipped_by_consensus', async () => {
  const store = fakeStore(baseRecord());

  const res = await runOneH_AiDecision('m1', SNAP_UNDER, new Date(), {
    env: { ...CFG, LIVE_1H_CONSENSUS_GATE: true, LIVE_1H_MIN_P: 0.50 },
    matchStore: store,
    callAI: mockAI({
      output: {
        track: 'ONEH',
        p: 0.62,
        confidence: 0.6,
        reasoning: 'x',
        data_availability: 'partial',
        key_signals: [{ signal: 'recent_first_half_goals', value: 'frequent', weight: 'med' }],
      },
    }),
  });

  assert.equal(res.status, 'skipped_by_consensus');
});
