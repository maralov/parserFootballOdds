'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runTm05_1hDecision } = require('../src/prediction/runTm05_1hDecision');

const CFG = {
  LIVE_1H_DS_THRESHOLD_MIN: 70,
  LIVE_1H_BASELINE_P: 0.42,
  LIVE_1H_CONFIDENCE: 0.6,
  LIVE_1H_DECISION_MIN: 25,
  LIVE_1H_CALIBRATED: false,
  LIVE_1H_TG_ENABLED: true,
};

function fakeStore(record) {
  return {
    record,
    getMatch() { return this.record; },
    setTm05_1hDecision(_id, payload) {
      this.record.predictions = this.record.predictions || {};
      this.record.predictions.tm05_1h = {
        ...(this.record.predictions.tm05_1h || {}),
        ...payload,
      };
      return this.record.predictions.tm05_1h;
    },
  };
}

function baseRecord(extra = {}) {
  return {
    matchId: 'm1',
    homeTeam: 'Home',
    awayTeam: 'Away',
    odds: { isOddsFavorite: { favorite: 'home' } },
    tracking: { status: 'active', firstGoalMinute: null },
    predictions: { tm05_1h: null },
    ...extra,
  };
}

const DRY_SNAP = {
  observedMinute: 25,
  cumulative: {
    expectedGoalsXg: { home: 0.05, away: 0.10 },
    shotsOnTarget: { home: 0, away: 1 },
    touchesInOppositionBox: { home: 2, away: 5 },
    bigChances: { home: 0, away: 0 },
    yellowCards: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
  },
  ballPossession: { home: 50, away: 50 },
};

const ACTIVE_SNAP = {
  observedMinute: 25,
  cumulative: {
    expectedGoalsXg: { home: 1.1, away: 0.1 },
    shotsOnTarget: { home: 5, away: 0 },
    touchesInOppositionBox: { home: 22, away: 2 },
    bigChances: { home: 3, away: 0 },
    yellowCards: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
  },
  ballPossession: { home: 65, away: 35 },
};

test('active favorite → skipped_by_ds', async () => {
  const store = fakeStore(baseRecord());
  const res = await runTm05_1hDecision('m1', ACTIVE_SNAP, new Date(), { env: CFG, matchStore: store });
  assert.equal(res.status, 'skipped_by_ds');
});

test('suppressed favorite at 25\' → signal + telegram enqueue', async () => {
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  const res = await runTm05_1hDecision('m1', DRY_SNAP, new Date(), { env: CFG, matchStore: store, tgDispatcher: tg });
  assert.equal(res.status, 'signal');
  assert.ok(res.ev >= 1.10);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].decisionKey, 'tm05_1h');
});

test('dry but late (35\', odds 1.8) → gate_blocked', async () => {
  const store = fakeStore(baseRecord());
  const snap = { ...DRY_SNAP, observedMinute: 35 };
  const res = await runTm05_1hDecision('m1', snap, new Date(), { env: CFG, matchStore: store });
  assert.equal(res.status, 'gate_blocked');
});

test('goal before halftime → goal_during_decision', async () => {
  const store = fakeStore(baseRecord({ tracking: { status: 'active', firstGoalMinute: 22 } }));
  const res = await runTm05_1hDecision('m1', DRY_SNAP, new Date(), { env: CFG, matchStore: store });
  assert.equal(res.status, 'goal_during_decision');
});

test('locked phase → already_decided (idempotent)', async () => {
  const store = fakeStore(baseRecord({ predictions: { tm05_1h: { phase: 'signal' } } }));
  const res = await runTm05_1hDecision('m1', DRY_SNAP, new Date(), { env: CFG, matchStore: store });
  assert.equal(res.status, 'already_decided');
});

test('reasoning formats favorite xG to 2 decimals when present', async () => {
  const store = fakeStore(baseRecord());
  await runTm05_1hDecision('m1', DRY_SNAP, new Date(), { env: CFG, matchStore: store });
  const reasoning = store.record.predictions.tm05_1h.reasoning;
  assert.match(reasoning, /xG=0\.05/);
  assert.doesNotMatch(reasoning, /\?/);
});

// ── Inverted-decision test mode (LIVE_1H_INVERT_DECISION) ────────────────────
// Behind the flag we REVERT the decision: signal exactly on the band that the
// normal gate skips (DS in [INVERT_DS_MIN, INVERT_DS_MAX]) and skip everything
// else. No formula changes — only the BET/SKIP branch flips. The EV gate is
// bypassed because it is built on the non-inverted probability mapping and would
// block these low-DS matches.
const CFG_INVERTED = {
  ...CFG,
  LIVE_1H_INVERT_DECISION: true,
  LIVE_1H_INVERT_DS_MIN: 20,
  LIVE_1H_INVERT_DS_MAX: 64,
};

// Basic-stats "leader active early but quieted" snapshot: favorite (home) has
// 2 shots on target → fav_shots component ≈ 20, balanced possession → DS ≈ 37.
// In normal mode DS < 70 → skipped; in inverted mode 20 ≤ 37 ≤ 64 → signal.
const BAND_SNAP = {
  observedMinute: 25,
  cumulative: {
    shotsOnTarget: { home: 2, away: 0 },
    totalShots: { home: 3, away: 1 },
  },
  ballPossession: { home: 55, away: 45 },
};

test('inverted mode: DS in band → signal + telegram enqueue', async () => {
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  const res = await runTm05_1hDecision('m1', BAND_SNAP, new Date(), { env: CFG_INVERTED, matchStore: store, tgDispatcher: tg });
  assert.equal(res.status, 'signal');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].decisionKey, 'tm05_1h');
});

test('inverted mode: high DS (normal signal) → skipped', async () => {
  // DRY_SNAP yields DS ≈ 90, above the inverted band → now a SKIP.
  const store = fakeStore(baseRecord());
  const res = await runTm05_1hDecision('m1', DRY_SNAP, new Date(), { env: CFG_INVERTED, matchStore: store });
  assert.equal(res.status, 'skipped_by_ds');
});

test('inverted mode: very active favorite below band (DS < 20) → skipped', async () => {
  // ACTIVE_SNAP yields DS ≈ 11, below the band lower bound → SKIP.
  const store = fakeStore(baseRecord());
  const res = await runTm05_1hDecision('m1', ACTIVE_SNAP, new Date(), { env: CFG_INVERTED, matchStore: store });
  assert.equal(res.status, 'skipped_by_ds');
});

test('inverted mode: goal before halftime still wins → goal_during_decision', async () => {
  const store = fakeStore(baseRecord({ tracking: { status: 'active', firstGoalMinute: 22 } }));
  const res = await runTm05_1hDecision('m1', BAND_SNAP, new Date(), { env: CFG_INVERTED, matchStore: store });
  assert.equal(res.status, 'goal_during_decision');
});

test('reasoning omits xG (no bare "?") when xG stat is missing', async () => {
  // Basic-stats match: no xG, but dry by shots/touches → still a signal.
  const noXgSnap = {
    observedMinute: 25,
    cumulative: {
      shotsOnTarget: { home: 0, away: 0 },
      totalShots: { home: 1, away: 1 },
      touchesInOppositionBox: { home: 2, away: 3 },
      bigChances: { home: 0, away: 0 },
      yellowCards: { home: 0, away: 0 },
      redCards: { home: 0, away: 0 },
    },
    ballPossession: { home: 50, away: 50 },
  };
  const store = fakeStore(baseRecord());
  await runTm05_1hDecision('m1', noXgSnap, new Date(), { env: CFG, matchStore: store });
  const reasoning = store.record.predictions.tm05_1h.reasoning;
  assert.doesNotMatch(reasoning, /\?/);
  assert.doesNotMatch(reasoning, /xG=/);
  assert.match(reasoning, /у площину=0/);
});
