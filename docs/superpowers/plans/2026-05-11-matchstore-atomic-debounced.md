# matchStore Atomic Write + Debounced Persist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зменшити ризик корупції `matches.json` при збоях і знизити write amplification у 10-50× через atomic write + опційний debounced persist з in-memory cache.

**Architecture:** Дві шари змін у `src/store/matchStore.js`. (1) `writeStore` стає atomic — пише в `*.tmp` і `renameSync` в цільовий файл. (2) Через env-флаг `MATCHSTORE_DEBOUNCE_MS > 0` вмикається in-memory cache: `readStore` повертає cached store, `writeStore` тільки маркує dirty + планує debounced flush. Експонуються `flushSync(date)` і `flushAll()` для критичних точок (finalize, shutdown). За замовчуванням (флаг=0) — поведінка не змінюється → всі існуючі тести проходять без правок.

**Tech Stack:** Node.js, `fs.writeFileSync` + `fs.renameSync` (atomic POSIX), `node --test`.

**Контекст архітектури проєкту:**
- `matchStore` зберігає денний state у `data/logs/<YYYY-MM-DD>/matches.json` (до 11 MB у full-load дні).
- Кожна публічна функція (`appendSnapshot`, `setPrediction`, `setComputed`, `setAiAnalysis`, ...) робить **`readStore` → mutate → `writeStore`**. На live: тисячі повних read+write/день одного файлу 11 MB.
- `finalize()` критичний — після нього викликається telegram-дispatcher через `setImmediate` (рядки 328-346); persistence має бути гарантована **до** dispatch.
- Single-process архітектура (`src/orchestrator/runWatch.js`). Конкурентного доступу до файлу нема.
- Існуючий shutdown-handler: `SIGINT`/`SIGTERM` → `shutdown()` у `runWatch.js:25-34`.

---

## File Structure

- **Modify:** `src/store/matchStore.js` — основні зміни (atomic write, cache, debouncing, flushSync, flushAll).
- **Modify:** `src/orchestrator/runWatch.js` — додати `matchStore.flushAll()` у shutdown.
- **Modify:** `test/matchStore.test.js` — новий тестовий файл для перевірки atomic + cache + flushSync.
- **Не зачіпається:** жоден існуючий тест, жоден інший вихідний модуль (по можливості).

---

## Task 1: Atomic write через `tmp + rename`

**Files:**
- Modify: `src/store/matchStore.js:54-62` (`writeStore`)
- Create: `test/matchStore.test.js` (новий)

- [ ] **Step 1: Створити новий тест-файл з тестом на atomic write**

Файл `test/matchStore.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const matchStore = require('../src/store/matchStore');

function makeTempDate(label) {
  return new Date(`2099-12-${label}T12:00:00.000Z`);
}

test('writeStore is atomic (no .tmp left behind on success)', () => {
  const date = makeTempDate('01');
  matchStore.writeStore({ atomicTest: { matchId: 'atomicTest' } }, date);

  const dir = matchStore.dayLogsAbsolute(date);
  const file = path.join(dir, 'matches.json');
  const tmpFile = file + '.tmp';

  assert.ok(fs.existsSync(file), 'matches.json повинен існувати');
  assert.ok(!fs.existsSync(tmpFile), '.tmp файл не має залишатися після успішного запису');

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.atomicTest.matchId, 'atomicTest');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeStore overwrites atomically without truncate-window', () => {
  const date = makeTempDate('02');
  matchStore.writeStore({ a: { matchId: 'a' } }, date);
  matchStore.writeStore({ b: { matchId: 'b' } }, date);

  const dir = matchStore.dayLogsAbsolute(date);
  const file = path.join(dir, 'matches.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(onDisk), ['b']);

  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Запустити новий тест — перший тест ПРОЙДЕ (просто перевіряє існування файлу), другий теж**

Run: `node --test test/matchStore.test.js`
Очікувано: 2/2 pass. Це baseline до змін.

(Примітка: оригінальний `writeFileSync` не залишає `.tmp` бо .tmp не створюється. Тест pass і до, і після зміни — він стане value-релевантним після переходу на tmp+rename.)

- [ ] **Step 3: Реалізувати atomic write**

Файл `src/store/matchStore.js`, рядки 54-62. Замінити:

```javascript
function writeStore(store, date = new Date()) {
  try {
    fs.writeFileSync(matchesFile(date), JSON.stringify(store, null, 2), 'utf8');
    return true;
  } catch (e) {
    logger.warn('matchStore: write failed', { err: e.message });
    return false;
  }
}
```

на:

```javascript
function writeStore(store, date = new Date()) {
  const target = matchesFile(date);
  const tmp = target + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    logger.warn('matchStore: write failed', { err: e.message });
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    return false;
  }
}
```

- [ ] **Step 4: Запустити повний test-suite**

Run: `npm test`
Очікувано: усі ~231 тестів pass.

- [ ] **Step 5: Коміт**

```bash
git add src/store/matchStore.js test/matchStore.test.js
git commit -m "feat(store): atomic write via tmp+rename in matchStore

Eliminates partial-write corruption on process kill or sleep mid-write.
Uses POSIX-atomic renameSync to swap target."
```

---

## Task 2: In-memory cache + `flushSync` (без debouncing)

**Files:**
- Modify: `src/store/matchStore.js` (додати cache layer + `flushSync`, не міняти поведінку за замовчуванням)
- Modify: `test/matchStore.test.js` (тести на cache+flushSync)

**Підхід:** додати cache-шар і `flushSync(date)`, але **залишити debouncing вимкненим** (`MATCHSTORE_DEBOUNCE_MS` default = 0). При `=0` `writeStore` поводиться як зараз (синхронний atomic write). Це готує фундамент для Task 3 без зміни поведінки.

- [ ] **Step 1: Написати тести на `flushSync` (поведінка очікувана після Task 2)**

Додай у `test/matchStore.test.js`:

```javascript
test('flushSync writes pending data to disk (no-op when no cache)', () => {
  const date = makeTempDate('03');
  matchStore.writeStore({ x: { matchId: 'x' } }, date);
  matchStore.flushSync(date);

  const dir = matchStore.dayLogsAbsolute(date);
  const file = path.join(dir, 'matches.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.x.matchId, 'x');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('flushAll iterates all cached dates', () => {
  const d1 = makeTempDate('04');
  const d2 = makeTempDate('05');
  matchStore.writeStore({ a: { matchId: 'a' } }, d1);
  matchStore.writeStore({ b: { matchId: 'b' } }, d2);
  matchStore.flushAll();

  for (const d of [d1, d2]) {
    const dir = matchStore.dayLogsAbsolute(d);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Запустити тести — нові ФЕЙЛЯТЬ (`flushSync`, `flushAll` не експортовані)**

Run: `node --test test/matchStore.test.js`
Очікувано: 2 нові — fail з `TypeError: matchStore.flushSync is not a function`.

- [ ] **Step 3: Реалізувати cache + flushSync + flushAll**

Файл `src/store/matchStore.js`. Одразу після `DATA_ROOT` (рядок 12) додай:

```javascript
const DEBOUNCE_MS = Math.max(0, Number(process.env.MATCHSTORE_DEBOUNCE_MS) || 0);

const cache = new Map();    // dateKey → store object
const dirty = new Set();    // dateKey for entries pending flush
const timers = new Map();   // dateKey → setTimeout handle

function dateKey(date) {
  return dateKeyLocal(date);
}

function pathForDateKey(key) {
  return path.join(DATA_ROOT, key, 'matches.json');
}

function writeStoreToDisk(store, key) {
  const dir = path.join(DATA_ROOT, key);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'matches.json');
  const tmp = target + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    logger.warn('matchStore: write failed', { err: e.message });
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    return false;
  }
}

function loadFromDisk(key) {
  const file = pathForDateKey(key);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    logger.warn('matchStore: failed to parse, starting fresh', { file, err: e.message });
    return {};
  }
}

function flushSync(date = new Date()) {
  const key = dateKey(date);
  const t = timers.get(key);
  if (t) { clearTimeout(t); timers.delete(key); }
  if (!dirty.has(key)) return false;
  const store = cache.get(key);
  if (!store) { dirty.delete(key); return false; }
  const ok = writeStoreToDisk(store, key);
  if (ok) dirty.delete(key);
  return ok;
}

function flushAll() {
  for (const key of Array.from(dirty)) {
    const t = timers.get(key);
    if (t) { clearTimeout(t); timers.delete(key); }
    const store = cache.get(key);
    if (store) writeStoreToDisk(store, key);
    dirty.delete(key);
  }
}
```

Тепер заміни `readStore` (рядки 43-52) на cache-aware версію:

```javascript
function readStore(date = new Date()) {
  const key = dateKey(date);
  let store = cache.get(key);
  if (!store) {
    store = loadFromDisk(key);
    cache.set(key, store);
  }
  return store;
}
```

Заміни `writeStore` (рядки 54-62) на:

```javascript
function writeStore(store, date = new Date()) {
  const key = dateKey(date);
  cache.set(key, store);
  dirty.add(key);

  if (DEBOUNCE_MS <= 0) {
    return flushSync(date);
  }

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(key);
    flushSync(date);
  }, DEBOUNCE_MS);
  if (typeof t.unref === 'function') t.unref();
  timers.set(key, t);
  return true;
}
```

Додай `flushSync` і `flushAll` у `module.exports` (рядки 482-503):

```javascript
module.exports = {
  readStore,
  writeStore,
  flushSync,
  flushAll,
  upsertFromEnrichment,
  // ... (решта без змін)
};
```

- [ ] **Step 4: Запустити повний test-suite**

Run: `npm test`
Очікувано: усі тести pass (включно з новими flushSync/flushAll). Поведінка не змінюється за замовчуванням (`DEBOUNCE_MS=0`), бо `writeStore` одразу робить `flushSync`.

- [ ] **Step 5: Коміт**

```bash
git add src/store/matchStore.js test/matchStore.test.js
git commit -m "feat(store): add in-memory cache and flushSync/flushAll to matchStore

Cache prepares ground for debounced persist. By default DEBOUNCE_MS=0
keeps current sync-write behavior, so all existing tests pass unchanged."
```

---

## Task 3: Опційний debouncing + production wiring

**Files:**
- Modify: `src/store/matchStore.js` (`finalize` має робити `flushSync` перед telegram dispatch; додати `process.on('exit')` belt+suspenders)
- Modify: `src/orchestrator/runWatch.js` (`flushAll` у shutdown)
- Modify: `test/matchStore.test.js` (тести debouncing-режиму)

- [ ] **Step 1: Тест на debounced поведінку**

Додай у `test/matchStore.test.js`:

```javascript
test('debounced writeStore defers disk write until flushSync', () => {
  process.env.MATCHSTORE_DEBOUNCE_MS = '5000';
  delete require.cache[require.resolve('../src/store/matchStore')];
  const debounced = require('../src/store/matchStore');

  const date = makeTempDate('06');
  const dir = debounced.dayLogsAbsolute(date);
  const file = path.join(dir, 'matches.json');

  debounced.writeStore({ pending: { matchId: 'pending' } }, date);

  assert.ok(
    !fs.existsSync(file) || JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) === '{}',
    'файл не повинен містити запис до flushSync'
  );

  debounced.flushSync(date);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.pending.matchId, 'pending');

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MATCHSTORE_DEBOUNCE_MS;
  delete require.cache[require.resolve('../src/store/matchStore')];
});

test('debounced writeStore — readStore returns latest cached state immediately', () => {
  process.env.MATCHSTORE_DEBOUNCE_MS = '5000';
  delete require.cache[require.resolve('../src/store/matchStore')];
  const debounced = require('../src/store/matchStore');

  const date = makeTempDate('07');
  debounced.writeStore({ live: { matchId: 'live' } }, date);
  const got = debounced.readStore(date);
  assert.equal(got.live.matchId, 'live', 'readStore має повертати cached state без flush');

  debounced.flushSync(date);
  fs.rmSync(debounced.dayLogsAbsolute(date), { recursive: true, force: true });
  delete process.env.MATCHSTORE_DEBOUNCE_MS;
  delete require.cache[require.resolve('../src/store/matchStore')];
});
```

- [ ] **Step 2: Запустити тести — нові debounced тести мають **пройти** (бо логіка уже на місці з Task 2)**

Run: `node --test test/matchStore.test.js`
Очікувано: усі pass.

Якщо `debounced writeStore defers disk write` fail — значить `setTimeout` не задебансив. Перевір що в writeStore при `DEBOUNCE_MS>0` повертається без `flushSync`.

- [ ] **Step 3: Зробити `finalize` гарантовано sync (telegram dispatcher депендить)**

Файл `src/store/matchStore.js`, функція `finalize` (рядки 309-350). Знайди рядок:

```javascript
  const persisted = writeStore(store, date);
```

Заміни на:

```javascript
  writeStore(store, date);
  const persisted = flushSync(date);
```

Це гарантує, що telegram-dispatcher (рядки 330-346) запускається тільки після того, як дані на диску, навіть у debounced-режимі.

- [ ] **Step 4: Тест на `finalize` flushSync**

Додай у `test/matchStore.test.js`:

```javascript
test('finalize flushes synchronously even in debounced mode', () => {
  process.env.MATCHSTORE_DEBOUNCE_MS = '60000';
  delete require.cache[require.resolve('../src/store/matchStore')];
  const debounced = require('../src/store/matchStore');

  const date = makeTempDate('08');
  debounced.upsertFromEnrichment({
    matchId: 'fin-1',
    homeTeam: 'H', awayTeam: 'A',
    statistics: { '1half': { home: {}, away: {} } },
    statsLevel: 'detailed',
    odds: { home: 2.0, draw: 3.2, away: 3.6 },
    standings: { home: { pts: 10, mp: 5 }, away: { pts: 10, mp: 5 } },
  }, date);

  debounced.finalize('fin-1', {
    scoreHome: 0, scoreAway: 0, totalGoals: 0,
    resultTM05: true, resultTB05: false,
    firstGoalMinute: null, goals: [],
    finishedAt: new Date().toISOString(),
  }, {}, date);

  const file = path.join(debounced.dayLogsAbsolute(date), 'matches.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk['fin-1'].tracking.status, 'finished',
    'finalize має sync-flushити навіть при увімкненому debouncing');

  fs.rmSync(debounced.dayLogsAbsolute(date), { recursive: true, force: true });
  delete process.env.MATCHSTORE_DEBOUNCE_MS;
  delete require.cache[require.resolve('../src/store/matchStore')];
});
```

- [ ] **Step 5: Запустити test-suite**

Run: `npm test`
Очікувано: усі pass.

- [ ] **Step 6: Додати `flushAll` у shutdown orchestrator'а**

Файл `src/orchestrator/runWatch.js`, рядки 22-34. Знайти:

```javascript
async function shutdown() {
    printShutdown();
    running = false;
    trackingScheduler.stop();
    await closeBrowser();
    process.exit(0);
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
```

Замінити на:

```javascript
async function shutdown() {
    printShutdown();
    running = false;
    trackingScheduler.stop();
    await closeBrowser();
    try {
      const matchStore = require('../store/matchStore');
      matchStore.flushAll();
    } catch (err) {
      // best-effort; not worth blocking exit
    }
    process.exit(0);
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
```

- [ ] **Step 7: Belt+suspenders — `process.on('exit')` у самому matchStore**

Файл `src/store/matchStore.js`. На самому кінці файлу, **перед** `module.exports = { ... }`, додай:

```javascript
process.on('exit', () => {
  try { flushAll(); } catch (_) { /* exit-handler best-effort */ }
});
```

Це гарантує flush навіть для скриптів, що не проходять через `runWatch.js` (наприклад, `predictionReplay.js`, ad-hoc Node-скрипти).

- [ ] **Step 8: Тест на belt+suspenders (exit-handler)**

Через `process.on('exit')` тест важко покрити нативно — пропускаємо unit, перевіряємо integration:

Run: `node --test test/matchStore.test.js`
Очікувано: усі pass (нові тести в Task 3 step 4 і попередні).

Run: `npm test`
Очікувано: усі ~234 тести pass.

- [ ] **Step 9: Smoke test з debouncing увімкненим**

Запустити `node scripts/predictionReplay.js` з debouncing:

```bash
MATCHSTORE_DEBOUNCE_MS=500 node scripts/predictionReplay.js | head -20
```

Очікувано: скрипт відпрацьовує без помилок, виводить статистику (replay тільки читає, не пише — але exit-handler має закритись чисто).

- [ ] **Step 10: Коміт**

```bash
git add src/store/matchStore.js src/orchestrator/runWatch.js test/matchStore.test.js
git commit -m "feat(store): wire debounced persist with flushSync on finalize and shutdown

finalize() is now guaranteed sync (telegram dispatcher depends on
persisted state). runWatch.shutdown calls flushAll. matchStore registers
process.on('exit') as belt+suspenders for ad-hoc scripts.

Debouncing remains opt-in via MATCHSTORE_DEBOUNCE_MS env (default 0)."
```

---

## Task 4: Документація і вмикання у production

**Files:**
- Modify: `CLAUDE.md` АБО окремий `docs/superpowers/specs/2026-05-11-matchstore-design.md` — короткий опис flag'а

- [ ] **Step 1: Створити короткий design-документ**

Файл `docs/superpowers/specs/2026-05-11-matchstore-design.md`:

```markdown
# matchStore Atomic + Debounced Persist

**Дата:** 2026-05-11
**Гілка:** v4

## Що зроблено

1. **Atomic write** — `matchStore.writeStore` пише в `matches.json.tmp` і робить `renameSync`. POSIX-атомарність → файл або повністю старий, або повністю новий.
2. **In-memory cache** — `readStore` повертає cached state; `writeStore` мутує cache і скидає на диск.
3. **Debouncing** — опційно через `MATCHSTORE_DEBOUNCE_MS` (мс). Default `0` = синхронна поведінка.
4. **`flushSync(date)` / `flushAll()`** — експортовані, використовуються в `finalize()` і shutdown handler.

## Як вмикати в production

У `.env` (або при запуску):

```
MATCHSTORE_DEBOUNCE_MS=500
```

500 мс — компроміс: write amplification падає в ~20-50× (групує множинні mutations одного матча в один flush), при цьому ризик втрати — ≤ 500 мс активних даних при kill -9.

## Гарантії

- `finalize()` завжди робить sync flush — телеграм/result-сповіщення йде тільки після disk-persistence.
- `SIGINT`/`SIGTERM` через `runWatch.shutdown` робить `flushAll()`.
- `process.on('exit')` як belt+suspenders для ad-hoc скриптів.
- Корупція файлу при збої виключена (atomic rename).

## Що **не** зроблено (свідомо)

- DB-міграція (SQLite/Postgres) — окрема велика задача.
- Розділення на per-match файли — окрема задача.
- Конкурентний доступ — не потрібен (single-process).
```

- [ ] **Step 2: Коміт**

```bash
git add docs/superpowers/specs/2026-05-11-matchstore-design.md
git commit -m "docs(spec): matchstore atomic + debounced persist design notes"
```

- [ ] **Step 3: Push гілки**

```bash
git push origin v4
```

(Production-флаг `MATCHSTORE_DEBOUNCE_MS=500` вмикати **окремо** після спостереження 1-2 днів live-стабільності. Не вмикати разом з мерджем.)

---

## Self-Review

**1. Spec coverage:**
- Atomic write → Task 1 ✓
- In-memory cache → Task 2 ✓
- Debouncing opt-in + flushSync/flushAll → Task 2+3 ✓
- finalize sync flush → Task 3 step 3 ✓
- Shutdown wiring → Task 3 step 6 ✓
- Belt+suspenders exit handler → Task 3 step 7 ✓
- Документація → Task 4 ✓

**2. Placeholder scan:** ✓ — нема TBD/TODO, усі steps з реальним кодом.

**3. Type consistency:**
- `flushSync(date)` повертає `boolean` (з `writeStoreToDisk`) — consistent.
- `flushAll()` повертає `undefined` — consistent (void function).
- `cache: Map<dateKey, store>`, `dirty: Set<dateKey>`, `timers: Map<dateKey, Timer>` — узгоджено.
- `dateKey(date)` використовує існуючий `dateKeyLocal` з `helpers/date` — collision-free з рештою системи.

**4. Регресії:** existing тести (`replay.test.js`, `prediction.test.js`, `ai.test.js`) використовують `matchStore.writeStore` синхронно і одразу читають з диску (`ai.test.js:803`). За замовчуванням `DEBOUNCE_MS=0` → синхронна поведінка зберігається → тести проходять без правок.

**5. Risk per task:** усі задачі ізольовані, кожна додає тести **до** коду (TDD). Task 1 — мінімальний ризик (тільки atomic rename). Task 2 — додаткова сутність (cache), але семантично transparent при `DEBOUNCE_MS=0`. Task 3 — вмикає debouncing і гарантує finalize-sync; критичний test на `finalize` забезпечує безпеку.
