# 1H ТМ/ТБ Model Fixes (P0–P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live 1H AI betting engine honest — real(istic) odds in the EV gate, a direction-consensus gate, a p≥0.50 floor, and a prompt that trusts live evidence.

**Architecture:** All decision logic lives in [runOneH_AiDecision.js](../../../src/prediction/runOneH_AiDecision.js). P0 changes the odds source ([oddsTable.js](../../../src/scoring/oddsTable.js)); P1 adds a shared `signalConsensus.js` consulted before the EV gate (flip-when-confident / skip-when-weak); P2 adds a probability floor; P3 edits the prompt. The contradiction heuristic becomes one shared module reused by the `analyze-predictions` skill.

**Tech Stack:** Node.js, `node:test` + `node:assert/strict`, CommonJS.

**Source spec:** [docs/superpowers/specs/2026-06-17-1h-model-fixes-design.md](../specs/2026-06-17-1h-model-fixes-design.md)
**Background:** [docs/plans/1h-model-fixes-2026-06-17.md](../../plans/1h-model-fixes-2026-06-17.md)

> ⚠️ Line numbers below are anchors as of 2026-06-18 (commit 822a86e). Re-verify with a quick read before editing — the file may have moved.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/scoring/oddsTable.js` | Odds source for 1H lines | Modify (P0) |
| `src/prediction/signalConsensus.js` | Heuristic AI-signal↔direction detector | **Create** (P1) |
| `src/prediction/runOneH_AiDecision.js` | Decision orchestration | Modify (P0/P1/P2) |
| `src/prediction/lockPolicy.js` | Terminal-phase set (idempotency) | Modify (P1/P2) |
| `src/config/env.js` | Config flags | Modify (P1/P2) |
| `src/ai/prompts/oneH_Prompt.js` | LLM prompt | Modify (P3) |
| `.claude/skills/analyze-predictions/analyze.js` | Retro evaluator | Modify (DRY) |
| `test/oddsTable1h.test.js` | P0 tests | Modify |
| `test/signalConsensus.test.js` | P1 tests | **Create** |
| `test/runOneH_AiDecision.test.js` | P1/P2 wiring tests | Modify |
| `test/oneH_Prompt.test.js` | P3 test | Modify |

**Design note / deviation from spec:** the spec listed a `LIVE_1H_REAL_ODDS` kill-switch. Dropped as YAGNI — the legacy odds were outright wrong (ТБ table inverted in time), so there is nothing worth preserving behind a flag. The new odds always apply. `LIVE_1H_MIN_P` and `LIVE_1H_CONSENSUS_GATE` flags are kept (they toggle real, debatable behavior).

---

## Task 1: P0 — realistic, draw-aware odds in oddsTable.js

**Files:**
- Modify: `src/scoring/oddsTable.js:19-32,57-69`
- Test: `test/oddsTable1h.test.js`

- [ ] **Step 1: Find existing usages of the raw tables** (so the test rewrite is complete)

Run: `grep -rn "TM05_1H_ODDS_BY_MINUTE\|TB05_1H_ODDS_BY_MINUTE\|tm05_1hOddsAt\|tb05_1hOddsAt" src test`
Expected: callers are `runOneH_AiDecision.js`, `oneH_Prompt.js`, `test/oddsTable1h.test.js`. Note each.

- [ ] **Step 2: Write the failing tests** (replace old hardcoded-value assertions in `test/oddsTable1h.test.js`)

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { tm05_1hOddsAt, tb05_1hOddsAt } = require('../src/scoring/oddsTable');

test('tm05_1hOddsAt: draw-bucketed under odds (favorite-aware)', () => {
  assert.equal(tm05_1hOddsAt(27, { draw: 2.22 }), 1.45); // low-scoring → 0:0 likely
  assert.equal(tm05_1hOddsAt(27, { draw: 2.9 }),  1.55);
  assert.equal(tm05_1hOddsAt(27, { draw: 3.58 }), 1.70);
  assert.equal(tm05_1hOddsAt(27, { draw: 3.94 }), 1.95); // high-scoring → goal likely
});

test('tm05_1hOddsAt: fallback base when no draw odds', () => {
  assert.equal(tm05_1hOddsAt(27, {}), 1.60);
  assert.equal(tm05_1hOddsAt(27, undefined), 1.60);
});

test('tm05_1hOddsAt: line closes after the decision window', () => {
  assert.equal(tm05_1hOddsAt(40, { draw: 3.0 }), null);
  assert.equal(tm05_1hOddsAt(null, { draw: 3.0 }), null);
});

test('tb05_1hOddsAt: over odds INCREASE with minute (goal window shrinks)', () => {
  assert.equal(tb05_1hOddsAt(27), 1.80);
  assert.equal(tb05_1hOddsAt(30), 2.10);
  assert.equal(tb05_1hOddsAt(35), 2.50);
  assert.equal(tb05_1hOddsAt(40), null);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/oddsTable1h.test.js`
Expected: FAIL (old `tm05_1hOddsAt(25)` returned 2.60; new signature/values not present).

- [ ] **Step 4: Implement the new odds logic**

Replace `src/scoring/oddsTable.js:19-32` (the two `*_1H_*` tables + comments) with:

```js
// 1HUNDER — ТМ 0.5 першого тайму (0:0 на перерві). Реальний ринок на 25–30' ≈ 1.45–1.97
// і корелює з прематч-кефом нічиєї (проксі очікуваної результативності), НЕ з фіктивними
// 2.6/2.2. Provisional бакети з 2026-06-16 (7 точок) — калібрувати в P4.
const TM05_1H_UNDER_BASE = 1.60; // fallback коли прематч-кеф нічиєї відсутній

function tmUnderOddsFromDraw(drawOdds) {
  if (drawOdds == null || !Number.isFinite(drawOdds)) return TM05_1H_UNDER_BASE;
  if (drawOdds < 2.6) return 1.45;
  if (drawOdds < 3.3) return 1.55;
  if (drawOdds < 3.8) return 1.70;
  return 1.95;
}

// 1HOVER — ТБ 0.5 першого тайму (гол ДО перерви). Вікно для голу скорочується з часом,
// тож P(гол) падає → кеф РОСТЕ. Реальне спостереження 2026-06-16: 27'≈1.8, 30'≈2.1, 35'≈2.5.
// (Стара таблиця спадала — баг: інверсія за часом.)
const TB05_1H_ODDS_BY_MINUTE = {
  25: 1.80,
  30: 2.10,
  35: 2.50,
};
```

Replace `tm05_1hOddsAt` / `tb05_1hOddsAt` (`src/scoring/oddsTable.js:57-69`) with:

```js
function tm05_1hOddsAt(minute, matchOdds) {
  if (minute == null || !Number.isFinite(minute)) return null;
  if (minute > 35) return null; // лінія закрита після вікна рішення
  return tmUnderOddsFromDraw(matchOdds?.draw);
}

function tb05_1hOddsAt(minute, matchOdds) { // matchOdds зарезервовано (favorite-tilt → P4)
  if (minute == null || !Number.isFinite(minute)) return null;
  if (minute < 25) return TB05_1H_ODDS_BY_MINUTE[25];
  if (minute > 35) return null;
  return TB05_1H_ODDS_BY_MINUTE[nearestKey(TB05_1H_ODDS_BY_MINUTE, minute)];
}
```

In `module.exports`, remove `TM05_1H_ODDS_BY_MINUTE` (no longer exists), keep `TB05_1H_ODDS_BY_MINUTE`, add `tmUnderOddsFromDraw`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/oddsTable1h.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scoring/oddsTable.js test/oddsTable1h.test.js
git commit -m "fix(1h-odds): realistic draw-aware ТМ odds + fix inverted ТБ time curve"
```

---

## Task 2: P0 — pass match.odds into the odds functions

**Files:**
- Modify: `src/prediction/runOneH_AiDecision.js:100`
- Modify: `src/ai/prompts/oneH_Prompt.js:121`

> Note: the EV-gate wiring is fully threaded in Task 4 (which rebuilds the odds/baseline block). Here we only update the prompt's display odds + confirm the signature change compiles. Task 4 supersedes line 100.

- [ ] **Step 1: Update the prompt's display odds** — `src/ai/prompts/oneH_Prompt.js:121`

Replace:
```js
  const odds = isOver ? tb05_1hOddsAt(minute) : tm05_1hOddsAt(minute);
```
with:
```js
  const odds = isOver ? tb05_1hOddsAt(minute, match.odds) : tm05_1hOddsAt(minute, match.odds);
```

- [ ] **Step 2: Run the prompt tests**

Run: `node --test test/oneH_Prompt.test.js`
Expected: PASS (display odds now realistic; if a test asserts the old `2.60`/`2.10` string, update it to the new value e.g. `1.60`/`1.80`).

- [ ] **Step 3: Commit**

```bash
git add src/ai/prompts/oneH_Prompt.js test/oneH_Prompt.test.js
git commit -m "fix(1h-prompt): show realistic normative odds (match.odds aware)"
```

---

## Task 3: P1 — create signalConsensus.js (shared heuristic)

**Files:**
- Create: `src/prediction/signalConsensus.js`
- Test: `test/signalConsensus.test.js`

- [ ] **Step 1: Write the failing tests** — `test/signalConsensus.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateConsensus } = require('../src/prediction/signalConsensus');

test('under + high-weight goal-leaning signals → flip (Kuressaare)', () => {
  const r = evaluateConsensus({ direction: 'under', keySignals: [
    { signal: 'Kuressaare_defensive_issues', value: 'Пропустили в 5 з останніх 6 матчів', weight: 'high' },
    { signal: 'H2H_first_half_goals', value: 'Голи в першому таймі в 4 з останніх 5', weight: 'med' },
  ]});
  assert.equal(r.verdict, 'flip');
});

test('under + only med/low goal-leaning → skip (Akranes)', () => {
  const r = evaluateConsensus({ direction: 'under', keySignals: [
    { signal: 'low_xG', value: '0.41', weight: 'high' },
    { signal: 'recent_first_half_goals', value: 'frequent', weight: 'med' },
  ]});
  assert.equal(r.verdict, 'skip'); // low_xG is under-context; recent_first_half_goals only 'med'
});

test('over + dead-live (xG≈0/SoT0) → flip (France)', () => {
  const r = evaluateConsensus({ direction: 'over', keySignals: [
    { signal: 'shots_on_target', value: '0', weight: 'med' },
    { signal: 'xG', value: '0.06', weight: 'med' },
  ]});
  assert.equal(r.verdict, 'flip');
});

test('consistent signals → ok (no contradiction)', () => {
  const under = evaluateConsensus({ direction: 'under', keySignals: [
    { signal: 'low_first_half_goals', value: '0.8/0.8', weight: 'high' },
  ]});
  const over = evaluateConsensus({ direction: 'over', keySignals: [
    { signal: 'home_form', value: '69% перемог вдома', weight: 'high' },
    { signal: 'live_shots_on_target', value: '2', weight: 'low' },
  ]});
  assert.equal(under.verdict, 'ok');
  assert.equal(over.verdict, 'ok');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/signalConsensus.test.js`
Expected: FAIL ("Cannot find module '../src/prediction/signalConsensus'").

- [ ] **Step 3: Implement the module** — `src/prediction/signalConsensus.js`

```js
'use strict';

// Канонічний детектор протиріч "AI-сигнали ↔ напрям ставки" для 1H ТМ/ТБ.
// Спільне джерело правди: жива гілка (runOneH_AiDecision) і skill analyze-predictions.
// Евристика, не вирок: класифікує keySignals і повертає verdict для гейта.

const UNDER_CONTEXT = /\blow\b|low_|under|0:0|0_0|низьк|обережн|\bfew\b|рівн|солідн/i;
const GOAL_LEANING = /defensive_issues|пропустили|first_half_goals|frequent|часто|поспіль|streak|гола за гру|goals per game|7-0/i;
const DEAD_LIVE = /shots_on_target[=:\s]*0(\D|$)|\bsot[=:\s]*0(\D|$)|xg[=:\s]*0\.0[0-9]/i;

function isHigh(w) { return String(w).toLowerCase() === 'high'; }

// Goal-leaning: argues a goal is coming. Skip signals whose phrasing is
// under-context ("low_first_half_goals", "часто ... з низькою кількістю").
function goalLeaningSignals(keySignals = []) {
  return keySignals.filter((s) => {
    const t = `${s.signal} ${s.value}`;
    return !UNDER_CONTEXT.test(t) && GOAL_LEANING.test(t);
  });
}

// Dead-live: live in-play evidence of NO danger (0 shots on target, xG≈0).
function deadLiveSignals(keySignals = []) {
  return keySignals.filter((s) => DEAD_LIVE.test(`${s.signal} ${s.value}`));
}

/**
 * @param {{direction:'under'|'over', keySignals:Array}} args
 * @returns {{verdict:'ok'|'flip'|'skip', reason:string|null, signals:Array}}
 *  flip = confident contradiction (high-weight) → bet the complement
 *  skip = weak contradiction (med/low only) → no bet
 *  ok   = consistent
 */
function evaluateConsensus({ direction, keySignals = [] } = {}) {
  if (direction === 'under') {
    const goal = goalLeaningSignals(keySignals);
    if (!goal.length) return { verdict: 'ok', reason: null, signals: [] };
    const why = goal.map((s) => s.signal).join(', ');
    return goal.some((s) => isHigh(s.weight))
      ? { verdict: 'flip', reason: `goal-leaning high на under: ${why}`, signals: goal }
      : { verdict: 'skip', reason: `goal-leaning (слабке) на under: ${why}`, signals: goal };
  }
  if (direction === 'over') {
    const dead = deadLiveSignals(keySignals);
    if (!dead.length) return { verdict: 'ok', reason: null, signals: [] };
    // dead-live is strong live evidence → treat as confident → flip
    return { verdict: 'flip', reason: `dead-live на over: ${dead.map((s) => s.signal).join(', ')}`, signals: dead };
  }
  return { verdict: 'ok', reason: null, signals: [] };
}

module.exports = { evaluateConsensus, goalLeaningSignals, deadLiveSignals };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/signalConsensus.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/prediction/signalConsensus.js test/signalConsensus.test.js
git commit -m "feat(1h-consensus): shared signal↔direction contradiction detector"
```

---

## Task 4: P1+P2 — wire consensus gate + p-floor into runOneH_AiDecision

**Files:**
- Modify: `src/prediction/runOneH_AiDecision.js:9-11,99-106`
- Modify: `src/config/env.js` (new flags)
- Modify: `src/prediction/lockPolicy.js` (terminal phases)
- Test: `test/runOneH_AiDecision.test.js`

- [ ] **Step 1: Add config flags** — in `src/config/env.js`, in the LIVE_1H block, add:

```js
  LIVE_1H_MIN_P: floatEnv('LIVE_1H_MIN_P', 0.50),
  LIVE_1H_CONSENSUS_GATE: boolEnv('LIVE_1H_CONSENSUS_GATE', true),
```
(Use the file's existing env-parse helpers — match the names used by neighbouring `LIVE_1H_*` entries, e.g. `floatEnv`/`boolEnv`. Verify the helper names by reading the surrounding lines first.)

- [ ] **Step 2: Make the new skip/flip phases terminal** — in `src/prediction/lockPolicy.js`, add `'skipped_by_consensus'`, `'skipped_by_min_p'`, `'flipped_away'` to the set of locked/terminal phases (so a re-poll won't re-fire). Read the file first to match its structure (Set vs array).

- [ ] **Step 3: Write the failing wiring tests** — append to `test/runOneH_AiDecision.test.js` (reuse existing `CFG`, `fakeStore`, `mockAI`, `baseRecord` helpers at the top of that file)

```js
const test = require('node:test');
const assert = require('node:assert/strict');
// NOTE: file already imports runOneH_AiDecision, CFG, fakeStore, mockAI, baseRecord.

test('P1: under + high goal-leaning signals → flips to over, stored under tb05_1h', async () => {
  const store = fakeStore(baseRecord()); // baseRecord has no favorite → direction=under
  const ai = mockAI({ output: { p: 0.46, confidence: 0.6, reasoning: 'x', data_availability: 'partial',
    key_signals: [{ signal: 'both_defensive_issues', value: 'пропустили 5/6', weight: 'high' }] } });
  const res = await runOneH_AiDecision('m1', { observedMinute: 27 }, new Date(),
    { env: { ...CFG }, matchStore: store, callAI: ai });
  // p flips to 1-0.46=0.54 ≥ 0.50 → not skipped by floor; over EV evaluated
  assert.equal(res.direction, 'over');
  assert.equal(store.record.predictions.tm05_1h.phase, 'flipped_away');
  assert.ok(store.record.predictions.tb05_1h);
});

test('P2: under p<0.50 with no contradiction → skipped_by_min_p', async () => {
  const store = fakeStore(baseRecord());
  const ai = mockAI({ output: { p: 0.45, confidence: 0.6, reasoning: 'x', data_availability: 'partial',
    key_signals: [{ signal: 'low_first_half_goals', value: '0.7', weight: 'high' }] } });
  const res = await runOneH_AiDecision('m1', { observedMinute: 27 }, new Date(),
    { env: { ...CFG }, matchStore: store, callAI: ai });
  assert.equal(res.status, 'skipped_by_min_p');
});

test('P1: under + only med goal-leaning → skipped_by_consensus', async () => {
  const store = fakeStore(baseRecord());
  const ai = mockAI({ output: { p: 0.62, confidence: 0.6, reasoning: 'x', data_availability: 'partial',
    key_signals: [{ signal: 'recent_first_half_goals', value: 'frequent', weight: 'med' }] } });
  const res = await runOneH_AiDecision('m1', { observedMinute: 27 }, new Date(),
    { env: { ...CFG }, matchStore: store, callAI: ai });
  assert.equal(res.status, 'skipped_by_consensus');
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `node --test test/runOneH_AiDecision.test.js`
Expected: FAIL (no flip/skip behaviour yet).

- [ ] **Step 5: Implement the wiring** — `src/prediction/runOneH_AiDecision.js`

5a. Add the require at the top (near line 11):
```js
const { evaluateConsensus } = require('./signalConsensus');
```

5b. Replace the block at `src/prediction/runOneH_AiDecision.js:99-106` (from `const { p, confidence, ... } = aiResult.output;` through the `const gate = evaluateEvGate({ ... });` line) with:

```js
  const { p, confidence, reasoning, key_signals, data_availability } = aiResult.output;

  // P1 — consensus gate: flip-when-confident / skip-when-weak.
  // Directions are complementary (HT 0:0 vs ≥1 goal) → pComplement = 1 - p.
  let effDirection = direction;
  let effP = p;
  let consensus = null;
  if (cfg.LIVE_1H_CONSENSUS_GATE !== false) {
    consensus = evaluateConsensus({ direction, keySignals: key_signals });
    if (consensus.verdict === 'skip') {
      setDecision(matchId, {
        phase: 'skipped_by_consensus', direction, p, confidence,
        keySignals: key_signals, consensus, requestedAtMinute: minute,
        decidedAt: new Date().toISOString(),
      }, date);
      logger.info('runOneH_AiDecision: SKIP by consensus', { matchId, direction, reason: consensus.reason });
      return { status: 'skipped_by_consensus', direction };
    }
    if (consensus.verdict === 'flip') {
      effDirection = direction === 'over' ? 'under' : 'over';
      effP = +(1 - p).toFixed(4);
    }
  }

  // P2 — probability floor (after any flip). Never bet against our own probability.
  const minP = cfg.LIVE_1H_MIN_P ?? 0.50;
  if (effP < minP) {
    setDecision(matchId, {
      phase: 'skipped_by_min_p', direction: effDirection, p: effP, confidence,
      keySignals: key_signals, ...(consensus ? { consensus } : {}), requestedAtMinute: minute,
      decidedAt: new Date().toISOString(),
    }, date);
    logger.info('runOneH_AiDecision: SKIP by min_p', { matchId, direction: effDirection, p: effP, minP });
    return { status: 'skipped_by_min_p', direction: effDirection };
  }

  // Re-bind store target for the (possibly flipped) effective direction.
  const effStoreKey = effDirection === 'over' ? 'tb05_1h' : 'tm05_1h';
  const effSetDecision = effDirection === 'over'
    ? (id, payloadX, d) => store.setTb05_1hDecision(id, payloadX, d)
    : (id, payloadX, d) => store.setTm05_1hDecision(id, payloadX, d);
  if (effStoreKey !== storeKey) {
    // Close out the original pending key so it isn't left as ai_pending.
    setDecision(matchId, {
      phase: 'flipped_away', direction, flippedTo: effDirection,
      decidedAt: new Date().toISOString(),
    }, date);
  }

  const odds = effDirection === 'over' ? tb05_1hOddsAt(minute, match.odds) : tm05_1hOddsAt(minute, match.odds);
  const baseline = effDirection === 'over'
    ? (cfg.LIVE_1H_OVER_BASELINE_P ?? 0.40)
    : (cfg.LIVE_1H_UNDER_BASELINE_P ?? cfg.LIVE_1H_BASELINE_P ?? 0.42);

  const gate = evaluateEvGate({ probability: effP, confidence, odds, baseline });
```

5c. Downstream (the goal-during-decision block, payload, enqueue, return — `src/prediction/runOneH_AiDecision.js:117-191`), replace every use of `direction`→`effDirection`, `p`→`effP`, `storeKey`→`effStoreKey`, `setDecision(`→`effSetDecision(`. In the `payload` object add: `direction: effDirection, p: effP, ...(effDirection !== direction ? { flippedFrom: direction } : {}), ...(consensus ? { consensus } : {})`.

- [ ] **Step 6: Run to verify they pass**

Run: `node --test test/runOneH_AiDecision.test.js`
Expected: PASS (existing + 3 new). Fix any existing test that assumed the old odds/baseline path.

- [ ] **Step 7: Commit**

```bash
git add src/prediction/runOneH_AiDecision.js src/config/env.js src/prediction/lockPolicy.js test/runOneH_AiDecision.test.js
git commit -m "feat(1h-gate): consensus flip/skip + p>=0.50 floor on real odds"
```

---

## Task 5: P3 — prompt prioritises live evidence over history

**Files:**
- Modify: `src/ai/prompts/oneH_Prompt.js:33-37,66-70`
- Test: `test/oneH_Prompt.test.js`

- [ ] **Step 1: Write the failing test** — append to `test/oneH_Prompt.test.js`

```js
test('prompt instructs to trust live evidence over history on conflict', () => {
  const { buildOneHPrompt } = require('../src/ai/prompts/oneH_Prompt');
  const match = { homeTeam: 'A', awayTeam: 'B', league: 'L', country: 'C', odds: { home: 2, draw: 3, away: 4 } };
  const under = buildOneHPrompt(match, { observedMinute: 27, cumulative: {} }, 'under');
  const over  = buildOneHPrompt(match, { observedMinute: 27, cumulative: {} }, 'over');
  assert.match(under.system, /лайв/i);
  assert.match(under.system, /перевага|пріоритет|важлив/i);
  assert.match(over.system, /лайв/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/oneH_Prompt.test.js`
Expected: FAIL (no such instruction yet).

- [ ] **Step 3: Implement** — add one rule to BOTH `SYSTEM_UNDER` (after `src/ai/prompts/oneH_Prompt.js:36`) and `SYSTEM_OVER` (after `src/ai/prompts/oneH_Prompt.js:69`), inside the `ПРАВИЛА:` list:

```
- ПРІОРИТЕТ ЛАЙВУ: якщо жива статистика на момент рішення (xG, удари у площину, активність)
  суперечить історії (H2H, форма, мотивація) — більше довіряй ЛАЙВУ. При тихій грі (xG≈0,
  0 ударів у площину) знижуй p і confidence, навіть якщо історія обіцяє голи.
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/oneH_Prompt.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/prompts/oneH_Prompt.js test/oneH_Prompt.test.js
git commit -m "feat(1h-prompt): prioritise live in-play evidence over historical priors"
```

---

## Task 6: DRY — analyze-predictions skill reuses signalConsensus

**Files:**
- Modify: `.claude/skills/analyze-predictions/analyze.js`

- [ ] **Step 1: Replace the local heuristic with the shared module.** In `analyze.js`, delete the local `UNDER_CONTEXT`/`GOAL_LEANING`/`DEAD_LIVE` regexes and `classifyContradiction`, and require the canonical module:

```js
const { evaluateConsensus } = require('../../../src/prediction/signalConsensus');
```
Replace `classifyContradiction(pred)` calls with a thin adapter:
```js
function classifyContradiction(pred) {
  const v = evaluateConsensus({ direction: pred.direction, keySignals: pred.keySignals || [] });
  return { contradiction: v.verdict !== 'ok', why: v.reason };
}
```

- [ ] **Step 2: Verify the skill still reproduces 06-16** (regression)

Run: `node .claude/skills/analyze-predictions/analyze.js 2026-06-16`
Expected: contradiction block still flags Kuressaare / France / Akranes; "суперечать сигналам: 0/3".

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/analyze-predictions/analyze.js
git commit -m "refactor(analyze): reuse src/prediction/signalConsensus (single source of truth)"
```

---

## Task 7: Verification (per user requirement — after green)

- [ ] **Step 1: Full suite green**

Run: `npm test`
Expected: all `test/*.test.js` pass.

- [ ] **Step 2: Regression via skill on real odds**

Run: `node .claude/skills/analyze-predictions/analyze.js 2026-06-16`
Sanity: with real odds the line summary is ТМ −32.9% / ТБ +20% / overall −17%; the consensus block flags exactly the 3 losers. (The skill scores history; it does not re-run the live engine. Confirms the heuristic still matches.)

- [ ] **Step 3: Code review** — REQUIRED SUB-SKILL: Use `superpowers:requesting-code-review`. Scope: P0–P3 diff vs this plan + the spec. Confirm tests cover each P, no regressions.

- [ ] **Step 4: Business-logic review** — a focused pass (dispatch a reviewer or do it explicitly) verifying betting correctness:
  - EV math unchanged in `evGate.js`; odds now realistic and passed for the EFFECTIVE direction.
  - `pComplement = 1 - p` is correct (HT 0:0 vs ≥1 goal are complementary).
  - Flip path stores under the flipped key and closes the original pending (`flipped_away`); no double signal.
  - ТБ odds increase with minute; ТМ odds bucket by draw; both return null past 35'.
  - Gate order: favorite-route → AI → consensus(flip/skip) → p-floor → EV → confirm/goal-race.
  - Spot-check on 06-16: Kuressaare flips to over p=0.55 then EV on real ~1.8 → confirm bet/skip is sane; France flips to under p=0.35 → killed by p-floor (skip).

---

## Self-Review (done at plan time)

- **Spec coverage:** P0 (Task 1–2), P1 (Task 3–4), P2 (Task 4), P3 (Task 5), DRY/shared module (Task 3+6), verification incl. code-review + business-logic review (Task 7). Deferred P4/P5/bookmaker-API explicitly out of scope. ✅
- **Deviation logged:** `LIVE_1H_REAL_ODDS` flag dropped (YAGNI) — noted above; spec to be updated when executing.
- **Type/name consistency:** `evaluateConsensus({direction, keySignals})` used identically in module, tests, runOneH, and analyze adapter; `effDirection/effP/effStoreKey/effSetDecision` introduced together in Task 4. ✅
- **Open risk:** env-helper names (`floatEnv`/`boolEnv`) and `lockPolicy.js` structure are assumed — Task 4 Steps 1–2 say to read-and-match before editing.
