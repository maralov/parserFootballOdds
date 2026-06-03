# WS-2 — Storage Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `matches.json` from ~11.7 MB/day to ~3-4 MB/day by dropping derived snapshot fields (computed on read) and removing static enrichment duplication (lazy-loaded from `enrichment.json`), and make writes O(1) via debounce.

**Architecture:** Snapshots store only `cumulative`; `since2H`/`delta` are recomputed at read time via `hydrateSnapshot`. Static enrichment (`statistics`, `enrichmentTabs`, `h2h`, `standings`) is removed from the match record and fetched lazily from `enrichmentStore` when building prompts, fail-soft.

**Tech Stack:** Node.js, `node:test`, existing `matchStore`, `enrichmentStore`, `deltaCalculator`.

**Execution order:** Land BEFORE WS-1 Task 6 if possible (scorers will read hydrated snapshots). Independent of WS-3.

---

### Task 1: hydrateSnapshot — recompute since2H/delta on read

**Files:**
- Create: `src/tracker/snapshotHydrator.js`
- Test: `test/snapshotHydrator.test.js`

- [ ] **Step 1: Write failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hydrateSnapshot, hydrateAll } = require('../src/tracker/snapshotHydrator');

const baseline1H = { expectedGoalsXg: { home: 0.2, away: 0.1 } };
const prev = { cumulative: { expectedGoalsXg: { home: 0.3, away: 0.2 } } };
const cur  = { cumulative: { expectedGoalsXg: { home: 0.5, away: 0.4 } } };

test('hydrateSnapshot computes since2H = cumulative - baseline1H', () => {
  const h = hydrateSnapshot(cur, baseline1H, prev);
  assert.equal(h.since2H.expectedGoalsXg.home, 0.3); // 0.5-0.2
  assert.equal(h.since2H.expectedGoalsXg.away, 0.3); // 0.4-0.1
});

test('hydrateSnapshot computes delta = cumulative - prev', () => {
  const h = hydrateSnapshot(cur, baseline1H, prev);
  assert.ok(Math.abs(h.delta.expectedGoalsXg.home - 0.2) < 1e-9); // 0.5-0.3
});

test('hydrateSnapshot with no prev → delta null', () => {
  const h = hydrateSnapshot(cur, baseline1H, null);
  assert.equal(h.delta, null);
});

test('hydrateAll chains prev correctly', () => {
  const out = hydrateAll([prev, cur], baseline1H);
  assert.equal(out[0].delta, null);
  assert.ok(out[1].delta.expectedGoalsXg.home != null);
});
```

- [ ] **Step 2: Run → fail**

Run: `node --test test/snapshotHydrator.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';
const { subtractStats } = require('./deltaCalculator');

// Returns a shallow clone of `snap` with since2H/delta filled from cumulative.
function hydrateSnapshot(snap, baseline1H, prevSnap) {
  if (!snap) return snap;
  const cumulative = snap.cumulative || null;
  const since2H = cumulative && baseline1H ? subtractStats(cumulative, baseline1H) : null;
  const delta = cumulative && prevSnap?.cumulative
    ? subtractStats(cumulative, prevSnap.cumulative) : null;
  return { ...snap, since2H, delta };
}

function hydrateAll(snapshots, baseline1H) {
  const out = [];
  let prev = null;
  for (const s of snapshots || []) {
    const h = hydrateSnapshot(s, baseline1H, prev);
    out.push(h);
    prev = s;
  }
  return out;
}

module.exports = { hydrateSnapshot, hydrateAll };
```

- [ ] **Step 4: Run → pass**

Run: `node --test test/snapshotHydrator.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tracker/snapshotHydrator.js test/snapshotHydrator.test.js
git commit -m "feat(store): snapshotHydrator recomputes since2H/delta on read"
```

---

### Task 2: matchStore hydrated read accessors

**Files:**
- Modify: `src/store/matchStore.js` (add `getHydratedSnapshots`, `getLastHydratedSnapshot`)
- Test: `test/matchStoreHydration.test.js`

- [ ] **Step 1: Write failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const matchStore = require('../src/store/matchStore');

function d(label){ return new Date(`2099-11-${label}T12:00:00.000Z`); }

test('getHydratedSnapshots fills since2H/delta from raw cumulative', () => {
  const date = d('01');
  matchStore.writeStore({ m: {
    matchId: 'm',
    baseline1H: { expectedGoalsXg: { home: 0.1, away: 0.0 } },
    snapshots: [
      { observedMinute: 50, cumulative: { expectedGoalsXg: { home: 0.2, away: 0.1 } } },
      { observedMinute: 60, cumulative: { expectedGoalsXg: { home: 0.5, away: 0.2 } } },
    ],
  }}, date);

  const h = matchStore.getHydratedSnapshots('m', date);
  assert.equal(h[0].delta, null);
  assert.ok(Math.abs(h[1].delta.expectedGoalsXg.home - 0.3) < 1e-9);
  assert.ok(Math.abs(h[1].since2H.expectedGoalsXg.home - 0.4) < 1e-9);
  fs.rmSync(matchStore.dayLogsAbsolute(date), { recursive: true, force: true });
});
```

- [ ] **Step 2: Run → fail**

Run: `node --test test/matchStoreHydration.test.js`
Expected: FAIL — `getHydratedSnapshots is not a function`.

- [ ] **Step 3: Implement in matchStore.js**

Add require at top: `const { hydrateAll } = require('../tracker/snapshotHydrator');`
Add functions before `module.exports` and export them:
```js
function getHydratedSnapshots(matchId, date = new Date()) {
  const match = getMatch(matchId, date);
  if (!match) return [];
  return hydrateAll(match.snapshots || [], match.baseline1H);
}

function getLastHydratedSnapshot(matchId, date = new Date()) {
  const h = getHydratedSnapshots(matchId, date);
  return h.length ? h[h.length - 1] : null;
}
```
Add to `module.exports`: `getHydratedSnapshots, getLastHydratedSnapshot,`.

- [ ] **Step 4: Run → pass + full suite**

Run: `node --test test/matchStoreHydration.test.js test/matchStore.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/matchStore.js test/matchStoreHydration.test.js
git commit -m "feat(store): getHydratedSnapshots/getLastHydratedSnapshot read accessors"
```

---

### Task 3: Stop persisting since2H/delta; migrate readers to hydrated

**Files:**
- Modify: `src/tracker/snapshotCollector.js:106-152` (drop since2H/delta from stored snapshot)
- Modify: `src/prediction/runTm05Decision.js:38-44` (use hydrated snapshots for DS)
- Modify: `src/prediction/runTb05Decision.js:53-56` (use hydrated for PS)
- Modify: `src/ai/prompts/tm05Prompt.js`, `tb05Prompt.js` (receive hydrated snapshots)

The scorers (`computeDS`, `computePS`) read `snapshot.delta`/`snapshot.since2H`.
After this task those fields exist only on hydrated snapshots, so the decision
runners must hydrate before scoring.

- [ ] **Step 1: Drop derived from stored snapshot (snapshotCollector.js)**

Remove `since2H` and `delta` computation + their keys from the `snapshot` object.
Keep `cumulative`. The block that builds `snapshot` becomes:
```js
  const snapshot = {
    minute: snapshotMinute,
    observedMinute: minute,
    capturedAt,
    statusText,
    scoreHome,
    scoreAway,
    ballPossession,
    cumulative: cumulativeMap,
  };
```
(Delete the `since2H`/`delta`/`lastSnapshot` lines that fed them.)

- [ ] **Step 2: Hydrate in runTm05Decision.js**

Replace the snapshot-prep block with hydrated reads:
```js
  const hydrated = store.getHydratedSnapshots(matchId, date);
  const snap60 = hydrated.find(s => s.observedMinute === (snapshot60.observedMinute))
    || hydrateOne(snapshot60, match); // see helper note
  const snapshotsBefore60 = hydrated.filter(s => (s.observedMinute || 0) < 60);
  const ds = computeDS(match, snap60);
```
Where `snap60` must be the hydrated form of the trigger snapshot. Simplest: derive
from `hydrated` by matching `capturedAt`:
```js
  const snap60 = hydrated.find(s => s.capturedAt === snapshot60.capturedAt) || snapshot60;
```
(`snapshot60` passed in is the raw just-appended one; it is already in `hydrated`.)

- [ ] **Step 3: Hydrate in runTb05Decision.js**

```js
  const hydrated = store.getHydratedSnapshots(matchId, date);
  const snap80 = hydrated.find(s => s.capturedAt === snapshot80.capturedAt) || snapshot80;
  const snap60 = findSnapshotByMinute(hydrated, 60);
  const ps = computePS(match, snap80, snap60);
```
Pass `hydrated` (not raw) into `buildTb05Prompt`.

- [ ] **Step 4: Prompts already read cumulative/since2H from snapshot objects**

`buildTm05Prompt`/`buildTb05Prompt` consume `s.cumulative` and (TB) `s.since2H`.
Ensure the decision runners pass the hydrated arrays. No prompt code change needed
beyond receiving hydrated arrays from Steps 2-3.

- [ ] **Step 5: Regression — hydrated output matches old stored values**

Create `test/hydrationRegression.test.js` that loads a pre-change sample and
asserts hydrated since2H/delta equals the previously-stored values:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hydrateAll } = require('../src/tracker/snapshotHydrator');

// Hand-built fixture mirroring real shape (avoids depending on git-removed data).
const baseline1H = { shotsOnTarget: { home: 1, away: 0 } };
const raw = [
  { observedMinute: 50, cumulative: { shotsOnTarget: { home: 2, away: 1 } } },
  { observedMinute: 60, cumulative: { shotsOnTarget: { home: 4, away: 2 } } },
];
// Expected matches old subtractStats semantics.
test('hydrated since2H/delta match subtractStats semantics', () => {
  const h = hydrateAll(raw, baseline1H);
  assert.equal(h[1].since2H.shotsOnTarget.home, 3); // 4-1
  assert.equal(h[1].delta.shotsOnTarget.home, 2);   // 4-2
});
```

- [ ] **Step 6: Run suite + commit**

Run: `node --test test/*.test.js`
Expected: PASS

```bash
git add src/tracker/snapshotCollector.js src/prediction/runTm05Decision.js src/prediction/runTb05Decision.js test/hydrationRegression.test.js
git commit -m "feat(store): stop persisting since2H/delta; hydrate on read"
```

---

### Task 4: enrichmentStore getter + lazy static load

**Files:**
- Modify: `src/store/enrichmentStore.js` (add `getEnrichment`)
- Test: `test/enrichmentStoreGet.test.js`

- [ ] **Step 1: Write failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const enrichmentStore = require('../src/store/enrichmentStore');

function d(label){ return new Date(`2099-10-${label}T12:00:00.000Z`); }

test('getEnrichment returns item by matchId or null', () => {
  const date = d('01');
  enrichmentStore.saveEnrichment([{ matchId: 'x', status: 'enriched', h2h: [1] }], date);
  assert.equal(enrichmentStore.getEnrichment('x', date).h2h.length, 1);
  assert.equal(enrichmentStore.getEnrichment('nope', date), null);
});
```

- [ ] **Step 2: Run → fail**

Run: `node --test test/enrichmentStoreGet.test.js`
Expected: FAIL — `getEnrichment is not a function`.

- [ ] **Step 3: Implement**

```js
function getEnrichment(matchId, date = new Date()) {
  const store = readEnrichmentStore(date);
  return store[matchId] || null;
}
```
Add `getEnrichment` to `module.exports`.

- [ ] **Step 4: Run → pass**

Run: `node --test test/enrichmentStoreGet.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/enrichmentStore.js test/enrichmentStoreGet.test.js
git commit -m "feat(store): enrichmentStore.getEnrichment(matchId, date)"
```

---

### Task 5: Drop static fields from match-record; lazy-load in decisions

**Files:**
- Modify: `src/store/matchStore.js:182-217` (upsertFromEnrichment — drop static fields)
- Modify: `src/prediction/runTm05Decision.js`, `runTb05Decision.js` (load static for prompt)

- [ ] **Step 1: Remove static duplication from record (matchStore.js)**

In `upsertFromEnrichment`, drop `statistics`, `enrichmentTabs`, `h2h`, `standings`
from the persisted `record`. **Keep** `baseline1H` (derived, needed by scorers) and
`odds` (small, used by PS). The record's static identity stays via `matchId`.

- [ ] **Step 2: Lazy-load static context for prompts**

In each decision runner, before `buildTm05Prompt`/`buildTb05Prompt`, hydrate a
prompt-context object from enrichmentStore (fail-soft):
```js
  const enrichment = require('../store/enrichmentStore').getEnrichment(matchId, date) || {};
  const promptMatch = { ...match,
    standings: enrichment.standings || null,
    h2h: enrichment.h2h || null,
    statistics: enrichment.statistics || null };
```
Pass `promptMatch` (not `match`) into the prompt builder. If enrichment missing,
prompt builds without standings/h2h (web_search compensates).

- [ ] **Step 3: Verify prompt builders tolerate null static**

`buildTm05Prompt` already uses `match.standings || {}` and `safe(...)` — null-safe.
Confirm no direct deref of `match.statistics.x` without guard (grep):
Run: `grep -n "statistics\." src/ai/prompts/*.js`
Expected: no unguarded access (fix any found by adding `?.`).

- [ ] **Step 4: Smoke test storage size**

Run a single tracked match cycle in a scratch test or inspect a fresh write; assert
record has no `statistics`/`h2h` keys:
```js
// test/recordSlimness.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const matchStore = require('../src/store/matchStore');
function d(l){ return new Date(`2099-09-${l}T12:00:00.000Z`); }
test('upsertFromEnrichment record omits heavy static fields', () => {
  const date = d('01');
  const rec = matchStore.upsertFromEnrichment({ matchId: 'm', statistics: { '1half': { home:{}, away:{} } }, h2h: [1,2], standings: {x:1} }, date);
  assert.equal(rec.h2h, undefined);
  assert.equal(rec.statistics, undefined);
  assert.equal(rec.standings, undefined);
  assert.ok(rec.baseline1H !== undefined);
  fs.rmSync(matchStore.dayLogsAbsolute(date), { recursive: true, force: true });
});
```
Run: `node --test test/recordSlimness.test.js`
Expected: PASS

- [ ] **Step 5: Run full suite + commit**

Run: `node --test test/*.test.js`
Expected: PASS

```bash
git add src/store/matchStore.js src/prediction/runTm05Decision.js src/prediction/runTb05Decision.js test/recordSlimness.test.js
git commit -m "feat(store): drop static enrichment from match record, lazy-load for prompts"
```

---

### Task 6: Enable debounced writes by default

**Files:**
- Modify: `src/store/matchStore.js:11`

- [ ] **Step 1: Default debounce to 2500ms**

Change:
```js
const DEBOUNCE_MS = Math.max(0, Number(process.env.MATCHSTORE_DEBOUNCE_MS) || 2500);
```
(`flushSync` on finalize + `process.on('exit')` flushAll already guarantee durability.)

- [ ] **Step 2: Verify existing debounce/flush tests still pass**

Run: `node --test test/matchStore.test.js`
Expected: PASS (atomic write + flush tests unaffected; they call writeStore then read
after flushSync paths — if any test reads immediately after writeStore without flush,
it relies on the cache, which `readStore` serves. Confirm green; if a test reads from
disk immediately, add `matchStore.flushSync(date)` in that test.)

- [ ] **Step 3: Commit**

```bash
git add src/store/matchStore.js
git commit -m "perf(store): debounce matches.json writes (2.5s) by default"
```

---

## Self-review notes
- Spec WS-2 "drop derived" → Tasks 1,2,3. "split static" → Tasks 4,5. "write-path" → Task 6.
- `getHydratedSnapshots` name used consistently across Tasks 2,3.
- Risk: WS-1 Task 6 scoring reads `since2H` — depends on this WS landing first OR on
  decision runners hydrating (Task 3). Document the ordering at top of both plans.
