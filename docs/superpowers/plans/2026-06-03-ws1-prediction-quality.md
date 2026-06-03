# WS-1 — Prediction Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine emit signals again and become measurable — decouple AI probability from the EV decision, build a replay/calibration harness, allow re-evaluation across decision windows, and fix scoring bugs.

**Architecture:** AI returns ONLY a calibrated probability + confidence; `evGate` is the sole decision-maker with confidence as a soft shrink toward a per-track baseline. A replay harness computes Brier/log-loss/ROI from stored snapshots+finals so every threshold change is validated empirically.

**Tech Stack:** Node.js, `node:test`, existing modules (`evGate`, `drynessScore`, `pressureScore`, `aiClient`, `matchStore`).

**Execution order:** Run AFTER WS-2 (storage hydration) lands if possible, because Task 6 scoring touches snapshot shape. If WS-2 not yet merged, scorers still read `snapshot.delta`/`snapshot.since2H` which exist in current data. Tasks 1-5 are independent of WS-2.

---

### Task 1: Calibration metrics module (keystone foundation)

**Files:**
- Create: `src/prediction/calibrationMetrics.js`
- Test: `test/calibrationMetrics.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { brier, logLoss, roiFlat, roiKelly } = require('../src/prediction/calibrationMetrics');

test('brier score: perfect prediction = 0', () => {
  assert.equal(brier([{ p: 1, outcome: 1 }, { p: 0, outcome: 0 }]), 0);
});

test('brier score: worst prediction = 1', () => {
  assert.equal(brier([{ p: 0, outcome: 1 }, { p: 1, outcome: 0 }]), 1);
});

test('logLoss penalizes confident wrong predictions', () => {
  const good = logLoss([{ p: 0.9, outcome: 1 }]);
  const bad = logLoss([{ p: 0.1, outcome: 1 }]);
  assert.ok(bad > good);
});

test('roiFlat: 1 win at odds 2.0, 1 loss = 0', () => {
  // stake 1 each: win returns +1.0 (2.0-1), loss -1.0 → net 0 over 2 bets
  assert.equal(roiFlat([{ odds: 2.0, outcome: 1 }, { odds: 2.0, outcome: 0 }]), 0);
});

test('roiKelly: positive edge yields positive roi', () => {
  const r = roiKelly([{ p: 0.6, odds: 2.0, outcome: 1 }, { p: 0.6, odds: 2.0, outcome: 1 }]);
  assert.ok(r > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/calibrationMetrics.test.js`
Expected: FAIL — `Cannot find module '../src/prediction/calibrationMetrics'`

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';

// Each sample: { p: number(0..1), outcome: 0|1, odds?: number }
function brier(samples) {
  if (!samples.length) return null;
  const sum = samples.reduce((acc, s) => acc + (s.p - s.outcome) ** 2, 0);
  return +(sum / samples.length).toFixed(6);
}

function logLoss(samples) {
  if (!samples.length) return null;
  const eps = 1e-15;
  const sum = samples.reduce((acc, s) => {
    const p = Math.min(1 - eps, Math.max(eps, s.p));
    return acc + (s.outcome ? -Math.log(p) : -Math.log(1 - p));
  }, 0);
  return +(sum / samples.length).toFixed(6);
}

// Flat stake 1 unit per bet. ROI = net profit / total staked.
function roiFlat(bets) {
  if (!bets.length) return null;
  let staked = 0; let net = 0;
  for (const b of bets) {
    staked += 1;
    net += b.outcome ? (b.odds - 1) : -1;
  }
  return +(net / staked).toFixed(6);
}

// Fractional Kelly (half-Kelly) staking. ROI = net profit / total staked.
function roiKelly(bets, fraction = 0.5) {
  if (!bets.length) return null;
  let staked = 0; let net = 0;
  for (const b of bets) {
    const edge = b.p * b.odds - 1;
    const f = edge > 0 ? fraction * (edge / (b.odds - 1)) : 0;
    if (f <= 0) continue;
    staked += f;
    net += b.outcome ? f * (b.odds - 1) : -f;
  }
  return staked > 0 ? +(net / staked).toFixed(6) : null;
}

module.exports = { brier, logLoss, roiFlat, roiKelly };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/calibrationMetrics.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/prediction/calibrationMetrics.js test/calibrationMetrics.test.js
git commit -m "feat(prediction): add calibration metrics (brier, logLoss, ROI)"
```

---

### Task 2: Replay harness script

**Files:**
- Create: `scripts/predictionReplay.js`
- Test: `test/predictionReplay.test.js`

The harness derives per-track outcomes from stored matches and computes metrics.
Outcome rules: **TM05 wins** if `final` total goals == 0; **TB05 wins** if total goals >= 1.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSamplesFromStore } = require('../scripts/predictionReplay');

const store = {
  m1: {
    final: { scoreHome: 0, scoreAway: 0 },
    predictions: {
      tm05: { phase: 'signal', pNoGoal: 0.6, confidence: 0.7, odds: 2.0 },
      tb05: null,
    },
  },
  m2: {
    final: { scoreHome: 1, scoreAway: 0 },
    predictions: {
      tm05: { phase: 'gate_blocked', pNoGoal: 0.5, confidence: 0.6, odds: 2.0 },
      tb05: { phase: 'signal', pGoal: 0.55, confidence: 0.7, odds: 1.9 },
    },
  },
};

test('buildSamplesFromStore extracts tm05 samples with correct outcomes', () => {
  const { tm05 } = buildSamplesFromStore(store);
  // m1: final 0:0 → tm05 outcome 1; m2: final 1:0 → tm05 outcome 0
  const m1 = tm05.find(s => s.matchId === 'm1');
  const m2 = tm05.find(s => s.matchId === 'm2');
  assert.equal(m1.outcome, 1);
  assert.equal(m2.outcome, 0);
  assert.equal(m1.p, 0.6);
});

test('buildSamplesFromStore extracts tb05 outcome from goal presence', () => {
  const { tb05 } = buildSamplesFromStore(store);
  const m2 = tb05.find(s => s.matchId === 'm2');
  assert.equal(m2.outcome, 1); // 1:0 → at least one goal
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/predictionReplay.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
const fs = require('fs');
const path = require('path');
const { brier, logLoss, roiFlat, roiKelly } = require('../src/prediction/calibrationMetrics');

const DATA_ROOT = path.resolve(__dirname, '../data/logs');

function totalGoals(final) {
  if (!final) return null;
  return (final.scoreHome || 0) + (final.scoreAway || 0);
}

// Returns { tm05: [...samples], tb05: [...samples] }.
// A sample is included only when the track has a logged probability AND a final exists.
function buildSamplesFromStore(store) {
  const tm05 = []; const tb05 = [];
  for (const [matchId, m] of Object.entries(store)) {
    const g = totalGoals(m.final);
    if (g == null) continue;
    const tm = m.predictions?.tm05;
    if (tm && tm.pNoGoal != null) {
      tm05.push({ matchId, p: tm.pNoGoal, confidence: tm.confidence ?? null,
        odds: tm.odds ?? null, phase: tm.phase, outcome: g === 0 ? 1 : 0 });
    }
    const tb = m.predictions?.tb05;
    if (tb && tb.pGoal != null) {
      tb05.push({ matchId, p: tb.pGoal, confidence: tb.confidence ?? null,
        odds: tb.odds ?? null, phase: tb.phase, outcome: g >= 1 ? 1 : 0 });
    }
  }
  return { tm05, tb05 };
}

function report(label, samples) {
  if (!samples.length) return { label, n: 0 };
  const bets = samples.filter(s => s.phase === 'signal' && s.odds);
  return {
    label,
    n: samples.length,
    brier: brier(samples),
    logLoss: logLoss(samples),
    signals: bets.length,
    hitRate: bets.length ? +(bets.filter(b => b.outcome).length / bets.length).toFixed(4) : null,
    roiFlat: roiFlat(bets),
    roiKelly: roiKelly(bets),
  };
}

function listDateDirs(range) {
  const all = fs.readdirSync(DATA_ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!range) return all;
  const [from, to] = range.split('..');
  return all.filter(d => d >= from && d <= (to || from));
}

function main() {
  const range = process.argv[2]; // e.g. "2026-05-09..2026-05-13"
  const dirs = listDateDirs(range);
  const merged = { tm05: [], tb05: [] };
  for (const d of dirs) {
    const file = path.join(DATA_ROOT, d, 'matches.json');
    if (!fs.existsSync(file)) continue;
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = buildSamplesFromStore(store);
    merged.tm05.push(...s.tm05);
    merged.tb05.push(...s.tb05);
  }
  const out = { range: range || 'all', dates: dirs,
    tm05: report('TM05', merged.tm05), tb05: report('TB05', merged.tb05) };
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main();

module.exports = { buildSamplesFromStore, report };
```

- [ ] **Step 4: Run test + smoke-run on real data**

Run: `node --test test/predictionReplay.test.js`
Expected: PASS (2 tests)
Run: `node scripts/predictionReplay.js 2026-05-09..2026-05-13`
Expected: JSON with `tm05`/`tb05` reports (brier numbers, signals count).

- [ ] **Step 5: Commit**

```bash
git add scripts/predictionReplay.js test/predictionReplay.test.js
git commit -m "feat(prediction): replay harness with brier/ROI per track"
```

---

### Task 3: Decouple confidence from EV gate (soft shrink)

**Files:**
- Modify: `src/prediction/evGate.js`
- Test: `test/aiGate.test.js` is dead (deleted in WS-3); create `test/evGate.test.js`

Gate stops hard-rejecting on `decision !== 'BET'` and on `confidence < min`.
Instead it shrinks `p` toward a per-track baseline by confidence, then checks EV.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateEvGate } = require('../src/prediction/evGate');

test('high prob + full confidence passes when EV >= min', () => {
  const r = evaluateEvGate({ probability: 0.6, confidence: 1.0, odds: 2.0, baseline: 0.45 });
  assert.equal(r.pass, true);
  assert.ok(r.ev >= 1.10);
});

test('low confidence shrinks p toward baseline and can block', () => {
  // p=0.6 conf=0.0 → pAdj=baseline 0.45 → 0.45*2.0=0.9 < 1.10 → block
  const r = evaluateEvGate({ probability: 0.6, confidence: 0.0, odds: 2.0, baseline: 0.45 });
  assert.equal(r.pass, false);
  assert.equal(r.reason, 'negative_ev');
  assert.equal(r.pAdj, 0.45);
});

test('decision field is ignored (no decision_not_bet path)', () => {
  const r = evaluateEvGate({ probability: 0.7, confidence: 1.0, odds: 2.0, baseline: 0.45, decision: 'SKIP' });
  assert.equal(r.pass, true);
});

test('invalid odds blocks', () => {
  const r = evaluateEvGate({ probability: 0.7, confidence: 1.0, odds: null, baseline: 0.45 });
  assert.equal(r.reason, 'odds_invalid');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/evGate.test.js`
Expected: FAIL — current gate returns `decision_not_bet` and has no `pAdj`/`baseline`.

- [ ] **Step 3: Rewrite `evGate.js`**

```js
'use strict';

const DEFAULTS = {
  evMin: 1.10,
  baseline: 0.45, // per-track baseline probability; pass explicitly per track
};

/**
 * EV gate — sole BET/SKIP decision-maker.
 * Confidence is a soft shrink toward baseline, NOT a hard cutoff:
 *   pAdj = baseline + (probability - baseline) * confidence
 *
 * @returns {{ pass:boolean, reason:string|null, ev:number|null, pAdj:number|null }}
 */
function evaluateEvGate({ probability, confidence, odds, baseline, thresholds } = {}) {
  const T = { ...DEFAULTS, ...(thresholds || {}) };
  const base = Number.isFinite(baseline) ? baseline : T.baseline;

  if (probability == null || !Number.isFinite(probability)) {
    return { pass: false, reason: 'probability_missing', ev: null, pAdj: null };
  }
  if (probability < 0 || probability > 1) {
    return { pass: false, reason: 'probability_out_of_range', ev: null, pAdj: null };
  }
  const conf = (confidence == null || !Number.isFinite(confidence))
    ? 1 : Math.min(1, Math.max(0, confidence));
  if (odds == null || !Number.isFinite(odds) || odds <= 1) {
    return { pass: false, reason: 'odds_invalid', ev: null, pAdj: null };
  }

  const pAdj = +(base + (probability - base) * conf).toFixed(4);
  const ev = +(pAdj * odds).toFixed(4);
  if (ev < T.evMin) {
    return { pass: false, reason: 'negative_ev', ev, pAdj };
  }
  return { pass: true, reason: null, ev, pAdj };
}

module.exports = { evaluateEvGate, DEFAULTS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/evGate.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/prediction/evGate.js test/evGate.test.js
git commit -m "feat(prediction): decouple confidence from gate via soft baseline shrink"
```

---

### Task 4: Wire baseline into decision runners + update prompts/schemas

**Files:**
- Modify: `src/prediction/runTm05Decision.js:114-120`
- Modify: `src/prediction/runTb05Decision.js:124-130`
- Modify: `src/ai/prompts/tm05Prompt.js:34-38` (SYSTEM rules block)
- Modify: `src/ai/prompts/tb05Prompt.js:33-37`
- Modify: `src/ai/schemas/tm05Schema.js`, `src/ai/schemas/tb05Schema.js` (decision optional)

- [ ] **Step 1: Add baseline constants + pass into gate (runTm05Decision.js)**

Add near top constants:
```js
const TM05_BASELINE_P = Number(process.env.LIVE_TM05_BASELINE_P) || 0.45;
```
Replace the gate call:
```js
  const odds = tm05OddsAt(snapshot60.observedMinute || 60);
  const gate = evaluateEvGate({
    probability: aiResult.output.p_no_goal,
    confidence: aiResult.output.confidence,
    odds,
    baseline: TM05_BASELINE_P,
  });
```

- [ ] **Step 2: Same for runTb05Decision.js**

```js
const TB05_BASELINE_P = Number(process.env.LIVE_TB05_BASELINE_P) || 0.30;
```
```js
  const odds = tb05OddsAt(snapshot80.observedMinute || 80);
  const gate = evaluateEvGate({
    probability: aiResult.output.p_goal,
    confidence: aiResult.output.confidence,
    odds,
    baseline: TB05_BASELINE_P,
  });
```

- [ ] **Step 3: Edit prompts — remove self-decision rules**

In `tm05Prompt.js` replace the `ПРАВИЛА:` block (lines ~34-38) with:
```
ПРАВИЛА:
- Поверни ЧЕСНУ p_no_goal — реальну ймовірність 0:0 до кінця матчу. НЕ занижуй і НЕ завищуй.
- НЕ вирішуй сам BET/SKIP — рішення про ставку приймає окремий математичний гейт.
- confidence = наскільки ти впевнений у своїй p_no_goal (0..1), чесно.
- 3-5 key_signals, найвагоміші зверху.
```
In `tb05Prompt.js` replace analogous block with the TB-worded equivalent
(`p_goal` instead of `p_no_goal`, "ймовірність ≥1 голу до кінця").

- [ ] **Step 4: Make `decision` optional in schemas**

In `tm05Schema.js` and `tb05Schema.js` replace the decision check:
```js
  const decision = raw.decision; // optional, diagnostic only
  if (decision != null && !VALID_DECISIONS.has(decision)) {
    return { ok: false, error: `decision, if present, must be BET or SKIP, got "${decision}"` };
  }
```
Keep `decision` in `normalized` (may be null).

- [ ] **Step 5: Run full suite + commit**

Run: `node --test test/*.test.js`
Expected: PASS (existing + new)

```bash
git add src/prediction/runTm05Decision.js src/prediction/runTb05Decision.js src/ai/prompts/tm05Prompt.js src/ai/prompts/tb05Prompt.js src/ai/schemas/tm05Schema.js src/ai/schemas/tb05Schema.js
git commit -m "feat(prediction): AI returns honest probability only; gate owns BET/SKIP"
```

---

### Task 5: Remove single-call lock for negative phases

**Files:**
- Modify: `src/prediction/runTm05Decision.js:36`
- Modify: `src/prediction/runTb05Decision.js:51`
- Modify: `src/tracker/snapshotCollector.js:186-194, 203-210`
- Modify: `src/config/env.js` (add `LIVE_AI_REEVAL_MIN_GAP_MIN`)
- Test: `test/decisionReeval.test.js`

- [ ] **Step 1: Define re-eval policy + add env**

In `env.js` add:
```js
  LIVE_AI_REEVAL_MIN_GAP_MIN: envInt('LIVE_AI_REEVAL_MIN_GAP_MIN', 10),
```

- [ ] **Step 2: Write failing test for lock policy**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isLockedPhase } = require('../src/prediction/lockPolicy');

test('signal phase is locked', () => assert.equal(isLockedPhase('signal'), true));
test('goal_during_decision is locked', () => assert.equal(isLockedPhase('goal_during_decision'), true));
test('skipped_by_ds is NOT locked', () => assert.equal(isLockedPhase('skipped_by_ds'), false));
test('gate_blocked is NOT locked', () => assert.equal(isLockedPhase('gate_blocked'), false));
test('null phase is NOT locked', () => assert.equal(isLockedPhase(null), false));
```

- [ ] **Step 3: Create `src/prediction/lockPolicy.js`**

```js
'use strict';
const TERMINAL_PHASES = new Set(['signal', 'goal_during_decision']);
function isLockedPhase(phase) {
  return TERMINAL_PHASES.has(phase);
}
module.exports = { isLockedPhase, TERMINAL_PHASES };
```

- [ ] **Step 4: Replace idempotency guards**

In `runTm05Decision.js` replace line 36:
```js
  const { isLockedPhase } = require('./lockPolicy');
  if (isLockedPhase(match.predictions?.tm05?.phase)) return { status: 'already_decided' };
```
In `runTb05Decision.js` replace line 51 analogously with `tb05`.

In `snapshotCollector.js` replace both `!fresh.predictions?.tm05` / `!fresh.predictions?.tb05` guards with:
```js
const { isLockedPhase } = require('../prediction/lockPolicy');
// ...
    if (fresh && !isLockedPhase(fresh.predictions?.tm05?.phase)) { ... }
```
(and tb05 equivalent).

- [ ] **Step 5: Guard repeat paid AI calls inside runners**

Before the `callAIImpl` block in each runner, skip a fresh AI call if a recent
one exists; reuse logged output and just re-run the gate:
```js
  const prev = match.predictions?.tm05;
  const nowMin = snapshot60.observedMinute || 60;
  const recentAi = prev?.ai?.output && prev?.requestedAtMinute != null
    && (nowMin - prev.requestedAtMinute) < cfg.LIVE_AI_REEVAL_MIN_GAP_MIN;
  const aiResult = recentAi ? prev.ai : await callAIImpl({ /* ... */ });
```
And add `requestedAtMinute: nowMin` to the persisted payload.

- [ ] **Step 6: Run test + suite + commit**

Run: `node --test test/decisionReeval.test.js test/*.test.js`
Expected: PASS

```bash
git add src/prediction/lockPolicy.js test/decisionReeval.test.js src/prediction/runTm05Decision.js src/prediction/runTb05Decision.js src/tracker/snapshotCollector.js src/config/env.js
git commit -m "feat(prediction): re-evaluate on negative phases, lock only on signal"
```

---

### Task 6: Scoring fixes (cards, PS weights, live dominance, snapshot match, basic stats)

**Files:**
- Modify: `src/scoring/drynessScore.js:60-65`
- Modify: `src/scoring/pressureScore.js:80-105`
- Modify: `src/prediction/runTb05Decision.js:15-26` (findSnapshotByMinute maxDiff)
- Modify: `src/prediction/runTm05Decision.js:75-82`, `src/prediction/runTb05Decision.js:85-92` (basic soft)
- Modify: `src/config/env.js` (`LIVE_PRED_BASIC_DS_MIN`)
- Test: `test/scoringFixes.test.js`

- [ ] **Step 1: Write failing tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COMPONENTS: DRY } = require('../src/scoring/drynessScore');

test('dryFromCards returns 100 (dry) when zero cards, not null', () => {
  const fn = DRY.find(c => c.key === 'cards').fn;
  const snap = { cumulative: { yellowCards: { home: 0, away: 0 }, redCards: { home: 0, away: 0 } } };
  assert.equal(fn(snap), 100);
});
```

- [ ] **Step 2: Run → fail**

Run: `node --test test/scoringFixes.test.js`
Expected: FAIL — returns `null` currently. (Note: dryFromCards is not exported by key; export `COMPONENTS` already exists — `DRY.find` works.)

- [ ] **Step 3a: Fix `dryFromCards` (drynessScore.js)**

```js
function dryFromCards(snapshot) {
  const y = sumSide(snapshot?.cumulative?.yellowCards);
  const r = sumSide(snapshot?.cumulative?.redCards);
  if (y == null && r == null) return null; // stat truly missing
  const total = (y || 0) * 15 + (r || 0) * 40;
  // zero cards = calm match = maximally dry
  return Math.max(0, 100 - total);
}
```

- [ ] **Step 3b: Rebalance PS weights + live dominance (pressureScore.js)**

Add cumulative-2H scorers using `since2H`:
```js
function presFromXg2H(s80) {
  const xg = sumSide(s80?.since2H?.expectedGoalsXg);
  if (xg == null) return null;
  return 100 * clamp(xg / 1.2, 0, 1);
}
function presFromSot2H(s80) {
  const sot = sumSide(s80?.since2H?.shotsOnTarget);
  if (sot == null) return null;
  return 100 * clamp(sot / 5, 0, 1);
}
function presFromBigChances2H(s80) {
  const big = sumSide(s80?.since2H?.bigChances);
  if (big == null) return null;
  return 100 * clamp(big / 2, 0, 1);
}
```
Replace `presFromFavoriteOddsDisparity` with live dominance:
```js
function presFromLiveDominance(match, s80) {
  const xg = s80?.since2H?.expectedGoalsXg;
  const sot = s80?.since2H?.shotsOnTarget;
  const touch = s80?.since2H?.touchesInOppositionBox;
  const parts = [];
  if (xg) parts.push(Math.abs((xg.home || 0) - (xg.away || 0)) / 0.6);
  if (sot) parts.push(Math.abs((sot.home || 0) - (sot.away || 0)) / 4);
  if (touch) parts.push(Math.abs((touch.home || 0) - (touch.away || 0)) / 8);
  if (!parts.length) return null;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return clamp(avg * 100, 0, 100);
}
```
New COMPONENTS table (delta weights cut from 75→40):
```js
const COMPONENTS = [
  { key: 'xg_delta_10',          weight: 12, fn: (m, s80) => presFromXgDelta10(s80) },
  { key: 'sot_delta_10',         weight: 10, fn: (m, s80) => presFromSotDelta10(s80) },
  { key: 'touches_delta_10',     weight: 8,  fn: (m, s80) => presFromTouchesDelta10(s80) },
  { key: 'corners_delta_10',     weight: 5,  fn: (m, s80) => presFromCornersDelta10(s80) },
  { key: 'big_chances_delta_10', weight: 5,  fn: (m, s80) => presFromBigChancesDelta10(s80) },
  { key: 'xg_2h',                weight: 15, fn: (m, s80) => presFromXg2H(s80) },
  { key: 'sot_2h',               weight: 12, fn: (m, s80) => presFromSot2H(s80) },
  { key: 'big_chances_2h',       weight: 8,  fn: (m, s80) => presFromBigChances2H(s80) },
  { key: 'possession_imbalance', weight: 5,  fn: (m, s80) => presFromPossessionImbalance(s80) },
  { key: 'live_dominance',       weight: 10, fn: (m, s80) => presFromLiveDominance(m, s80) },
];
```

- [ ] **Step 3c: findSnapshotByMinute maxDiff (runTb05Decision.js)**

```js
function findSnapshotByMinute(snapshots, target, maxDiff = 10) {
  if (!snapshots?.length) return null;
  let best = null; let bestDiff = Infinity;
  for (const s of snapshots) {
    const m = s.minute ?? s.observedMinute;
    if (m == null) continue;
    const diff = Math.abs(m - target);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return bestDiff > maxDiff ? null : best;
}
```

- [ ] **Step 3d: Soft basic-stats gate**

In `env.js`:
```js
  LIVE_PRED_BASIC_DS_MIN: envInt('LIVE_PRED_BASIC_DS_MIN', 70),
```
In `runTm05Decision.js` replace the `statsLevel !== 'detailed'` hard-return with:
```js
  if (match.statsLevel !== 'detailed') {
    if (ds.score == null || ds.score < cfg.LIVE_PRED_BASIC_DS_MIN) {
      store.setTm05Decision(matchId, { phase: 'basic_below_threshold', dsScore: ds.score,
        decidedAt: new Date().toISOString() }, date);
      return { status: 'basic_below_threshold', dsScore: ds.score };
    }
    // else: allow AI on basic stats with the higher bar
  }
```
Analogous in `runTb05Decision.js` using `ps.score`.

- [ ] **Step 4: Run tests + replay before/after**

Run: `node --test test/*.test.js`
Expected: PASS
Run: `node scripts/predictionReplay.js 2026-05-09..2026-05-13`
Expected: more `signals` than baseline; record brier/ROI in commit body.

- [ ] **Step 5: Commit**

```bash
git add src/scoring/drynessScore.js src/scoring/pressureScore.js src/prediction/runTb05Decision.js src/prediction/runTm05Decision.js src/config/env.js test/scoringFixes.test.js
git commit -m "fix(scoring): cards=0 is dry, rebalance PS to 2H cumulative, live dominance, basic-stats soft gate"
```

---

### Task 7: Goal-during-decision race hardening

**Files:**
- Modify: `src/prediction/runTm05Decision.js:122-128`
- Modify: `src/prediction/runTb05Decision.js:132-136`

- [ ] **Step 1: Use firstGoalMinute as authoritative race check**

Replace the `goalAfterCall` logic in both runners with:
```js
  const fresh = store.getMatch(matchId, date);
  const snapMin = (snapshot60.observedMinute || 60); // (snapshot80||80) in TB
  const goalAfterCall = fresh?.tracking?.firstGoalMinute != null
    && fresh.tracking.firstGoalMinute >= snapMin;
```
This catches a goal scored between the snapshot and now even if no newer snapshot
has been appended yet (appendSnapshot already sets firstGoalMinute on any score change).

- [ ] **Step 2: Run suite + commit**

Run: `node --test test/*.test.js`
Expected: PASS

```bash
git add src/prediction/runTm05Decision.js src/prediction/runTb05Decision.js
git commit -m "fix(prediction): authoritative goal-race check via firstGoalMinute"
```

---

### Task 8: Model A/B (operational, no code change)

This is a procedure run via the harness, not a code task.

- [ ] Set `LIVE_AI_MODEL` to candidate (e.g. `gpt-5`, `claude-sonnet-4-...` if wired).
- [ ] Run `node scripts/predictionReplay.js <range> --fresh-ai` (requires adding a
      `--fresh-ai` flag that re-invokes `callAI` per stored snapshot — only build
      this flag if A/B is greenlit; default replay uses logged outputs).
- [ ] Compare brier/logLoss/calibration vs gpt-4o; record in a results note.

---

## Self-review notes
- Spec P0a (decouple) → Tasks 3,4. P0b (harness) → Tasks 1,2. P1a (lock) → Task 5.
  P1b (scoring) → Task 6. P2a (race) → Task 7. P2b (A/B) → Task 8. All covered.
- `evaluateEvGate` signature changed (removed `decision` requirement, added
  `baseline`/`pAdj`) — callers updated in Task 4. Old `test/aiGate.test.js`
  removed in WS-3; new `test/evGate.test.js` in Task 3.
