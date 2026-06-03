# WS-3 — Data Hygiene + Manual Analysis Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead v4.0 code and tracked junk, harden `.gitignore`, and add a `matchDigest.js` CLI that emits a compact human-readable per-minute view of tracked matches for manual analysis instead of reading multi-MB JSON.

**Architecture:** Pure cleanup + one read-only reporting script. No changes to the live pipeline. Fully independent of WS-1 and WS-2 — safe to run in parallel.

**Tech Stack:** Node.js, `node:test`, git.

**Execution order:** Independent — run any time, parallel-safe.

---

### Task 1: Remove dead v4.0 code

**Files:**
- Delete: `src/pipeline/aiDryGoalExpert.js` (untracked; imports non-existent `helpers/constants`)
- Delete: `test/aiGate.test.js` (untracked; tests the dead module)
- Delete: `src/pipeline/` dir if empty afterward

- [ ] **Step 1: Confirm nothing live imports the dead module**

Run: `grep -rn "aiDryGoalExpert\|applyLiveAiGate" src/ scripts/ | grep -v "src/pipeline/aiDryGoalExpert.js"`
Expected: no output (only the file itself referenced it).

- [ ] **Step 2: Delete the files**

```bash
rm -f src/pipeline/aiDryGoalExpert.js test/aiGate.test.js
rmdir src/pipeline 2>/dev/null || true
```

- [ ] **Step 3: Verify suite still green**

Run: `node --test test/*.test.js`
Expected: PASS (no reference to removed test).

- [ ] **Step 4: Commit**

```bash
git add -A src/pipeline test/aiGate.test.js
git commit -m "chore: remove dead v4.0 aiDryGoalExpert + orphaned aiGate test"
```

---

### Task 2: Untrack `.DS_Store`, drop stray files, harden .gitignore

**Files:**
- Modify: `.gitignore`
- Untrack: `.DS_Store`, `data/logs/.DS_Store`
- Delete: `data/logs/2026-05-11/matches copy.json`, `logs/` (untracked stray)

- [ ] **Step 1: Append ignore rules**

Add to `.gitignore`:
```
# OS / editor junk
.DS_Store
**/.DS_Store

# stray local scratch
logs/
**/*\ copy.json
```

- [ ] **Step 2: Untrack committed .DS_Store + remove strays**

```bash
git rm --cached .DS_Store data/logs/.DS_Store
rm -f ".DS_Store" "data/logs/.DS_Store"
rm -f "data/logs/2026-05-11/matches copy.json"
rm -rf logs
```

- [ ] **Step 3: Verify clean status**

Run: `git status --short`
Expected: `.gitignore` modified, two `.DS_Store` deletions staged, no stray `logs/`
or `matches copy.json` listed.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: untrack .DS_Store, ignore OS junk and scratch dirs"
```

**Note (decision deferred to user):** `data/logs/*` is currently tracked (historical
match data, needed by the WS-1 replay harness). This plan does NOT untrack it — keeping
history available for backtest. If the user later wants the repo slim, untracking
`data/logs/` (while keeping files on disk) is a separate follow-up.

---

### Task 3: matchDigest.js — readable per-minute analysis view

**Files:**
- Create: `scripts/matchDigest.js`
- Test: `test/matchDigest.test.js`

Emits, per selected match: header (teams/league/odds), a per-minute table
(min | score | xG h+a | SoT h+a | TouchBox h+a | Big h+a | Y/R | poss), the final
result, and each track's decision (phase, p, confidence, ev). Filters:
`--track tm05|tb05`, `--outcome hit|miss`, `--league <substr>`.

- [ ] **Step 1: Write failing test for the pure formatting function**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { digestMatch, matchOutcome } = require('../scripts/matchDigest');

const m = {
  homeTeam: 'A', awayTeam: 'B', league: 'L', country: 'C',
  odds: { home: 1.8, draw: 3.4, away: 4.0 },
  final: { scoreHome: 0, scoreAway: 0 },
  snapshots: [
    { observedMinute: 60, scoreHome: 0, scoreAway: 0,
      cumulative: { expectedGoalsXg: { home: 0.3, away: 0.2 }, shotsOnTarget: { home: 2, away: 1 } },
      ballPossession: { home: 55, away: 45 } },
  ],
  predictions: { tm05: { phase: 'signal', pNoGoal: 0.6, confidence: 0.7, evGate: { ev: 1.2 } }, tb05: null },
};

test('matchOutcome: tm05 0:0 final = hit', () => {
  assert.equal(matchOutcome(m, 'tm05'), 'hit');
});

test('digestMatch renders teams and a minute row', () => {
  const out = digestMatch(m);
  assert.match(out, /A vs B/);
  assert.match(out, /60/);
  assert.match(out, /signal/);
});
```

- [ ] **Step 2: Run → fail**

Run: `node --test test/matchDigest.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.resolve(__dirname, '../data/logs');

function sum(pair) {
  if (!pair) return '·';
  return ((pair.home || 0) + (pair.away || 0));
}

function totalGoals(final) {
  if (!final) return null;
  return (final.scoreHome || 0) + (final.scoreAway || 0);
}

// 'hit' | 'miss' | null  for a given track based on final result.
function matchOutcome(m, track) {
  const g = totalGoals(m.final);
  if (g == null) return null;
  if (track === 'tm05') return g === 0 ? 'hit' : 'miss';
  if (track === 'tb05') return g >= 1 ? 'hit' : 'miss';
  return null;
}

function digestMatch(m) {
  const lines = [];
  lines.push(`━━ ${m.homeTeam} vs ${m.awayTeam}  [${m.league} / ${m.country}]`);
  if (m.odds) lines.push(`   1X2: ${m.odds.home}/${m.odds.draw}/${m.odds.away}`);
  lines.push('   min | score | xG | SoT | Touch | Big | Y/R | poss');
  for (const s of (m.snapshots || [])) {
    const c = s.cumulative || {};
    const y = sum(c.yellowCards); const r = sum(c.redCards);
    const poss = s.ballPossession ? `${s.ballPossession.home}-${s.ballPossession.away}` : '·';
    lines.push(`   ${String(s.observedMinute ?? s.minute).padStart(3)} | `
      + `${s.scoreHome}:${s.scoreAway}   | ${sum(c.expectedGoalsXg)} | ${sum(c.shotsOnTarget)} | `
      + `${sum(c.touchesInOppositionBox)} | ${sum(c.bigChances)} | ${y}/${r} | ${poss}`);
  }
  if (m.final) lines.push(`   FINAL: ${m.final.scoreHome}:${m.final.scoreAway}`);
  for (const track of ['tm05', 'tb05']) {
    const p = m.predictions?.[track];
    if (!p) continue;
    const prob = p.pNoGoal ?? p.pGoal;
    lines.push(`   ${track}: phase=${p.phase} p=${prob ?? '·'} conf=${p.confidence ?? '·'} `
      + `ev=${p.evGate?.ev ?? '·'} → ${matchOutcome(m, track) ?? '?'}`);
  }
  return lines.join('\n');
}

function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--track') f.track = argv[++i];
    else if (argv[i] === '--outcome') f.outcome = argv[++i];
    else if (argv[i] === '--league') f.league = argv[++i];
    else if (!f.date) f.date = argv[i];
  }
  return f;
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  if (!f.date) { console.error('usage: matchDigest <YYYY-MM-DD> [--track tm05|tb05] [--outcome hit|miss] [--league <substr>]'); process.exit(1); }
  const file = path.join(DATA_ROOT, f.date, 'matches.json');
  if (!fs.existsSync(file)) { console.error(`no matches.json for ${f.date}`); process.exit(1); }
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  let matches = Object.values(store);
  if (f.league) matches = matches.filter(m => (m.league || '').toLowerCase().includes(f.league.toLowerCase()));
  if (f.track) matches = matches.filter(m => m.predictions?.[f.track]);
  if (f.outcome && f.track) matches = matches.filter(m => matchOutcome(m, f.track) === f.outcome);
  for (const m of matches) console.log(digestMatch(m) + '\n');
  console.log(`── ${matches.length} match(es) ──`);
}

if (require.main === module) main();

module.exports = { digestMatch, matchOutcome };
```

- [ ] **Step 4: Run test + smoke-run**

Run: `node --test test/matchDigest.test.js`
Expected: PASS (2 tests)
Run: `node scripts/matchDigest.js 2026-05-13 --track tm05`
Expected: readable per-minute digests for tm05 matches on that day.

- [ ] **Step 5: Commit**

```bash
git add scripts/matchDigest.js test/matchDigest.test.js
git commit -m "feat(scripts): matchDigest readable per-minute analysis view"
```

---

## Self-review notes
- Spec WS-3 "git cleanup" → Task 2. "dead code" → Task 1. "analysis digest" → Task 3.
- `matchOutcome`/`digestMatch` names consistent between test and impl.
- Decision on untracking `data/logs/*` explicitly deferred to user (Task 2 note) to
  avoid destroying backtest history WS-1 depends on.
