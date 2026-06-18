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
    // draw=4.2 → tm05_1hOddsAt → 1.95 (≥3.8 bucket): EV gate passes at DS≥90 (p≈0.76)
    odds: { isOddsFavorite: { favorite: 'home' }, draw: 4.2 },
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

test('suppressed favorite at 25\' → gate_blocked (DS dormant at real odds)', async () => {
  // DS dormant at real odds (max ev≈0.94<evMin); signal-path is P4. Favorite/DS-gate logic
  // still exercised up to the EV gate.
  const store = fakeStore(baseRecord());
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  const res = await runTm05_1hDecision('m1', DRY_SNAP, new Date(), { env: CFG, matchStore: store, tgDispatcher: tg });
  assert.equal(res.status, 'gate_blocked');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 0);
});

test('dry but too late (36\', market closed → null odds) → gate_blocked', async () => {
  // tm05_1hOddsAt(36, ...) returns null (minute > 35 closes the 1H window)
  // → evaluateEvGate sees odds=null → odds_invalid → blocked regardless of p
  const store = fakeStore(baseRecord());
  const snap = { ...DRY_SNAP, observedMinute: 36 };
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

// ── DS disabled (LIVE_1H_DISABLE_DS): signal regardless of DS, EV bypassed ────
test('DS off: active favorite (low DS) still signals, DS still recorded', async () => {
  const store = fakeStore(baseRecord());
  const cfg = { ...CFG, LIVE_1H_DISABLE_DS: true };
  // ACTIVE_SNAP yields a LOW DS that normally → skipped_by_ds. With DS off → signal.
  const res = await runTm05_1hDecision('m1', ACTIVE_SNAP, new Date(), { env: cfg, matchStore: store });
  assert.equal(res.status, 'signal');
  assert.ok(store.record.predictions.tm05_1h.dsScore != null); // DS still recorded for analysis
});

test('DS off still respects favorite gate (home blocked when away-only)', async () => {
  const store = fakeStore(baseRecord()); // home favorite
  const cfg = { ...CFG, LIVE_1H_DISABLE_DS: true, LIVE_1H_AWAY_FAV_ONLY: true };
  const res = await runTm05_1hDecision('m1', ACTIVE_SNAP, new Date(), { env: cfg, matchStore: store });
  assert.equal(res.status, 'skipped_by_fav');
});

// ── Favorite bet-gate (LIVE_1H_AWAY_FAV_ONLY / LIVE_1H_FAV_ODDS_MIN) ──────────
// The gate suppresses the SIGNAL but the match is still tracked and DS recorded,
// so the dataset stays complete for offline analysis.
test('away-only on + home favorite → skipped_by_fav, no telegram, DS recorded', async () => {
  const store = fakeStore(baseRecord()); // baseRecord favorite is 'home'
  const calls = [];
  const tg = { enqueueEntry: (a) => { calls.push(a); return Promise.resolve(); } };
  const cfg = { ...CFG, LIVE_1H_AWAY_FAV_ONLY: true };
  const res = await runTm05_1hDecision('m1', DRY_SNAP, new Date(), { env: cfg, matchStore: store, tgDispatcher: tg });
  assert.equal(res.status, 'skipped_by_fav');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 0);
  assert.ok(store.record.predictions.tm05_1h.dsScore != null); // DS still recorded
});

test('away-only on + away favorite → gate_blocked (DS dormant at real odds)', async () => {
  // DS dormant at real odds (max ev≈0.94<evMin); signal-path is P4. Favorite/DS-gate logic
  // still exercised up to the EV gate.
  // Mirror of DRY_SNAP with the AWAY side suppressed → high DS → EV gate is the stopper.
  const drySnapAway = {
    observedMinute: 25,
    cumulative: {
      expectedGoalsXg: { home: 0.10, away: 0.05 },
      shotsOnTarget: { home: 1, away: 0 },
      touchesInOppositionBox: { home: 5, away: 2 },
      bigChances: { home: 0, away: 0 },
      yellowCards: { home: 0, away: 0 },
      redCards: { home: 0, away: 0 },
    },
    ballPossession: { home: 50, away: 50 },
  };
  const store = fakeStore(baseRecord({ odds: { isOddsFavorite: { favorite: 'away' }, draw: 4.2 } }));
  const cfg = { ...CFG, LIVE_1H_AWAY_FAV_ONLY: true };
  const res = await runTm05_1hDecision('m1', drySnapAway, new Date(), { env: cfg, matchStore: store });
  assert.equal(res.status, 'gate_blocked');
});

// ── Confirm-guard coverage lives in test/runOneH_AiDecision.test.js ──────────
// The DS engine is DORMANT at real odds (max ev≈0.94<evMin) so it can never
// reach finalPhase==='signal' in normal mode. The identical confirm-read guard
// exists in runOneH_AiDecision.js, which CAN fire signals. Confirm-guard tests
// are in runOneH_AiDecision.test.js (tests: "confirmLiveScore returns goal",
// "confirm still 0:0 → signal sent", "confirm fetch fails → signal still sent").

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
