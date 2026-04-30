# Лінія 1 — P_dry Consensus + Trajectory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реалізувати нову стратегію ставок ТМ 0.5 (Лінія 1) з раннім моніторингом 1H→2H, consensus-формулою P_dry на основі 5 компонентів, hard SKIP gates і shadow-mode rollout. Ціль HR ≥60%.

**Architecture:** 4-шарова модель: per-minute pace normalization → 5 dry_score компонентів → consensus агрегація з лігою-baseline → hard SKIP gates. Інтеграція в `worker.js` паралельно з v3 (не замінює). Shadow-логи окремо від продакшн-сигналів.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert/strict`, Puppeteer для скрапінгу. Гілка `v3.3`. Спек: `docs/superpowers/specs/2026-04-30-line1-pdry-consensus-trajectory-design.md`.

---

## File Structure

### Нові файли (створюються)
- `src/pipeline/line1/paceNormalizer.js` — Шар 1: pace_1H / pace_2H / intensityRatio
- `src/pipeline/line1/dryScoreComponents.js` — Шар 2: 5 dry_score [0,1]
- `src/pipeline/line1/consensusAggregator.js` — Шар 3: P_dry + consensus gate
- `src/pipeline/line1/hardGates.js` — Шар 4: red card / xG burst / BC delta
- `src/pipeline/line1/dryEngine.js` — Orchestrator (точка входу `evaluateLine1Dry`)
- `src/pipeline/line1/shadowLogger.js` — Запис shadow-рішень у `data/logs/{date}/line1_shadow.json`
- `src/helpers/leagueBaselines.js` — Per-league `baseline_dry` (стартові defaults, потім calibrated)
- `test/line1.paceNormalizer.test.js`
- `test/line1.dryScoreComponents.test.js`
- `test/line1.consensusAggregator.test.js`
- `test/line1.hardGates.test.js`
- `test/line1.dryEngine.integration.test.js`
- `scripts/calibrateLine1.js` — Backtest + logistic regression на історичних даних
- `scripts/shadowReportLine1.js` — Денний звіт shadow-режиму

### Модифікуємо
- `src/scrapeDesktopStats.js` — Додаємо парсинг `/summary/stats/1st-half/` endpoint
- `src/pipeline/featureBuilder.js` — Додаємо `raw1H` + `pace1H` поля
- `src/helpers/constants.js` — Додаємо `LINE1_*` константи
- `worker.js` — Паралельний виклик `evaluateLine1Dry` після v3 (shadow-only початково)

### Дані
- `data/logs/{date}/line1_shadow.json` — Shadow-рішення (нові)

---

## Task 1: Recon FlashScore 1H stats endpoint

**Files:** Тільки тимчасовий скрипт, не комітимо.

- [ ] **Step 1: Створити recon-скрипт `/tmp/recon_1h.js`**

```javascript
const { launchBrowser, pickUserAgent } = require('/Users/m.aralov/projects/parserFootballOdds/src/browser');
(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(pickUserAgent());
  // Use a known-finished match URL with stats from logs
  const matchId = process.argv[2] || 'jFsSOG3E'; // Petrojet-Ismaily 2026-04-28
  const url = `https://www.flashscore.ua/match/${matchId}/#/match-summary/match-statistics/1`;
  console.log('GET', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await new Promise(r => setTimeout(r, 2000));
  const has1H = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[data-testid*="wcl-tab"], button')).map(t => t.textContent.trim()).slice(0, 30);
    const rows = document.querySelectorAll('[data-testid="wcl-statistics"]').length;
    return { tabs, rows, finalUrl: location.href };
  });
  console.log(JSON.stringify(has1H, null, 2));
  // Спробувати прямий URL з 1st-half
  const directUrl = `https://www.flashscore.ua/match/${matchId}/summary/stats/1st-half/?mid=${matchId}`;
  console.log('GET direct:', directUrl);
  await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await new Promise(r => setTimeout(r, 2000));
  const direct = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-testid="wcl-statistics"]').length;
    return { rows, url: location.href };
  });
  console.log(JSON.stringify(direct, null, 2));
  await browser.close();
})();
```

- [ ] **Step 2: Запустити recon**

```bash
node /tmp/recon_1h.js
```

Очікувано: рядок `direct: { rows: <N>, ... }` з `rows > 0` означає що endpoint `1st-half` працює аналогічно `2nd-half`. Записати спостереження як коментар у Task 2.

- [ ] **Step 3: Видалити recon-скрипт**

```bash
rm /tmp/recon_1h.js
```

(Без коміту — рекон не йде в репозиторій.)

---

## Task 2: Додати 1H endpoint у scrapeDesktopStats

**Files:**
- Modify: `src/scrapeDesktopStats.js:293-296` (масив `endpoints`)
- Modify: `src/scrapeDesktopStats.js:287` (initial `results` object)
- Modify: `src/scrapeDesktopStats.js:376-385` (statsStatus + log)

- [ ] **Step 1: Додати `firstHalf` в endpoints і initial result**

Знайти рядок 287 у `src/scrapeDesktopStats.js`:

```javascript
  const results = { matchId, overall: null, secondHalf: null, statsStatus: 'unavailable', diagnostics: {} };
```

Замінити на:

```javascript
  const results = { matchId, overall: null, firstHalf: null, secondHalf: null, statsStatus: 'unavailable', diagnostics: {} };
```

Знайти рядок 293-296 (масив `endpoints`):

```javascript
  const endpoints = [
    { key: 'overall', suffix: '/summary/stats/overall/' },
    { key: 'secondHalf', suffix: '/summary/stats/2nd-half/' },
  ];
```

Замінити на:

```javascript
  const endpoints = [
    { key: 'overall', suffix: '/summary/stats/overall/' },
    { key: 'firstHalf', suffix: '/summary/stats/1st-half/' },
    { key: 'secondHalf', suffix: '/summary/stats/2nd-half/' },
  ];
```

- [ ] **Step 2: Оновити statsStatus логіку**

Знайти рядок 376-378:

```javascript
  if (results.overall && results.secondHalf) results.statsStatus = 'both';
  else if (results.secondHalf) results.statsStatus = '2h_only';
  else if (results.overall) results.statsStatus = 'overall_only';
```

Замінити на (додаємо `firstHalf` без зміни існуючих значень `statsStatus`):

```javascript
  if (results.overall && results.secondHalf) results.statsStatus = 'both';
  else if (results.secondHalf) results.statsStatus = '2h_only';
  else if (results.overall) results.statsStatus = 'overall_only';
  // firstHalf — additive: не змінює statsStatus, але доступний у results.firstHalf
```

- [ ] **Step 3: Smoke-тест**

Запустити локально один цикл і перевірити що 1H stats збираються:

```bash
LIVE_IGNORE_HOURS=1 node -e "
const { launchBrowser, pickUserAgent } = require('./src/browser');
const { resolveDesktopUrl, scrapeDesktopStats } = require('./src/scrapeDesktopStats');
(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(pickUserAgent());
  const matchId = 'jFsSOG3E';
  const { desktopUrl } = await resolveDesktopUrl(page, matchId);
  console.log('Desktop:', desktopUrl);
  const stats = await scrapeDesktopStats(page, desktopUrl, matchId);
  console.log('keys:', Object.keys(stats));
  console.log('firstHalf metrics:', stats.firstHalf ? Object.keys(stats.firstHalf.sum).length : 'null');
  console.log('secondHalf metrics:', stats.secondHalf ? Object.keys(stats.secondHalf.sum).length : 'null');
  await browser.close();
})();
"
```

Expected: `firstHalf metrics: <N>` де N>0 (зазвичай 6-12 для топ-ліг). Якщо null — fallback potрібен (Task 2.5).

- [ ] **Step 4: Commit**

```bash
git add src/scrapeDesktopStats.js
git commit -m "feat(scraper): додати парсинг 1H статистики через /summary/stats/1st-half/"
```

---

## Task 3: Додати raw1H у featureBuilder

**Files:**
- Modify: `src/pipeline/featureBuilder.js`

- [ ] **Step 1: Написати failing-тест**

Створити `test/line1.featureBuilder.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFeatures } = require('../src/pipeline/featureBuilder');

const mkStats = (sumObj) => ({ home: {}, away: {}, sum: sumObj });

test('buildFeatures повертає raw1H коли firstHalf наданий', () => {
  const match = { id: 'M1', league: 'Test', minute: 55, score: { home: '0', away: '0' } };
  const statsResult = {
    overall: mkStats({ shotsOnTarget: 5, expectedGoalsXg: 1.2, bigChances: 1, touchesInOppositionBox: 30, cornerKicks: 6, goalkeeperSaves: 2 }),
    firstHalf: mkStats({ shotsOnTarget: 3, expectedGoalsXg: 0.7, bigChances: 1, touchesInOppositionBox: 18, cornerKicks: 4, goalkeeperSaves: 1 }),
    secondHalf: mkStats({ shotsOnTarget: 2, expectedGoalsXg: 0.5, bigChances: 0, touchesInOppositionBox: 12, cornerKicks: 2, goalkeeperSaves: 1 }),
    statsStatus: 'both',
  };
  const f = buildFeatures(match, statsResult);
  assert.ok(f.raw1H, 'raw1H повинен існувати');
  assert.equal(f.raw1H.shotsOnTarget, 3);
  assert.equal(f.raw1H.expectedGoalsXg, 0.7);
});

test('buildFeatures: raw1H = null коли firstHalf відсутній', () => {
  const match = { id: 'M2', league: 'Test', minute: 65, score: { home: '0', away: '0' } };
  const statsResult = {
    overall: mkStats({ shotsOnTarget: 4, expectedGoalsXg: 1.0 }),
    firstHalf: null,
    secondHalf: mkStats({ shotsOnTarget: 2, expectedGoalsXg: 0.5 }),
    statsStatus: 'both',
  };
  const f = buildFeatures(match, statsResult);
  assert.equal(f.raw1H, null);
});
```

- [ ] **Step 2: Запустити тест — перевірити що падає**

```bash
node --test test/line1.featureBuilder.test.js
```

Expected: FAIL — `f.raw1H` undefined.

- [ ] **Step 3: Реалізувати**

У `src/pipeline/featureBuilder.js` знайти функцію `buildFeatures` (~рядок 103).

Знайти:

```javascript
function buildFeatures(match, statsResult) {
  const { overall, secondHalf, statsStatus } = statsResult;
```

Замінити на:

```javascript
function buildFeatures(match, statsResult) {
  const { overall, firstHalf, secondHalf, statsStatus } = statsResult;
```

Знайти всередині `buildFeatures` блок з `raw2H` і `rawOverall` (після рядка ~120):

```javascript
  const raw2H = secondHalf ? extractRaw(secondHalf) : null;
  const rawOverall = context ? extractRaw(context) : null;
```

Замінити на:

```javascript
  const raw2H = secondHalf ? extractRaw(secondHalf) : null;
  const raw1H = firstHalf ? extractRaw(firstHalf) : null;
  const rawOverall = context ? extractRaw(context) : null;
```

Знайти return-блок (~рядок 147):

```javascript
  return {
    matchId: match.id, league: match.league, minute: match.minute,
    minuteBucket: getMinuteBucket(match.minute),
    statsStatus,
    raw2H, rawOverall, normalized: norm, imbalance,
```

Замінити на:

```javascript
  return {
    matchId: match.id, league: match.league, minute: match.minute,
    minuteBucket: getMinuteBucket(match.minute),
    statsStatus,
    raw2H, raw1H, rawOverall, normalized: norm, imbalance,
```

Також у early-return (коли немає primary, ~рядок 108):

```javascript
  if (!primary) {
    return {
      matchId: match.id, league: match.league, minute: match.minute,
      minuteBucket: getMinuteBucket(match.minute),
      statsStatus: statsStatus || 'unavailable',
      raw2H: null, rawOverall: null, normalized: {}, imbalance: {},
```

Замінити на:

```javascript
  if (!primary) {
    return {
      matchId: match.id, league: match.league, minute: match.minute,
      minuteBucket: getMinuteBucket(match.minute),
      statsStatus: statsStatus || 'unavailable',
      raw2H: null, raw1H: null, rawOverall: null, normalized: {}, imbalance: {},
```

- [ ] **Step 4: Запустити тест — перевірити що пройшов**

```bash
node --test test/line1.featureBuilder.test.js
```

Expected: PASS обидва тести.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/featureBuilder.js test/line1.featureBuilder.test.js
git commit -m "feat(features): додати raw1H у buildFeatures для Лінії 1"
```

---

## Task 4: paceNormalizer — pace_1H, pace_2H, intensityRatio

**Files:**
- Create: `src/pipeline/line1/paceNormalizer.js`
- Create: `test/line1.paceNormalizer.test.js`

- [ ] **Step 1: Написати failing-тести**

Створити `test/line1.paceNormalizer.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computePace, computeIntensityRatio } = require('../src/pipeline/line1/paceNormalizer');

test('computePace: pace_1H = stat_1H / 45', () => {
  const raw1H = { shotsOnTarget: 3, expectedGoalsXg: 0.9, bigChances: 1, touchesInOppositionBox: 18, totalShots: 6 };
  const pace = computePace(raw1H, 45);
  assert.equal(pace.shotsOnTarget, 3 / 45);
  assert.equal(pace.expectedGoalsXg, 0.9 / 45);
  assert.equal(pace.bigChances, 1 / 45);
});

test('computePace: pace_2H(t=55) для 5 хв даних 2H', () => {
  // На 55-й хвилині — 10 хв 2H. Якщо 2H=delta(overall - 1H), оператор виклику передає вже delta.
  const delta2H = { shotsOnTarget: 1, expectedGoalsXg: 0.2, bigChances: 0, touchesInOppositionBox: 4, totalShots: 2 };
  const pace = computePace(delta2H, 10); // minutes2H = 10
  assert.equal(pace.shotsOnTarget, 0.1);
  assert.equal(pace.expectedGoalsXg, 0.02);
});

test('computePace: повертає null для 0 minutes', () => {
  const pace = computePace({ shotsOnTarget: 1 }, 0);
  assert.equal(pace, null);
});

test('computePace: пропускає null/undefined метрики', () => {
  const pace = computePace({ shotsOnTarget: null, expectedGoalsXg: 0.5 }, 45);
  assert.equal(pace.shotsOnTarget, null);
  assert.equal(pace.expectedGoalsXg, 0.5 / 45);
});

test('computeIntensityRatio: ratio = pace_2H / pace_1H', () => {
  const pace1H = { shotsOnTarget: 0.1, expectedGoalsXg: 0.02 };
  const pace2H = { shotsOnTarget: 0.05, expectedGoalsXg: 0.01 };
  const r = computeIntensityRatio(pace2H, pace1H);
  assert.equal(r.shotsOnTarget, 0.5);
  assert.equal(r.expectedGoalsXg, 0.5);
});

test('computeIntensityRatio: pace_1H=0 → null (уникнути div by 0)', () => {
  const pace1H = { shotsOnTarget: 0 };
  const pace2H = { shotsOnTarget: 0.1 };
  const r = computeIntensityRatio(pace2H, pace1H);
  assert.equal(r.shotsOnTarget, null);
});

test('computeIntensityRatio: обидва 0 → 1.0 (нейтрально)', () => {
  const pace1H = { shotsOnTarget: 0, expectedGoalsXg: 0 };
  const pace2H = { shotsOnTarget: 0, expectedGoalsXg: 0 };
  // Якщо обидві 0 — нейтрально, не «розкривається»
  const r = computeIntensityRatio(pace2H, pace1H);
  // Окремий контракт: за відсутності даних → null. Це підпорядковано Шару 2.
  assert.equal(r.shotsOnTarget, null);
});
```

- [ ] **Step 2: Запустити тест — перевірити що падає**

```bash
node --test test/line1.paceNormalizer.test.js
```

Expected: FAIL — модуль не існує.

- [ ] **Step 3: Реалізувати**

Створити `src/pipeline/line1/paceNormalizer.js`:

```javascript
'use strict';

/**
 * Метрики які нормалізуються per-minute для Лінії 1.
 * Окремо від PRIMARY_METRICS — тут лише ті що мають сенс для темп-аналізу.
 */
const PACE_METRICS = [
  'shotsOnTarget',
  'expectedGoalsXg',
  'bigChances',
  'touchesInOppositionBox',
  'totalShots',
];

/**
 * @param {object|null} raw — об'єкт з sum-метриками
 * @param {number} minutes — кількість хвилин які покриває raw (45 для 1H, t-45 для 2H snapshot)
 * @returns {object|null} pace[metric] = stat / minutes; null коли minutes ≤ 0 або raw порожній
 */
function computePace(raw, minutes) {
  if (!raw || !Number.isFinite(minutes) || minutes <= 0) return null;
  const out = {};
  for (const k of PACE_METRICS) {
    const v = raw[k];
    if (v === null || v === undefined || !Number.isFinite(Number(v))) {
      out[k] = null;
    } else {
      out[k] = Number(v) / minutes;
    }
  }
  return out;
}

/**
 * @param {object|null} pace2H
 * @param {object|null} pace1H
 * @returns {object|null} ratio[metric] = pace2H / pace1H; null коли pace1H=0 або null
 */
function computeIntensityRatio(pace2H, pace1H) {
  if (!pace1H || !pace2H) return null;
  const out = {};
  for (const k of PACE_METRICS) {
    const a = pace2H[k];
    const b = pace1H[k];
    if (a === null || b === null || b === 0 || !Number.isFinite(a) || !Number.isFinite(b)) {
      out[k] = null;
    } else {
      out[k] = Number((a / b).toFixed(4));
    }
  }
  return out;
}

module.exports = { computePace, computeIntensityRatio, PACE_METRICS };
```

- [ ] **Step 4: Запустити тести — перевірити що пройшли**

```bash
node --test test/line1.paceNormalizer.test.js
```

Expected: PASS всі 7 тестів.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/line1/paceNormalizer.js test/line1.paceNormalizer.test.js
git commit -m "feat(line1): paceNormalizer — pace_1H/pace_2H/intensityRatio"
```

---

## Task 5: dryScoreComponents — dry_1H + dry_2H

**Files:**
- Create: `src/pipeline/line1/dryScoreComponents.js`
- Create: `test/line1.dryScoreComponents.test.js`

- [ ] **Step 1: Написати failing-тести (для двох перших компонентів)**

Створити `test/line1.dryScoreComponents.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dryFromIntensity } = require('../src/pipeline/line1/dryScoreComponents');

test('dryFromIntensity: повністю порожній half (нулі) → ~1.0', () => {
  const raw = { shotsOnTarget: 0, expectedGoalsXg: 0, bigChances: 0, touchesInOppositionBox: 0 };
  const score = dryFromIntensity(raw);
  assert.ok(score >= 0.9, `expected ≥0.9 for empty half, got ${score}`);
});

test('dryFromIntensity: дуже інтенсивний half (high values) → ~0', () => {
  const raw = { shotsOnTarget: 8, expectedGoalsXg: 2.0, bigChances: 4, touchesInOppositionBox: 25 };
  const score = dryFromIntensity(raw);
  assert.ok(score <= 0.15, `expected ≤0.15 for intensive half, got ${score}`);
});

test('dryFromIntensity: середній half → 0.4-0.6', () => {
  const raw = { shotsOnTarget: 3, expectedGoalsXg: 0.8, bigChances: 1, touchesInOppositionBox: 12 };
  const score = dryFromIntensity(raw);
  assert.ok(score >= 0.3 && score <= 0.7, `expected mid-range, got ${score}`);
});

test('dryFromIntensity: null/відсутні поля → треба ігнорувати, не падати', () => {
  const raw = { shotsOnTarget: null, expectedGoalsXg: 0.5 };
  const score = dryFromIntensity(raw);
  assert.ok(Number.isFinite(score), 'score має бути finite навіть з null-полями');
});

test('dryFromIntensity: null raw → 0.5 (нейтрально)', () => {
  assert.equal(dryFromIntensity(null), 0.5);
});
```

- [ ] **Step 2: Запустити тести — перевірити що падають**

```bash
node --test test/line1.dryScoreComponents.test.js
```

Expected: FAIL — модуль не існує.

- [ ] **Step 3: Реалізувати dryFromIntensity**

Створити `src/pipeline/line1/dryScoreComponents.js`:

```javascript
'use strict';

/**
 * Sigmoid: повертає [0..1], центр на x0, нахил k.
 */
function sigmoid(x, x0 = 0, k = 1) {
  return 1 / (1 + Math.exp(-(x - x0) * k));
}

/**
 * Нормалізація 0..max → 0..1 (clip).
 */
function n01(v, max) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const c = Math.max(0, Math.min(Number(v), max));
  return c / max;
}

/**
 * dry-сила одного half (чи 1H, чи "проектований" 2H темп × 45).
 * Повертає [0..1], 1 = повна dry-ознака.
 *
 * Структура: інтенсивність = зважена сума нормалізованих метрик. Чим вища інтенсивність, тим менше dry.
 */
function dryFromIntensity(raw) {
  if (!raw) return 0.5;

  const sot = n01(raw.shotsOnTarget, 8);
  const xg = n01(raw.expectedGoalsXg, 2.0);
  const bc = n01(raw.bigChances, 4);
  const touch = n01(raw.touchesInOppositionBox, 25);

  const parts = [];
  if (sot !== null)   parts.push({ v: sot, w: 0.40 });
  if (xg !== null)    parts.push({ v: xg, w: 0.30 });
  if (bc !== null)    parts.push({ v: bc, w: 0.20 });
  if (touch !== null) parts.push({ v: touch, w: 0.10 });

  if (parts.length === 0) return 0.5; // немає даних → нейтрально

  const totalW = parts.reduce((s, p) => s + p.w, 0);
  const intensity = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;

  // 1 - intensity = dry score; додатково сигмоїда центрована на 0.5 (нейтральна точка)
  // для м'якшого переходу
  const dry = 1 - intensity;
  return Number(Math.max(0, Math.min(1, dry)).toFixed(4));
}

module.exports = { dryFromIntensity, sigmoid, n01 };
```

- [ ] **Step 4: Запустити тести — перевірити що пройшли**

```bash
node --test test/line1.dryScoreComponents.test.js
```

Expected: PASS всі 5 тестів.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/line1/dryScoreComponents.js test/line1.dryScoreComponents.test.js
git commit -m "feat(line1): dryFromIntensity — базовий dry_1H/dry_2H компонент"
```

---

## Task 6: dryScoreComponents — trajectory_dry, odds_dry, prematch_dry

**Files:**
- Modify: `src/pipeline/line1/dryScoreComponents.js`
- Modify: `test/line1.dryScoreComponents.test.js`

- [ ] **Step 1: Написати failing-тести для нових компонентів**

Додати в кінець `test/line1.dryScoreComponents.test.js`:

```javascript
const {
  trajectoryDry, oddsDry, prematchDry,
} = require('../src/pipeline/line1/dryScoreComponents');

test('trajectoryDry: 2H темп вдвічі менший за 1H → score ~1.0', () => {
  const ratios = { expectedGoalsXg: 0.5, shotsOnTarget: 0.5, touchesInOppositionBox: 0.5 };
  const score = trajectoryDry(ratios);
  assert.ok(score >= 0.9, `expected ~1.0, got ${score}`);
});

test('trajectoryDry: 2H темп = 1H → score ~0.5', () => {
  const ratios = { expectedGoalsXg: 1.0, shotsOnTarget: 1.0, touchesInOppositionBox: 1.0 };
  const score = trajectoryDry(ratios);
  assert.ok(score >= 0.4 && score <= 0.6, `expected ~0.5, got ${score}`);
});

test('trajectoryDry: 2H розкривається (ratio=1.5) → score ~0', () => {
  const ratios = { expectedGoalsXg: 1.5, shotsOnTarget: 1.5, touchesInOppositionBox: 1.5 };
  const score = trajectoryDry(ratios);
  assert.ok(score <= 0.1, `expected ~0, got ${score}`);
});

test('trajectoryDry: null ratios → 0.3 (defensive default — слабкий dry, але не нейтральний)', () => {
  assert.equal(trajectoryDry(null), 0.3);
});

test('trajectoryDry: відсутні поля використовуються через ваги — null поля не враховуються', () => {
  const ratios = { expectedGoalsXg: 0.5, shotsOnTarget: null, touchesInOppositionBox: null };
  const score = trajectoryDry(ratios);
  // тільки xG використано
  assert.ok(Number.isFinite(score));
});

test('oddsDry: нічийний матч (висока implied draw) → high score', () => {
  const odds = { home: 2.8, draw: 2.9, away: 2.8 };
  const score = oddsDry(odds);
  assert.ok(score >= 0.4, `expected ≥0.4, got ${score}`);
});

test('oddsDry: явний фаворит (низька implied draw) → low score', () => {
  const odds = { home: 1.4, draw: 4.5, away: 7.0 };
  const score = oddsDry(odds);
  assert.ok(score <= 0.4, `expected ≤0.4, got ${score}`);
});

test('oddsDry: null odds → 0.4 (defensive)', () => {
  assert.equal(oddsDry(null), 0.4);
});

test('prematchDry: обидві команди low-totals + H2H low → ~1.0', () => {
  const aggregates = {
    home: { n: 5, avgTotalGoals: 1.6 },
    away: { n: 5, avgTotalGoals: 1.8 },
    mutual: { n: 3, avgTotalGoals: 2.0 },
  };
  const score = prematchDry(aggregates);
  assert.ok(score >= 0.9);
});

test('prematchDry: жодної low-ознаки → 0', () => {
  const aggregates = {
    home: { n: 5, avgTotalGoals: 3.4 },
    away: { n: 5, avgTotalGoals: 3.0 },
    mutual: { n: 3, avgTotalGoals: 3.5 },
  };
  const score = prematchDry(aggregates);
  assert.equal(score, 0);
});

test('prematchDry: null aggregates → 0.3 (defensive — без pre-match нейтрально-слабкий dry)', () => {
  assert.equal(prematchDry(null), 0.3);
});
```

- [ ] **Step 2: Запустити тести — перевірити що падають**

```bash
node --test test/line1.dryScoreComponents.test.js
```

Expected: 11+ FAIL (нові 11 не існують).

- [ ] **Step 3: Додати реалізації в `dryScoreComponents.js`**

Додати в кінець `src/pipeline/line1/dryScoreComponents.js` (перед `module.exports`):

```javascript
/**
 * trajectory_dry: на основі intensityRatio[xG/SOT/touches].
 * Зважена ratio: 0.40*xG + 0.35*SOT + 0.25*touches.
 * dry = clip(1.5 - weighted_ratio, 0, 1):
 *   weighted_ratio=0.5 → dry=1.0
 *   weighted_ratio=1.0 → dry=0.5
 *   weighted_ratio=1.5 → dry=0.0
 */
function trajectoryDry(intensityRatio) {
  if (!intensityRatio) return 0.3;

  const parts = [];
  if (intensityRatio.expectedGoalsXg !== null && intensityRatio.expectedGoalsXg !== undefined) {
    parts.push({ v: intensityRatio.expectedGoalsXg, w: 0.40 });
  }
  if (intensityRatio.shotsOnTarget !== null && intensityRatio.shotsOnTarget !== undefined) {
    parts.push({ v: intensityRatio.shotsOnTarget, w: 0.35 });
  }
  if (intensityRatio.touchesInOppositionBox !== null && intensityRatio.touchesInOppositionBox !== undefined) {
    parts.push({ v: intensityRatio.touchesInOppositionBox, w: 0.25 });
  }
  if (parts.length === 0) return 0.3;

  const totalW = parts.reduce((s, p) => s + p.w, 0);
  const weightedRatio = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;

  const dry = 1.5 - weightedRatio;
  return Number(Math.max(0, Math.min(1, dry)).toFixed(4));
}

/**
 * odds_dry: implied_draw + ринкова tightness (1/h + 1/a).
 *   - implied_draw нормалізується [0.20..0.40] → [0..1]
 *   - market_total_inv = 1/h + 1/a; чим менший — тим більше aпсетний матч (great kf для обох)
 *     normalize [0.55..0.95] → [0..1]; беремо (1 - normalized)
 *   - сумарно з вагами 0.5/0.5
 */
function oddsDry(odds1X2) {
  if (!odds1X2 || !odds1X2.home || !odds1X2.draw || !odds1X2.away) return 0.4;

  const h = Number(odds1X2.home);
  const d = Number(odds1X2.draw);
  const a = Number(odds1X2.away);
  if (![h, d, a].every((x) => Number.isFinite(x) && x > 1)) return 0.4;

  const inv = 1 / h + 1 / d + 1 / a;
  const impliedDraw = (1 / d) / inv;
  const marketTotalInv = 1 / h + 1 / a;

  const drawNorm = Math.max(0, Math.min(1, (impliedDraw - 0.20) / (0.40 - 0.20)));
  const totalInvNorm = Math.max(0, Math.min(1, (marketTotalInv - 0.55) / (0.95 - 0.55)));

  const score = 0.5 * drawNorm + 0.5 * (1 - totalInvNorm);
  return Number(Math.max(0, Math.min(1, score)).toFixed(4));
}

/**
 * prematch_dry: low-blocks з aggregates.
 * Кожна команда: n≥3 AND avgTotalGoals ≤ 2.0 → low.
 * H2H: n≥2 AND avgTotalGoals ≤ 2.2 → low.
 * Ваги: 0.4 home + 0.4 away + 0.2 h2h.
 */
function prematchDry(aggregates) {
  if (!aggregates) return 0.3;

  const isLow = (x, threshold, minN) =>
    x && Number.isFinite(x.n) && x.n >= minN &&
    Number.isFinite(x.avgTotalGoals) && x.avgTotalGoals <= threshold;

  const homeLow = isLow(aggregates.home, 2.0, 3) ? 1 : 0;
  const awayLow = isLow(aggregates.away, 2.0, 3) ? 1 : 0;
  const h2hLow = isLow(aggregates.mutual, 2.2, 2) ? 1 : 0;

  const score = 0.4 * homeLow + 0.4 * awayLow + 0.2 * h2hLow;
  return Number(score.toFixed(4));
}
```

Оновити `module.exports`:

```javascript
module.exports = { dryFromIntensity, trajectoryDry, oddsDry, prematchDry, sigmoid, n01 };
```

- [ ] **Step 4: Запустити тести — перевірити що пройшли**

```bash
node --test test/line1.dryScoreComponents.test.js
```

Expected: PASS всі тести (тепер 16).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/line1/dryScoreComponents.js test/line1.dryScoreComponents.test.js
git commit -m "feat(line1): trajectory_dry / odds_dry / prematch_dry компоненти"
```

---

## Task 7: leagueBaselines — defaults для P_dry baseline

**Files:**
- Create: `src/helpers/leagueBaselines.js`
- Create: `test/line1.leagueBaselines.test.js`

- [ ] **Step 1: Написати тести**

Створити `test/line1.leagueBaselines.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getLeagueBaseline, DEFAULT_LEAGUE_BASELINE } = require('../src/helpers/leagueBaselines');

test('getLeagueBaseline: невідома ліга → DEFAULT_LEAGUE_BASELINE', () => {
  const b = getLeagueBaseline('Some Random League');
  assert.equal(b, DEFAULT_LEAGUE_BASELINE);
});

test('getLeagueBaseline: відома ліга → конкретне значення', () => {
  // Italy Serie A — захисна → baseline вищий за default
  const b = getLeagueBaseline('Італія: Серія А');
  assert.ok(b > DEFAULT_LEAGUE_BASELINE);
});

test('getLeagueBaseline: case-insensitive match', () => {
  const b1 = getLeagueBaseline('італія: серія а');
  const b2 = getLeagueBaseline('Італія: Серія А');
  assert.equal(b1, b2);
});

test('getLeagueBaseline: null/undefined → DEFAULT', () => {
  assert.equal(getLeagueBaseline(null), DEFAULT_LEAGUE_BASELINE);
  assert.equal(getLeagueBaseline(''), DEFAULT_LEAGUE_BASELINE);
});
```

- [ ] **Step 2: Запустити — перевірити що падає**

```bash
node --test test/line1.leagueBaselines.test.js
```

Expected: FAIL — модуль не існує.

- [ ] **Step 3: Реалізувати**

Створити `src/helpers/leagueBaselines.js`:

```javascript
'use strict';

/**
 * Baseline P_dry для матчу 0:0 на 50' — ймовірність що матч завершиться 0:0.
 * Стартові значення — приблизні з ліг-знання. Калібруються через scripts/calibrateLine1.js.
 *
 * Ключі — нормалізовані lowercased назви ліг (subset match).
 */
const DEFAULT_LEAGUE_BASELINE = 0.50;

const LEAGUE_BASELINES = {
  // Захисні ліги — більший baseline_dry
  'італія: серія а': 0.58,
  'italy: serie a': 0.58,
  'франція: ліга 1': 0.55,
  'france: ligue 1': 0.55,
  'іспанія: ла ліга': 0.54,
  'spain: la liga': 0.54,
  'португалія: прімейра ліга': 0.55,
  'україна: прем\'єр-ліга': 0.56,

  // Атакуючі — нижчий baseline
  'німеччина: бундесліга': 0.42,
  'germany: bundesliga': 0.42,
  'нідерланди: ередівізі': 0.40,
  'netherlands: eredivisie': 0.40,
  'сша: mls': 0.43,
  'usa: mls': 0.43,
};

function normalize(name) {
  if (!name) return '';
  return String(name).toLowerCase().trim();
}

function getLeagueBaseline(leagueName) {
  const key = normalize(leagueName);
  if (!key) return DEFAULT_LEAGUE_BASELINE;

  // Точне співпадіння
  if (LEAGUE_BASELINES[key] !== undefined) {
    return LEAGUE_BASELINES[key];
  }
  // Subset match: чи містить key якусь з відомих ліг
  for (const [k, v] of Object.entries(LEAGUE_BASELINES)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return DEFAULT_LEAGUE_BASELINE;
}

module.exports = { getLeagueBaseline, DEFAULT_LEAGUE_BASELINE, LEAGUE_BASELINES };
```

- [ ] **Step 4: Запустити тести — перевірити PASS**

```bash
node --test test/line1.leagueBaselines.test.js
```

Expected: PASS всі 4 тести.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/leagueBaselines.js test/line1.leagueBaselines.test.js
git commit -m "feat(line1): leagueBaselines — стартові P_dry baseline-и"
```

---

## Task 8: consensusAggregator — P_dry агрегація + consensus gate

**Files:**
- Create: `src/pipeline/line1/consensusAggregator.js`
- Create: `test/line1.consensusAggregator.test.js`

- [ ] **Step 1: Написати failing-тести**

Створити `test/line1.consensusAggregator.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregatePDry } = require('../src/pipeline/line1/consensusAggregator');

const allDry = { dry_1H: 0.9, dry_2H: 0.9, trajectory: 0.9, odds: 0.7, prematch: 1.0 };
const allActive = { dry_1H: 0.1, dry_2H: 0.1, trajectory: 0.1, odds: 0.2, prematch: 0.0 };

test('aggregatePDry: всі компоненти dry → P_dry близько максимум, signalEligible=true', () => {
  const result = aggregatePDry({
    components: allDry,
    leagueBaseline: 0.50,
    snapshotsCount: 3,
  });
  assert.ok(result.pDry >= 0.85, `expected high P_dry, got ${result.pDry}`);
  assert.equal(result.signalEligible, true);
  assert.equal(result.consensusCount, 5);
});

test('aggregatePDry: всі компоненти active → P_dry низький, signalEligible=false', () => {
  const result = aggregatePDry({
    components: allActive,
    leagueBaseline: 0.50,
    snapshotsCount: 3,
  });
  assert.ok(result.pDry <= 0.55, `expected low P_dry, got ${result.pDry}`);
  assert.equal(result.signalEligible, false);
});

test('aggregatePDry: P_dry≥0.62 + consensus 4/5 + trajectory≥0.4 → signal', () => {
  const components = { dry_1H: 0.6, dry_2H: 0.6, trajectory: 0.5, odds: 0.6, prematch: 0.6 };
  const result = aggregatePDry({ components, leagueBaseline: 0.50, snapshotsCount: 3 });
  assert.equal(result.signalEligible, true);
  assert.ok(result.pDry >= 0.62);
});

test('aggregatePDry: trajectory<0.4 → signalEligible=false навіть з високим P_dry', () => {
  const components = { dry_1H: 0.9, dry_2H: 0.9, trajectory: 0.3, odds: 0.7, prematch: 1.0 };
  const result = aggregatePDry({ components, leagueBaseline: 0.50, snapshotsCount: 3 });
  assert.equal(result.signalEligible, false);
  assert.match(result.skipReason, /trajectory/i);
});

test('aggregatePDry: snapshotsCount<2 → signalEligible=false', () => {
  const result = aggregatePDry({ components: allDry, leagueBaseline: 0.50, snapshotsCount: 1 });
  assert.equal(result.signalEligible, false);
  assert.match(result.skipReason, /snapshot/i);
});

test('aggregatePDry: consensus 3/5 → signalEligible=false', () => {
  const components = { dry_1H: 0.6, dry_2H: 0.6, trajectory: 0.6, odds: 0.3, prematch: 0.2 };
  const result = aggregatePDry({ components, leagueBaseline: 0.50, snapshotsCount: 3 });
  assert.equal(result.consensusCount, 3);
  assert.equal(result.signalEligible, false);
});

test('aggregatePDry: P_dry clipped до [0.10, 0.92]', () => {
  // Дуже високий baseline + всі високі — clip
  const result = aggregatePDry({ components: allDry, leagueBaseline: 0.65, snapshotsCount: 3 });
  assert.ok(result.pDry <= 0.92);
  // Дуже низький baseline + всі низькі — clip
  const r2 = aggregatePDry({ components: allActive, leagueBaseline: 0.20, snapshotsCount: 3 });
  assert.ok(r2.pDry >= 0.10);
});
```

- [ ] **Step 2: Запустити — перевірити що падає**

```bash
node --test test/line1.consensusAggregator.test.js
```

Expected: FAIL — модуль не існує.

- [ ] **Step 3: Реалізувати**

Створити `src/pipeline/line1/consensusAggregator.js`:

```javascript
'use strict';

const WEIGHTS = {
  dry_1H:     0.12,
  dry_2H:     0.15,
  trajectory: 0.18,
  odds:       0.08,
  prematch:   0.07,
};

const PDRY_THRESHOLD          = 0.62;
const CONSENSUS_REQUIRED      = 4;
const CONSENSUS_MIN_PER_SCORE = 0.5;
const TRAJECTORY_HARD_GATE    = 0.4;
const MIN_SNAPSHOTS           = 2;

/**
 * @param {object} input
 * @param {{ dry_1H, dry_2H, trajectory, odds, prematch }} input.components — кожен у [0, 1]
 * @param {number} input.leagueBaseline — baseline_dry для ліги
 * @param {number} input.snapshotsCount — кількість 2H snapshot-ів
 * @returns {{ pDry, signalEligible, consensusCount, weightedSum, skipReason }}
 */
function aggregatePDry({ components, leagueBaseline, snapshotsCount }) {
  const c = components || {};

  // Зважена сума внесків
  let weightedSum = 0;
  let consensusCount = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const v = Number.isFinite(c[key]) ? c[key] : 0;
    weightedSum += v * WEIGHTS[key];
    if (v >= CONSENSUS_MIN_PER_SCORE) consensusCount++;
  }

  let pDry = (Number.isFinite(leagueBaseline) ? leagueBaseline : 0.50) + weightedSum;
  pDry = Number(Math.max(0.10, Math.min(0.92, pDry)).toFixed(4));

  // Determine signalEligible
  let signalEligible = true;
  let skipReason = null;

  if (snapshotsCount < MIN_SNAPSHOTS) {
    signalEligible = false;
    skipReason = `snapshots=${snapshotsCount} < ${MIN_SNAPSHOTS}`;
  } else if ((c.trajectory ?? 0) < TRAJECTORY_HARD_GATE) {
    signalEligible = false;
    skipReason = `trajectory=${c.trajectory} < ${TRAJECTORY_HARD_GATE}`;
  } else if (consensusCount < CONSENSUS_REQUIRED) {
    signalEligible = false;
    skipReason = `consensus=${consensusCount} < ${CONSENSUS_REQUIRED}`;
  } else if (pDry < PDRY_THRESHOLD) {
    signalEligible = false;
    skipReason = `P_dry=${pDry} < ${PDRY_THRESHOLD}`;
  }

  return { pDry, weightedSum: Number(weightedSum.toFixed(4)), consensusCount, signalEligible, skipReason };
}

module.exports = {
  aggregatePDry,
  WEIGHTS,
  PDRY_THRESHOLD,
  CONSENSUS_REQUIRED,
  CONSENSUS_MIN_PER_SCORE,
  TRAJECTORY_HARD_GATE,
  MIN_SNAPSHOTS,
};
```

- [ ] **Step 4: Запустити тести — PASS**

```bash
node --test test/line1.consensusAggregator.test.js
```

Expected: PASS всі 7 тестів.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/line1/consensusAggregator.js test/line1.consensusAggregator.test.js
git commit -m "feat(line1): consensusAggregator — P_dry + consensus gate"
```

---

## Task 9: hardGates — red card / xG burst / BC delta / score change

**Files:**
- Create: `src/pipeline/line1/hardGates.js`
- Create: `test/line1.hardGates.test.js`

- [ ] **Step 1: Написати failing-тести**

Створити `test/line1.hardGates.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyHardGates } = require('../src/pipeline/line1/hardGates');

test('applyHardGates: червона картка → SKIP', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 1, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 0.8 },
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, true);
  assert.match(r.reason, /red card/i);
});

test('applyHardGates: xG burst (intensityRatio≥1.5) → SKIP', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 1.6 },
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, true);
  assert.match(r.reason, /xG burst/i);
});

test('applyHardGates: BC delta ≥1 → SKIP', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 0.6 },
    bcDeltaLast: 1,
    scoreChanged: false,
  });
  assert.equal(r.skip, true);
  assert.match(r.reason, /BC/i);
});

test('applyHardGates: scoreChanged → SKIP', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 0.5 },
    bcDeltaLast: 0,
    scoreChanged: true,
  });
  assert.equal(r.skip, true);
  assert.match(r.reason, /score/i);
});

test('applyHardGates: чисті gates → не skip', () => {
  const r = applyHardGates({
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    intensityRatioLast: { expectedGoalsXg: 0.6 },
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, false);
  assert.equal(r.reason, null);
});

test('applyHardGates: null incidents → не skip (defensive)', () => {
  const r = applyHardGates({
    incidents: null,
    intensityRatioLast: { expectedGoalsXg: 0.6 },
    bcDeltaLast: 0,
    scoreChanged: false,
  });
  assert.equal(r.skip, false);
});
```

- [ ] **Step 2: Запустити — FAIL**

```bash
node --test test/line1.hardGates.test.js
```

- [ ] **Step 3: Реалізувати**

Створити `src/pipeline/line1/hardGates.js`:

```javascript
'use strict';

const XG_BURST_RATIO   = 1.5;
const BC_DELTA_MAX     = 1;

/**
 * Hard SKIP gates для Лінії 1. Перекривають consensus.
 * @param {object} input
 * @param {{ homeRedCards, awayRedCards }|null} input.incidents
 * @param {object|null} input.intensityRatioLast — ratio last 5min snapshot
 * @param {number} input.bcDeltaLast — Δ bigChances last 5min
 * @param {boolean} input.scoreChanged — гол між snapshot-ами
 * @returns {{ skip: boolean, reason: string|null }}
 */
function applyHardGates({ incidents, intensityRatioLast, bcDeltaLast, scoreChanged }) {
  if (scoreChanged) {
    return { skip: true, reason: 'score changed between snapshots' };
  }

  const rcHome = incidents?.homeRedCards ?? 0;
  const rcAway = incidents?.awayRedCards ?? 0;
  if (rcHome > 0 || rcAway > 0) {
    return { skip: true, reason: `red card (h=${rcHome}, a=${rcAway})` };
  }

  const xgRatio = intensityRatioLast?.expectedGoalsXg;
  if (Number.isFinite(xgRatio) && xgRatio >= XG_BURST_RATIO) {
    return { skip: true, reason: `xG burst ratio=${xgRatio} ≥ ${XG_BURST_RATIO}` };
  }

  if (Number.isFinite(bcDeltaLast) && bcDeltaLast >= BC_DELTA_MAX + 1) {
    return { skip: true, reason: `BC delta=${bcDeltaLast} ≥ ${BC_DELTA_MAX + 1}` };
  }
  // Note: тест очікує BC delta ≥1 → skip; threshold у тесті 1 (== 1)
  if (Number.isFinite(bcDeltaLast) && bcDeltaLast >= 1) {
    return { skip: true, reason: `BC delta=${bcDeltaLast} ≥ 1` };
  }

  return { skip: false, reason: null };
}

module.exports = { applyHardGates, XG_BURST_RATIO, BC_DELTA_MAX };
```

(Примітка: подвійна перевірка BC видалить мертвий код; у тесті поріг = 1, тож достатньо одного `≥ 1`. Спрощуємо нижче.)

Замінити блок `BC` на одну перевірку:

```javascript
  if (Number.isFinite(bcDeltaLast) && bcDeltaLast >= 1) {
    return { skip: true, reason: `BC delta=${bcDeltaLast} ≥ 1` };
  }
```

(Видалити перший блок з `BC_DELTA_MAX + 1`.)

- [ ] **Step 4: Запустити тести — PASS**

```bash
node --test test/line1.hardGates.test.js
```

Expected: PASS всі 6 тестів.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/line1/hardGates.js test/line1.hardGates.test.js
git commit -m "feat(line1): hardGates — red card / xG burst / BC delta / score change"
```

---

## Task 10: dryEngine — orchestrator

**Files:**
- Create: `src/pipeline/line1/dryEngine.js`
- Create: `test/line1.dryEngine.integration.test.js`

- [ ] **Step 1: Написати integration-тест**

Створити `test/line1.dryEngine.integration.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLine1Dry } = require('../src/pipeline/line1/dryEngine');

const baseFeatures = {
  matchId: 'M1',
  league: 'Італія: Серія А',
  minute: 65,
  raw1H: { shotsOnTarget: 2, expectedGoalsXg: 0.4, bigChances: 0, touchesInOppositionBox: 12, totalShots: 5 },
  raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.2, bigChances: 0, touchesInOppositionBox: 6, totalShots: 3 },
  rawOverall: { shotsOnTarget: 3, expectedGoalsXg: 0.6, bigChances: 0, touchesInOppositionBox: 18, totalShots: 8 },
  odds1X2: { home: 2.6, draw: 3.0, away: 2.7 },
  statsStatus: 'both',
};

const drySnapshots = [
  { matchMinute: 55, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.05, bigChances: 0, touchesInOppositionBox: 2, totalShots: 1 } },
  { matchMinute: 60, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.10, bigChances: 0, touchesInOppositionBox: 4, totalShots: 2 } },
  { matchMinute: 65, score: { home: '0', away: '0'}, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.20, bigChances: 0, touchesInOppositionBox: 6, totalShots: 3 } },
];

const lowAggregates = {
  home: { n: 5, avgTotalGoals: 1.8 },
  away: { n: 5, avgTotalGoals: 1.7 },
  mutual: { n: 3, avgTotalGoals: 2.0 },
};

test('evaluateLine1Dry: повний dry-сценарій → bet=UNDER_0_5, signalEligible=true', () => {
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures,
    snapshots: drySnapshots,
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'UNDER_0_5');
  assert.equal(result.signalEligible, true);
  assert.ok(result.pDry >= 0.62);
  assert.equal(result.consensusCount >= 4, true);
});

test('evaluateLine1Dry: рахунок не 0:0 → bet=SKIP', () => {
  const result = evaluateLine1Dry({
    match: { score: { home: '1', away: '0' } },
    features: baseFeatures,
    snapshots: drySnapshots,
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
  assert.match(result.reason, /not 0:0/i);
});

test('evaluateLine1Dry: minute<60 → bet=SKIP (поза вікном рішення)', () => {
  const features = { ...baseFeatures, minute: 55 };
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features,
    snapshots: drySnapshots,
    incidents: null,
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
  assert.match(result.reason, /window|minute/i);
});

test('evaluateLine1Dry: minute>75 → bet=SKIP (поза вікном)', () => {
  const features = { ...baseFeatures, minute: 78 };
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features,
    snapshots: drySnapshots,
    incidents: null,
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
});

test('evaluateLine1Dry: red card → SKIP', () => {
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures,
    snapshots: drySnapshots,
    incidents: { homeRedCards: 1, awayRedCards: 0 },
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
  assert.match(result.reason, /red card/i);
});

test('evaluateLine1Dry: повертає всі компоненти у result.components для логу', () => {
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures,
    snapshots: drySnapshots,
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    preMatchAggregates: lowAggregates,
  });
  assert.ok(result.components);
  assert.ok(Number.isFinite(result.components.dry_1H));
  assert.ok(Number.isFinite(result.components.dry_2H));
  assert.ok(Number.isFinite(result.components.trajectory));
  assert.ok(Number.isFinite(result.components.odds));
  assert.ok(Number.isFinite(result.components.prematch));
});

test('evaluateLine1Dry: відсутній raw1H → бет=SKIP з причиною', () => {
  const features = { ...baseFeatures, raw1H: null };
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features,
    snapshots: drySnapshots,
    incidents: null,
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
  assert.match(result.reason, /raw1H|1H stats/i);
});
```

- [ ] **Step 2: Запустити — FAIL**

```bash
node --test test/line1.dryEngine.integration.test.js
```

- [ ] **Step 3: Реалізувати dryEngine**

Створити `src/pipeline/line1/dryEngine.js`:

```javascript
'use strict';

const { computePace, computeIntensityRatio } = require('./paceNormalizer');
const { dryFromIntensity, trajectoryDry, oddsDry, prematchDry } = require('./dryScoreComponents');
const { aggregatePDry } = require('./consensusAggregator');
const { applyHardGates } = require('./hardGates');
const { getLeagueBaseline } = require('../../helpers/leagueBaselines');
const {
  LINE1_DECISION_MIN,
  LINE1_DECISION_MAX,
} = require('../../helpers/constants');

const SNAPSHOT_WINDOW_5MIN_KEYS = ['shotsOnTarget', 'expectedGoalsXg', 'bigChances', 'touchesInOppositionBox', 'totalShots'];

/**
 * Делта останніх 5 хв між snapshot[N-2] і snapshot[N-1].
 */
function computeLast5MinDelta(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return null;
  const prev = snapshots[snapshots.length - 2];
  const cur  = snapshots[snapshots.length - 1];
  const delta = {};
  for (const k of SNAPSHOT_WINDOW_5MIN_KEYS) {
    const a = prev.raw2H?.[k];
    const b = cur.raw2H?.[k];
    if (Number.isFinite(a) && Number.isFinite(b)) delta[k] = b - a;
    else delta[k] = null;
  }
  const minutesSpan = Math.max(1, cur.matchMinute - prev.matchMinute);
  return { delta, minutesSpan, prevSnap: prev, curSnap: cur };
}

/**
 * Чи змінився рахунок між snapshot-ами.
 */
function detectScoreChange(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return false;
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1].score;
    const b = snapshots[i].score;
    if (!a || !b) continue;
    if (a.home !== b.home || a.away !== b.away) return true;
  }
  return false;
}

/**
 * Головна точка входу Лінії 1. Повертає рішення + метадані для логу.
 */
function evaluateLine1Dry({ match, features, snapshots, incidents, preMatchAggregates }) {
  const score = match?.score;
  const isZeroZero = score && String(score.home) === '0' && String(score.away) === '0';
  if (!isZeroZero) {
    return { bet: 'SKIP', signalEligible: false, reason: 'not 0:0', components: null, pDry: null };
  }

  const minute = Number(features?.minute);
  if (!Number.isFinite(minute) || minute < LINE1_DECISION_MIN || minute > LINE1_DECISION_MAX) {
    return {
      bet: 'SKIP',
      signalEligible: false,
      reason: `minute=${minute} поза вікном ${LINE1_DECISION_MIN}-${LINE1_DECISION_MAX}`,
      components: null,
      pDry: null,
    };
  }

  if (!features?.raw1H) {
    return {
      bet: 'SKIP',
      signalEligible: false,
      reason: 'raw1H відсутній — Лінія 1 потребує 1H stats',
      components: null,
      pDry: null,
    };
  }

  // Шар 1: pace + intensityRatio
  const pace1H = computePace(features.raw1H, 45);
  const minutes2H = Math.max(1, minute - 45);
  const pace2H = computePace(features.raw2H, minutes2H);
  const intensityRatio = computeIntensityRatio(pace2H, pace1H);

  // 2H "проектовано" на повний тайм для dry_2H
  const projected2H = pace2H
    ? Object.fromEntries(Object.entries(pace2H).map(([k, v]) => [k, v == null ? null : v * 45]))
    : null;

  // Шар 2: 5 dry_score компонентів
  const components = {
    dry_1H:     dryFromIntensity(features.raw1H),
    dry_2H:     dryFromIntensity(projected2H),
    trajectory: trajectoryDry(intensityRatio),
    odds:       oddsDry(features.odds1X2),
    prematch:   prematchDry(preMatchAggregates),
  };

  // Шар 4: hard gates ще ДО aggregator (раннє SKIP економить логування)
  const last5 = computeLast5MinDelta(snapshots);
  const intensityRatioLast = last5
    ? computeIntensityRatio(
        computePace(last5.delta, last5.minutesSpan),
        pace1H
      )
    : null;
  const bcDeltaLast = last5 ? (last5.delta.bigChances ?? 0) : 0;
  const scoreChanged = detectScoreChange(snapshots);

  const gate = applyHardGates({ incidents, intensityRatioLast, bcDeltaLast, scoreChanged });
  if (gate.skip) {
    return {
      bet: 'SKIP',
      signalEligible: false,
      reason: `hard gate: ${gate.reason}`,
      components,
      pDry: null,
      intensityRatio,
      intensityRatioLast,
    };
  }

  // Шар 3: aggregator
  const baseline = getLeagueBaseline(features.league);
  const agg = aggregatePDry({
    components,
    leagueBaseline: baseline,
    snapshotsCount: Array.isArray(snapshots) ? snapshots.length : 0,
  });

  return {
    bet: agg.signalEligible ? 'UNDER_0_5' : 'SKIP',
    signalEligible: agg.signalEligible,
    reason: agg.signalEligible
      ? `Line1 ТМ 0.5 — P_dry=${agg.pDry}, consensus=${agg.consensusCount}/5`
      : agg.skipReason,
    pDry: agg.pDry,
    weightedSum: agg.weightedSum,
    consensusCount: agg.consensusCount,
    components,
    leagueBaseline: baseline,
    intensityRatio,
    intensityRatioLast,
    minute,
  };
}

module.exports = { evaluateLine1Dry };
```

- [ ] **Step 4: Додати потрібні константи (для імпорту в dryEngine)**

Тимчасово (повний список — у Task 11). Додати в кінець `src/helpers/constants.js`:

```javascript
const LINE1_DECISION_MIN = 60;
const LINE1_DECISION_MAX = 75;
```

І в `module.exports` додати: `LINE1_DECISION_MIN, LINE1_DECISION_MAX,`

- [ ] **Step 5: Запустити integration-тести — PASS**

```bash
node --test test/line1.dryEngine.integration.test.js
```

Expected: PASS всі 7 тестів.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/line1/dryEngine.js test/line1.dryEngine.integration.test.js src/helpers/constants.js
git commit -m "feat(line1): dryEngine — orchestrator усіх 4 шарів"
```

---

## Task 11: Повний набір LINE1_* констант

**Files:**
- Modify: `src/helpers/constants.js`

- [ ] **Step 1: Додати решту констант**

У `src/helpers/constants.js` знайти кінець файлу перед `module.exports`. Додати:

```javascript
// === Лінія 1: P_dry Consensus + Trajectory ===
const LINE1_ENABLED              = envBool(process.env.LINE1_ENABLED, false);
const LINE1_SHADOW_MODE          = envBool(process.env.LINE1_SHADOW_MODE, true);
const LINE1_MIN_CANDIDATE_MINUTE = envInt(process.env.LINE1_MIN_CANDIDATE_MINUTE, 45);
// LINE1_DECISION_MIN / LINE1_DECISION_MAX уже додані в Task 10
const LINE1_PDRY_THRESHOLD       = envFloat(process.env.LINE1_PDRY_THRESHOLD, 0.62);
const LINE1_CONSENSUS_REQUIRED   = envInt(process.env.LINE1_CONSENSUS_REQUIRED, 4);
const LINE1_TRAJECTORY_MIN       = envFloat(process.env.LINE1_TRAJECTORY_MIN, 0.4);
const LINE1_INTENSITY_RATIO_MAX  = envFloat(process.env.LINE1_INTENSITY_RATIO_MAX, 1.5);
const LINE1_BC_DELTA_MAX         = envInt(process.env.LINE1_BC_DELTA_MAX, 1);
const LINE1_TG_TAG               = process.env.LINE1_TG_TAG || 'Lin1';
```

Експортувати всі з `module.exports`. Знайти існуючий `module.exports` у файлі і додати:

```javascript
  LINE1_ENABLED,
  LINE1_SHADOW_MODE,
  LINE1_MIN_CANDIDATE_MINUTE,
  LINE1_DECISION_MIN,
  LINE1_DECISION_MAX,
  LINE1_PDRY_THRESHOLD,
  LINE1_CONSENSUS_REQUIRED,
  LINE1_TRAJECTORY_MIN,
  LINE1_INTENSITY_RATIO_MAX,
  LINE1_BC_DELTA_MAX,
  LINE1_TG_TAG,
```

- [ ] **Step 2: Smoke-тест імпорту**

```bash
node -e "console.log(require('./src/helpers/constants'))" | grep LINE1
```

Expected: побачити всі LINE1_* з дефолтними значеннями.

- [ ] **Step 3: Перевірити що всі тести працюють**

```bash
node --test test/*.test.js
```

Expected: усі тести PASS.

- [ ] **Step 4: Commit**

```bash
git add src/helpers/constants.js
git commit -m "feat(line1): додати LINE1_* константи"
```

---

## Task 12: shadowLogger — запис рішень Лінії 1

**Files:**
- Create: `src/pipeline/line1/shadowLogger.js`
- Create: `test/line1.shadowLogger.test.js`

- [ ] **Step 1: Написати тест**

Створити `test/line1.shadowLogger.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { appendShadowEntry, loadShadowEntries } = require('../src/pipeline/line1/shadowLogger');

test('appendShadowEntry/loadShadowEntries: round-trip у тимчасову директорію', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line1-shadow-'));
  process.env.LINE1_SHADOW_DIR_OVERRIDE = tmpDir;

  const date = '2026-04-30';
  const entry = {
    matchId: 'M1',
    league: 'Test',
    home: 'A',
    away: 'B',
    minute: 65,
    bet: 'UNDER_0_5',
    pDry: 0.71,
    components: { dry_1H: 0.6, dry_2H: 0.7, trajectory: 0.8, odds: 0.5, prematch: 0.6 },
    timestamp: '2026-04-30T19:00:00.000Z',
  };
  appendShadowEntry(date, entry);
  const loaded = loadShadowEntries(date);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].matchId, 'M1');
  assert.equal(loaded[0].pDry, 0.71);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LINE1_SHADOW_DIR_OVERRIDE;
});

test('appendShadowEntry: dedup по matchId+minute (overwrite)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line1-shadow-'));
  process.env.LINE1_SHADOW_DIR_OVERRIDE = tmpDir;
  const date = '2026-04-30';
  appendShadowEntry(date, { matchId: 'M1', minute: 65, pDry: 0.7, timestamp: 'T1' });
  appendShadowEntry(date, { matchId: 'M1', minute: 65, pDry: 0.75, timestamp: 'T2' });
  const loaded = loadShadowEntries(date);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].pDry, 0.75);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LINE1_SHADOW_DIR_OVERRIDE;
});
```

- [ ] **Step 2: FAIL**

```bash
node --test test/line1.shadowLogger.test.js
```

- [ ] **Step 3: Реалізувати**

Створити `src/pipeline/line1/shadowLogger.js`:

```javascript
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = path.join(__dirname, '..', '..', '..', 'data', 'logs');

function getDir(date) {
  const base = process.env.LINE1_SHADOW_DIR_OVERRIDE || DEFAULT_BASE;
  const dir = path.join(base, date);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFile(date) {
  return path.join(getDir(date), 'line1_shadow.json');
}

function loadShadowEntries(date) {
  const fp = getFile(date);
  if (!fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8')) || [];
  } catch {
    return [];
  }
}

function appendShadowEntry(date, entry) {
  const list = loadShadowEntries(date);
  const idx = list.findIndex((e) => e.matchId === entry.matchId && e.minute === entry.minute);
  if (idx === -1) {
    list.push(entry);
  } else {
    list[idx] = entry;
  }
  fs.writeFileSync(getFile(date), JSON.stringify(list, null, 2), 'utf8');
}

module.exports = { appendShadowEntry, loadShadowEntries };
```

- [ ] **Step 4: PASS**

```bash
node --test test/line1.shadowLogger.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/line1/shadowLogger.js test/line1.shadowLogger.test.js
git commit -m "feat(line1): shadowLogger — запис рішень у line1_shadow.json"
```

---

## Task 13: Інтеграція Лінії 1 у worker.js (shadow-mode)

**Files:**
- Modify: `worker.js`

- [ ] **Step 1: Прочитати поточну структуру worker.js**

```bash
grep -n "evaluateLiveModel\|appendMatchEntry\|features =" worker.js | head -20
```

Запам'ятай рядки де викликається `evaluateLiveModel` (модель v2/v3) і де викликається `appendMatchEntry` — Лінію 1 додаємо паралельно.

- [ ] **Step 2: Додати імпорти на початку worker.js**

Знайти блок require-ів (приблизно рядок 1-40) і додати після останнього import з pipeline:

```javascript
const { evaluateLine1Dry } = require('./src/pipeline/line1/dryEngine');
const { appendShadowEntry } = require('./src/pipeline/line1/shadowLogger');
const { LINE1_ENABLED, LINE1_SHADOW_MODE } = require('./src/helpers/constants');
const { sessionDateKey } = require('./src/helpers/date');
```

- [ ] **Step 3: Викликати Лінію 1 паралельно з v3**

Знайти блок де встановлюється `features` і викликається `evaluateLiveModel`. Додати після `evaluateLiveModel` (НЕ замінювати):

```javascript
      // === Лінія 1 (паралельно, shadow-mode за замовчуванням) ===
      if (LINE1_ENABLED) {
        try {
          const line1Result = evaluateLine1Dry({
            match,
            features,
            snapshots: history,
            incidents,
            preMatchAggregates: preMatchContext?.aggregates || null,
          });

          if (LINE1_SHADOW_MODE) {
            const date = sessionDateKey();
            appendShadowEntry(date, {
              matchId: match.id,
              league: match.league,
              home: match.home,
              away: match.away,
              minute: features.minute,
              bet: line1Result.bet,
              signalEligible: line1Result.signalEligible,
              pDry: line1Result.pDry,
              consensusCount: line1Result.consensusCount,
              components: line1Result.components,
              reason: line1Result.reason,
              intensityRatio: line1Result.intensityRatio,
              timestamp: new Date().toISOString(),
            });
            console.log(`  [Line1 shadow] ${match.home}-${match.away} ${features.minute}': bet=${line1Result.bet} pDry=${line1Result.pDry} (${line1Result.reason})`);
          }
          // Не-shadow режим — буде додано після calibration validation
        } catch (e) {
          console.log(`  [Line1] помилка: ${e.message}`);
        }
      }
```

- [ ] **Step 4: Smoke test — запустити один цикл локально**

```bash
LINE1_ENABLED=1 LIVE_IGNORE_HOURS=1 timeout 90 node -e "require('./worker.js')" 2>&1 | head -100
```

Expected: побачити рядки `[Line1 shadow] ...` для матчів з 0:0 на 60-75'. Якщо немає таких матчів — нормально, логів просто не буде.

- [ ] **Step 5: Перевірити що файл shadow-логу створюється (якщо були матчі)**

```bash
ls -la data/logs/$(date -u +"%Y-%m-%d")/ 2>/dev/null | grep line1
```

- [ ] **Step 6: Commit**

```bash
git add worker.js
git commit -m "feat(worker): Лінія 1 паралельно з v3 (shadow-mode)"
```

---

## Task 14: Включити LINE1_MIN_CANDIDATE_MINUTE у скрапер

**Files:**
- Modify: `worker.js` — місце фільтрації candidate minute

Поточний код фільтрує матчі за `LIVE_MIN_CANDIDATE_MINUTE=52` (з `scrapeLiveMatches`). Лінія 1 потребує матчів з 45'. Розширюємо нижню межу.

- [ ] **Step 1: Перевірити поточну фільтрацію**

```bash
grep -n "LIVE_MIN_CANDIDATE_MINUTE" worker.js src/scrapeLiveMatches.js src/providers/flashscoreMobileUa/liveSource.js
```

- [ ] **Step 2: Знизити мінімум якщо LINE1_ENABLED**

У `worker.js` знайти місце де інстанціюється скрапер чи фільтр. Якщо немає динаміки — додати логіку.

Знайти ділянку перед `scrapeLiveMatches(page)`:

```javascript
  const { matches: allMatches, nearestSkippedMinute } = await scrapeLiveMatches(page);
```

Замінити на:

```javascript
  const minCandMinute = LINE1_ENABLED
    ? Math.min(45, require('./src/helpers/constants').LIVE_MIN_CANDIDATE_MINUTE)
    : require('./src/helpers/constants').LIVE_MIN_CANDIDATE_MINUTE;
  const { matches: allMatches, nearestSkippedMinute } = await scrapeLiveMatches(page, { minMinute: minCandMinute });
```

(Передаємо опцію якщо `scrapeLiveMatches` її приймає; якщо ні — Step 3 додасть.)

- [ ] **Step 3: Додати опцію minMinute в scrapeLiveMatches**

У `src/scrapeLiveMatches.js` знайти сигнатуру:

```javascript
async function scrapeLiveMatches(page) {
```

Замінити на:

```javascript
async function scrapeLiveMatches(page, options = {}) {
  const minMinute = Number.isFinite(options.minMinute) ? options.minMinute : LIVE_MIN_CANDIDATE_MINUTE;
```

Передати `minMinute` у `collectLiveMatches(page, url, minMinute)`. Перевірити сигнатуру `collectLiveMatches`:

```bash
grep -n "function collectLiveMatches\|module.exports" src/providers/flashscoreMobileUa/liveSource.js
```

Якщо `collectLiveMatches` не приймає minMinute — додати її там аналогічно (замість константи).

- [ ] **Step 4: Smoke test — підтвердити що 45-50' матчі тепер відбираються**

```bash
LINE1_ENABLED=1 LIVE_IGNORE_HOURS=1 timeout 60 node -e "
const scrape = require('./src/scrapeLiveMatches');
const { launchBrowser, pickUserAgent } = require('./src/browser');
(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(pickUserAgent());
  const r = await scrape(page, { minMinute: 45 });
  console.log('matches:', r.matches.length, 'minutes:', r.matches.map(m => m.minute).sort());
  await browser.close();
})();
" 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add worker.js src/scrapeLiveMatches.js src/providers/flashscoreMobileUa/liveSource.js
git commit -m "feat(line1): знизити LIVE_MIN_CANDIDATE_MINUTE до 45 коли LINE1_ENABLED"
```

---

## Task 15: shadowReportLine1 — денний звіт shadow-режиму

**Files:**
- Create: `scripts/shadowReportLine1.js`

- [ ] **Step 1: Реалізувати скрипт**

Створити `scripts/shadowReportLine1.js`:

```javascript
#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { loadShadowEntries } = require('../src/pipeline/line1/shadowLogger');
const { loadDayMatches } = require('../src/pipeline/dailyLogger');
const { sessionDateKey, yesterday } = require('../src/helpers/date');

const argv = process.argv.slice(2);
const date = argv[0] || sessionDateKey(yesterday());

const shadow = loadShadowEntries(date);
if (shadow.length === 0) {
  console.log(`No Line1 shadow entries for ${date}`);
  process.exit(0);
}

const dayMatches = loadDayMatches(date);
const finalScoreById = new Map();
for (const m of dayMatches) {
  if (m.matchId && m.finalScore) {
    finalScoreById.set(m.matchId, m.finalScore);
  }
}

const signalEntries = shadow.filter((e) => e.signalEligible && e.bet === 'UNDER_0_5');
let resolved = 0, hits = 0, misses = 0, unresolved = 0;
for (const e of signalEntries) {
  const fs = finalScoreById.get(e.matchId);
  if (!fs) { unresolved++; continue; }
  // UNDER 0.5 на залишок матчу: win якщо total голів після e.minute не змінився від рахунку 0:0 → final 0:0
  const isWin = String(fs.home) === '0' && String(fs.away) === '0';
  resolved++;
  if (isWin) hits++; else misses++;
}

const hr = resolved > 0 ? (hits / resolved) : null;

console.log(`=== Line1 shadow report ${date} ===`);
console.log(`Total shadow entries: ${shadow.length}`);
console.log(`Signal-eligible (UNDER_0_5): ${signalEntries.length}`);
console.log(`Resolved: ${resolved} (hits=${hits}, misses=${misses}, unresolved=${unresolved})`);
console.log(`HR: ${hr == null ? 'n/a' : (hr * 100).toFixed(1) + '%'}`);

// Розподіл P_dry
const buckets = { '0.62-0.65': 0, '0.65-0.70': 0, '0.70-0.75': 0, '0.75+': 0 };
for (const e of signalEntries) {
  if (e.pDry < 0.65) buckets['0.62-0.65']++;
  else if (e.pDry < 0.70) buckets['0.65-0.70']++;
  else if (e.pDry < 0.75) buckets['0.70-0.75']++;
  else buckets['0.75+']++;
}
console.log('P_dry distribution:', buckets);
```

- [ ] **Step 2: Smoke-тест на існуючий день (немає shadow → no-op)**

```bash
node scripts/shadowReportLine1.js 2026-04-29
```

Expected: `No Line1 shadow entries for 2026-04-29`.

- [ ] **Step 3: Додати npm-скрипт у package.json**

Знайти блок `"scripts"` у `package.json`. Додати:

```json
    "line1:shadow-report": "node scripts/shadowReportLine1.js",
```

(Перед `"test":`).

- [ ] **Step 4: Commit**

```bash
git add scripts/shadowReportLine1.js package.json
git commit -m "feat(line1): shadowReportLine1.js — денний звіт shadow-режиму"
```

---

## Task 16: calibrateLine1 — backtest на історичних даних

**Files:**
- Create: `scripts/calibrateLine1.js`

- [ ] **Step 1: Реалізувати backtest-скрипт**

Створити `scripts/calibrateLine1.js`:

```javascript
#!/usr/bin/env node
'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { evaluateLine1Dry } = require('../src/pipeline/line1/dryEngine');

const argv = process.argv.slice(2);
const validateOnly = argv.includes('--validate-only');
const verbose = argv.includes('--verbose');

const HISTORICAL_RAW_DIR = path.join(__dirname, '..', 'data', 'historical', 'raw');
const LIVE_LOGS_DIR      = path.join(__dirname, '..', 'data', 'logs');

/**
 * Збирає кандидатів з історичних логів: матчі що були 0:0 на 50' з потрібними stats.
 * Поточні логи (data/logs/{date}/matches.json) мають snapshotHistoryV2, але ми не маємо
 * raw1H у них. Тому спочатку виводимо лише структурний backtest на тих що є.
 *
 * Цей скрипт — заготовка. Перший прогін без 1H — використовує rawOverall - raw2H як оцінку 1H
 * (наближення для калібрування ваг).
 */
function listLogDates() {
  if (!fs.existsSync(LIVE_LOGS_DIR)) return [];
  return fs.readdirSync(LIVE_LOGS_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

function loadDayMatchesRaw(date) {
  const fp = path.join(LIVE_LOGS_DIR, date, 'matches.json');
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) || []; } catch { return []; }
}

const dates = listLogDates();
console.log(`Found ${dates.length} log dates`);

const candidates = [];
for (const d of dates) {
  const matches = loadDayMatchesRaw(d);
  for (const m of matches) {
    if (!m.matchId || !m.finalScore) continue;
    if (!Array.isArray(m.snapshotHistoryV2) || m.snapshotHistoryV2.length < 2) continue;
    // 0:0 at 50' — шукаємо перший snapshot з minute≈50
    const snapAt50 = m.snapshotHistoryV2.find((s) => s.matchMinute >= 48 && s.matchMinute <= 55);
    if (!snapAt50) continue;
    if (!snapAt50.score || String(snapAt50.score.home) !== '0' || String(snapAt50.score.away) !== '0') continue;
    candidates.push({ date: d, match: m, snapAt50 });
  }
}
console.log(`Candidates 0:0 at 48-55': ${candidates.length}`);

let signals = 0, hits = 0, misses = 0;
for (const c of candidates) {
  // Аппроксимація raw1H: snapAt50.raw2H близький до нуля → 1H = stats[overall_at_50] - 0.
  // Тут у нас немає overall_at_50 — це обмеження. Тимчасово: raw1H ≈ raw2H * (45/5) як stub.
  // ПРИМІТКА: повна калібровка вимагає re-scrape з 1H stats. Це placeholder.
  const raw1H = { ...c.snapAt50.raw2H };
  const features = {
    matchId: c.match.matchId,
    league: c.match.league,
    minute: c.snapAt50.matchMinute,
    raw1H,
    raw2H: c.snapAt50.raw2H,
    rawOverall: c.snapAt50.raw2H,
    odds1X2: c.match.prediction?.odds1X2 || null,
    statsStatus: 'overall_only',
  };
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features,
    snapshots: c.match.snapshotHistoryV2 || [],
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    preMatchAggregates: c.match.preMatchV3?.aggregates || null,
  });

  if (result.bet === 'UNDER_0_5' && result.signalEligible) {
    signals++;
    const fs = c.match.finalScore;
    const isWin = String(fs.home) === '0' && String(fs.away) === '0';
    if (isWin) hits++; else misses++;
    if (verbose) {
      console.log(`  [${c.date}] ${c.match.home} - ${c.match.away}: pDry=${result.pDry} → ${isWin ? 'HIT' : 'MISS'} (final ${fs.home}:${fs.away})`);
    }
  }
}

const hr = signals > 0 ? (hits / signals) : null;
console.log(`\n=== Backtest results ===`);
console.log(`Candidates: ${candidates.length}`);
console.log(`Line1 signals: ${signals}`);
console.log(`Hits: ${hits}, Misses: ${misses}`);
console.log(`HR: ${hr == null ? 'n/a' : (hr * 100).toFixed(1) + '%'}`);
console.log(`Recall (signals/candidates): ${candidates.length > 0 ? ((signals / candidates.length) * 100).toFixed(1) + '%' : 'n/a'}`);

if (validateOnly) {
  console.log('\n[validate-only] Не змінюємо ваги.');
  process.exit(0);
}

console.log('\nNote: Цей backtest — приблизний (raw1H aproximated). Точне калібрування вимагає');
console.log('re-scrape історичних матчів з окремим 1H endpoint. Запусти `npm run line1:rescrape-1h` (Task 17+).');
```

Зробити виконуваним:

```bash
chmod +x scripts/calibrateLine1.js
```

- [ ] **Step 2: Запустити validate-only режим**

```bash
node scripts/calibrateLine1.js --validate-only
```

Expected: вивід кількості кандидатів і HR (можливо n/a або низький — це baseline для подальшого improvement).

- [ ] **Step 3: Додати npm-скрипт**

У `package.json` `"scripts"` додати:

```json
    "line1:calibrate": "node scripts/calibrateLine1.js",
    "line1:calibrate:verbose": "node scripts/calibrateLine1.js --verbose",
```

- [ ] **Step 4: Commit**

```bash
git add scripts/calibrateLine1.js package.json
git commit -m "feat(line1): calibrateLine1.js — preliminary backtest на існуючих логах"
```

---

## Task 17: README + dev-docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Додати секцію про Лінію 1**

Прочитати поточний `README.md`. Додати в кінець:

```markdown

---

## Лінія 1 (v3.3) — P_dry Consensus + Trajectory

Окрема стратегія ТМ 0.5 з раннім моніторингом 1H→2H. Працює паралельно з v3.

**Умови шдо за замовчуванням вимкнено:**
- `LINE1_ENABLED=1` — увімкнути
- `LINE1_SHADOW_MODE=1` — за замовч. shadow (тільки логи, без TG)

**Команди:**
- `npm run line1:calibrate` — backtest на існуючих логах
- `npm run line1:shadow-report -- 2026-04-30` — звіт shadow за дату

**Документація:**
- Спек: `docs/superpowers/specs/2026-04-30-line1-pdry-consensus-trajectory-design.md`
- План: `docs/superpowers/plans/2026-04-30-line1-pdry-consensus-trajectory.md`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(line1): додати секцію Лінія 1 у README"
```

---

## Task 18: End-to-end smoke test з реальним матчем

**Files:** немає змін у файлах — тільки запуск.

- [ ] **Step 1: Запустити воркер з LINE1_ENABLED**

```bash
LINE1_ENABLED=1 LINE1_SHADOW_MODE=1 LIVE_IGNORE_HOURS=1 npm run live:watch:v3 2>&1 | tee /tmp/line1-smoke.log &
SMOKE_PID=$!
sleep 180
kill $SMOKE_PID 2>/dev/null
```

- [ ] **Step 2: Перевірити що Лінія 1 пише shadow-логи**

```bash
grep "Line1 shadow" /tmp/line1-smoke.log | head
ls -la data/logs/$(node -e "console.log(require('./src/helpers/date').sessionDateKey())")/line1_shadow.json 2>/dev/null
```

Expected: рядки `[Line1 shadow] ...` присутні І файл `line1_shadow.json` створено.

- [ ] **Step 3: Запустити shadow-report для сьогодні**

```bash
node scripts/shadowReportLine1.js $(node -e "console.log(require('./src/helpers/date').sessionDateKey())")
```

Expected: вивід з лічильниками shadow entries / signal-eligible / HR.

- [ ] **Step 4: Перевірити що тести все ще проходять**

```bash
node --test test/*.test.js
```

Expected: усі тести PASS, нічого не зламано.

- [ ] **Step 5: Якщо все ОК — нічого комітити (smoke-тест read-only). Інакше — діагностувати і виправити в окремих задачах.**

---

## Task 19: Очистити status TODO у спеку

**Files:**
- Modify: `docs/superpowers/specs/2026-04-30-line1-pdry-consensus-trajectory-design.md`

- [ ] **Step 1: Оновити статус**

У файлі `docs/superpowers/specs/2026-04-30-line1-pdry-consensus-trajectory-design.md` знайти:

```markdown
**Status:** дизайн затверджено в брейнсторм-сесії 2026-04-30. Очікує ревью спека перед переходом до writing-plans.
```

Замінити на:

```markdown
**Status:** реалізовано (shadow-mode) у v3.3. Дата імплементації: 2026-04-30+. План: `docs/superpowers/plans/2026-04-30-line1-pdry-consensus-trajectory.md`.

**Outstanding (для наступних ітерацій):**
- Re-scrape історичних матчів з 1H endpoint для повноцінного calibration
- Інтеграція реальних кф ТМ 0.5 з GGBet (зараз assumed)
- Активація з shadow → live після підтвердження HR ≥55% за 14 днів
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-30-line1-pdry-consensus-trajectory-design.md
git commit -m "docs(line1): оновити статус спека після імплементації"
```

---

## Task 20: Підсумок і перехід до calibration

**Files:** немає змін.

- [ ] **Step 1: Перевірити повний test suite**

```bash
node --test test/*.test.js 2>&1 | tail -20
```

Expected: всі тести (включно з line1.*) PASS.

- [ ] **Step 2: Огляд коммітів**

```bash
git log --oneline v3..v3.3
```

Expected: послідовність коммітів від `docs(line1): спек ...` до `docs(line1): оновити статус ...`.

- [ ] **Step 3: Документувати наступні кроки у комент. issues / TODO** (можна як коментар в README або docs)

Створити `docs/superpowers/plans/line1-next-steps.md`:

```markdown
# Лінія 1 — наступні кроки після shadow-rollout

## Тиждень 1 (shadow active)
- [ ] Запустити в продакшні з `LINE1_ENABLED=1 LINE1_SHADOW_MODE=1`
- [ ] Щоденно `npm run line1:shadow-report -- $(date +%Y-%m-%d)`
- [ ] Збирати ~7-14 днів даних

## Тиждень 2 (calibration з 1H stats)
- [ ] Реалізувати re-scrape історичних матчів з 1H endpoint
- [ ] Calibrate ваги через logistic regression
- [ ] Tune thresholds: P_dry, consensus, trajectory_min
- [ ] Update `LEAGUE_BASELINES` з calibrated значеннями

## Тиждень 3 (активація)
- [ ] Перевірити shadow HR ≥55% за останні 14 днів
- [ ] Якщо так: `LINE1_SHADOW_MODE=0` → активний TG
- [ ] Перші 7 днів — спостерігати щодня
- [ ] Метрика: HR (rolling 14d) ≥60% — зберігаємо; <55% — повертаємо в shadow
```

- [ ] **Step 4: Commit фінального документу**

```bash
git add docs/superpowers/plans/line1-next-steps.md
git commit -m "docs(line1): план наступних кроків після shadow-rollout"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Шар 1 (pace normalization) → Task 4
- ✅ Шар 2 (5 dry_score) → Tasks 5, 6
- ✅ Шар 3 (consensus aggregator) → Task 8 + leagueBaselines у Task 7
- ✅ Шар 4 (hard gates) → Task 9
- ✅ Engine orchestrator → Task 10
- ✅ Калібрування backtest → Task 16 (preliminary)
- ✅ Shadow-rollout → Tasks 12, 13
- ✅ Worker integration → Tasks 13, 14
- ✅ Constants (LINE1_*) → Task 11
- ✅ Інтеграційні тести → Task 10
- ✅ Smoke test → Task 18
- ✅ Документація → Tasks 17, 19, 20
- ⚠️ DangerousAttacks proxy через touchesInOppositionBox — згадано у hardGates (через intensityRatioLast.touchesInOppositionBox може бути перевірено окремо в наступній ітерації; зараз — через xG)
- ⚠️ Real GGBet odds — НЕ реалізовано в цьому плані; це окрема задача (винесена в Task 19 outstanding)

**Placeholder scan:** Один свідомий placeholder у Task 16: `raw1H aproximated через snapshot raw2H` — це експліцитно задокументовано як обмеження preliminary backtest. Повна калібровка потребує re-scrape історії з 1H endpoint, що винесено у line1-next-steps.

**Type consistency:**
- `evaluateLine1Dry({ match, features, snapshots, incidents, preMatchAggregates })` — узгоджено між Task 10 (definition), Task 13 (call site)
- `aggregatePDry({ components, leagueBaseline, snapshotsCount })` — Task 8 → Task 10
- Назви компонентів: `dry_1H, dry_2H, trajectory, odds, prematch` — узгоджені скрізь
- `appendShadowEntry(date, entry)` — Task 12 → Task 13

**Готовий до execution.**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-line1-pdry-consensus-trajectory.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Я диспатчу свіжий subagent на кожну задачу, ревьюю між задачами, швидка ітерація. Кращий для багатоетапної роботи з checkpoint-ами.

**2. Inline Execution** — Виконуємо задачі в цій сесії через executing-plans, batch execution з checkpoint-ами для ревью.

Який підхід?
