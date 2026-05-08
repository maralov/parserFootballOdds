# План закриття пробілів моделі прогнозів (RFC alignment)

**Статус:** ✅ Реалізовано (Tasks 1–9), 140/140 тестів зелені
**Гілка:** v4
**Базовий аудит:** див. чат "перевір чи реалізована модель прогнозів"
**Базовий комміт:** `87bc966` → HEAD `d440353`

## Послідовність комітів (20)

`59c16cb` → `b070d97` → `a4f1909` (Task 1) → `fcaf020` → `dc9ba6a` → `c7da087` (Task 2) → `be579dc` → `9329255` (Task 3) → `f4df815` → `ae2370f` (Task 4) → `98af847` → `e787729` (Task 5) → `c328639` → `cd28e69` (Task 6) → `2e07ee8` → `0df9ba7` → `428fdbe` (Task 7) → `81de2f3` → `1e86256` (Task 8) → `d440353` (Task 9).

## Відомі follow-up'и (не блокують)

1. **Adaptation note для Task 7**: `isPremiumAiSignal` працює зі схемою AI decision60 (`match_state ∈ {dead, low_activity, …}`, `favorite_pressure ∈ {none, weak, …}`), а не RFC-фрагмент-теоретичний `{sterile_possession, fake_pressure}` — реалізація узгоджена з фактичною схемою AI відповіді (`src/ai/schemas/decision60Schema.js`).
2. **`useInTelegram` vs `appendSignalsIfEligible`**: `useInTelegram` може бути `true` для `FT_TM05_RISK` з `confidence ≥ 0.70`, але `runLivePrediction.appendSignalsIfEligible` додає в `prediction-signals.json` лише `actionable`. Це навмисно: `useInTelegram` — це індикатор «прогноз досить упевнений для Telegram», а лог сигналів — лише «торговий» рівень. У майбутніх tasks можна: (а) узгодити логи з `useInTelegram`, або (б) внести різницю в Telegram-формат повідомлення.
3. **DRY `classifyTrend6075` / `classifyTrend7080`**: можна винести спільний core `classifyActivityTrend(lastWin, prevWin, statsLevel)` — мінорний рефакторинг.

Закриває розриви між поточною реалізацією (`src/computed/*`, `src/prediction/*`,
`src/ai/*`) і RFC-планом моделі (Decision 60–75 = FT TM0.5; Decision 80+ = TB0.5).

Канонічна термінологія (як у RFC): `Decision 60–75 = прогноз на фінальний 0:0`,
`Decision 80+ = прогноз на гол після 80'`. Ці лінії — **протилежні**: якщо
видається сильний FT TM05 у вікні 60–75 — TB80+ блокується через `predictionLocks`.

---

## Загальний підхід

- Гілка `v4` (поточна), всі завдання — інкрементальні комміти.
- Кожне завдання обмежене файлами 1–3 файла + тести (`test/*.test.js`).
- Усі формули спершу пишуться як **чисті функції** (легко тестувати).
- Викликаються з `updateComputed()` → `evaluateDecision60/80` → `runLivePrediction`.
- На кожен етап — Node.js test (вбудовані `node:test` + `node:assert/strict`).
- AI overlay не змінює AI orchestrator — overlay вмикається в `evaluateDecision60`
  і читає з `match.aiAnalysis.decision60.output`.

## Послідовність завдань

| # | Назва | Файли | Залежності |
|---|---|---|---|
| 1 | Профіль 1H (прапорці) + missing windows + TB upper bound | `firstHalfProfile.js`, `windows.js`, `runLivePrediction.js`, `prediction.test.js` | — |
| 2 | Pressure scores (real/fake) refactor | `modelScoresRaw.js`, `prediction.test.js` | 1 |
| 3 | Detailed `dryStateScore` + activity-based `tempoTrend` | `modelScoresRaw.js`, `ftTmModelSignals.js`, `prediction.test.js` | 2 |
| 4 | `lateActivationRisk` + `fullTimeNilNilScore` per RFC | `modelScoresRaw.js` (нові pure-функції), `ftTmModelSignals.js` (інтеграція), `prediction.test.js` | 3 |
| 5 | TB80+ `lateGoalScore80` повна формула | `modelScoresRaw.js`, `ftTmModelSignals.js` (новий `classifyTrend7080`), `updateComputed.js`, `prediction.test.js` | 1 |
| 6 | Hard NO_BET filters в decision60 | `evaluateDecision60.js`, `prediction.test.js` | 4 |
| 7 | **AI overlay (CRITICAL)** + `mode='detailed_ai'` | `prediction/aiOverlay.js` (new), `evaluateDecision60.js`, `prediction.test.js` | 6 |
| 8 | Confidence штрафи + caps + `mode/useInTelegram/useInBacktest` у predictions | `confidence.js`, `evaluateDecision60.js`, `evaluateDecision80.js`, `prediction.test.js` | 7 |
| 9 | Розширений backtest (bands, leagues, statsLevel, riskFlags) | `scripts/predictionReplay.js` | 8 |

---

## Task 1 — `firstHalfProfile` flags + missing windows + TB upper bound

### Що робимо

`src/computed/firstHalfProfile.js`: розширити повернений об'єкт:
- додати числові: `totalShots1H`, `totalBlockedShots1H`
- додати булеві:
  - `isDryFirstHalf` (detailed: `xg<=0.55 && sot<=2 && bigChances===0 && xgot<=0.35`;
    basic: `sot<=2 && shots<=7 && corners<=5`)
  - `isHotButNoGoal` (detailed: `xg>=1.0 || xgot>=0.8 || bigChances>=1 || sot>=4 || saves>=3`)
  - `isFakePressure1H` (detailed: `corners>=6 && sot<=1 && xg<=0.45 && xgot<=0.2 && bigChances===0`)
  - `isHighQualityNoGoal` (detailed: `bigChances>=1 || (xg>=0.8 && sot>=3) || xgot>=0.7`)
- старі поля (`totalXg`, `totalXgot`, `totalShotsOnTarget`, `totalBigChances`,
  `totalCorners`, `totalGoalkeeperSaves`, `totalTouchesInOppositionBox`,
  `totalShotsInsideBox`) — лишити для зворотної сумісності.

`src/computed/windows.js`: додати в `buildAllWindows`:
```js
window55_60: buildWindow(snapshots, 55, 60),
window80_85: buildWindow(snapshots, 80, 85),
window80_90: buildWindow(snapshots, 80, 90),
```

`src/prediction/runLivePrediction.js`: змінити верхню межу для decision80
з `<=88` на `<=90`.

`src/computed/ftTmModelSignals.js`: `hotHalfNoGoal1H` має зчитувати
`profile.isHotButNoGoal` (якщо доступно), залишивши власне обчислення як fallback.

### Тести (`test/prediction.test.js`)

- `buildFirstHalfProfile`: detailed dry + detailed hot + detailed fake + basic dry
- `buildAllWindows` повертає `window55_60`, `window80_85`, `window80_90` з коректними дельтами
- `evaluateDecision80` приймає minute=90 (через `runLivePrediction`)

---

## Task 2 — Refactor `calculateRealPressureScore` + `calculateFakePressureScore`

### Що робимо

`src/computed/modelScoresRaw.js`:

#### `calculateRealPressureScore(totals, { mode = 'detailed' | 'basic' })`

```js
// detailed
score = totalShots*4 + sot*18 + xg*35 + xgot*30 + bc*22 + sib*8 + tbox*2 + saves*10
// basic
score = totalShots*6 + sot*22 + corners*4
```
Clamp `0..100`. `mode` приходить з `match.statsLevel`.

#### `calculateFakePressureScore(totals, { mode = 'detailed' | 'basic' })`

```js
// detailed (per RFC)
+18 if (corners >= 2 && sot === 0)
+14 if (crossesAttempted >= 8 && crossesMade <= 2)
+10 if (blockedShots >= 2 && sot === 0)        // НОВЕ
+18 if (xg < 0.08 && corners >= 2)
+15 if (xgot === 0)
+10 if (sib <= 1)
+10 if (bigChances === 0)
+10 if (tbox <= 4)

// basic
+25 if (corners >= 2 && sot === 0)
+20 if (corners >= 3 && totalShots <= 1)
+10 if (totalShots > 0 && sot === 0)
```

Існуючі step-формули **видаляються повністю** (legacy не потрібен — нікому не споживається).
Усі споживачі (`updateComputed`, `ftTmModelSignals`) перейти на нові формули.

**Defensive nulls:** для detailed fake-pressure формули умови `xgot === 0`,
`bigChances === 0`, `sib <= 1`, `tbox <= 4`, `blockedShots >= 2` мають
**не спрацьовувати, коли поле фактично відсутнє** (бо `bundleWindowTotals` coerces
missing → 0). Використовувати `typeof field === 'number'` guard перед перевіркою умов.

### Тести

- 6 кейсів: detailed real (high/low), basic real (high/low), detailed fake (high/low/with blockedShots), basic fake.
- Перевірка clamp `0..100` на крайніх значеннях.

---

## Task 3 — Detailed `dryStateScore` + activity-based `tempoTrend`

### Що робимо

`src/computed/modelScoresRaw.js`:

#### `calculateDryStateScore({ sinceHt, tempoTrend, statsLevel })`

```js
// detailed (per RFC)
score = 50;
if (sinceHt.shotsOnTarget === 0) score += 14;
if (sinceHt.xg <= 0.12) score += 14;
if (sinceHt.xgot === 0) score += 12;
if (sinceHt.bigChances === 0) score += 12;
if (sinceHt.shotsInsideBox <= 1) score += 8;
if (sinceHt.touchesInBox <= 5) score += 8;
if (tempoTrend === 'flat') score += 8;
if (tempoTrend === 'falling') score += 12;
if (sinceHt.shotsOnTarget >= 1) score -= 18;
if (sinceHt.xg >= 0.20) score -= 20;
if (sinceHt.xgot > 0) score -= 18;
if (sinceHt.bigChances >= 1) score -= 25;
if (tempoTrend === 'growing') score -= 15;
if (tempoTrend === 'explosive') score -= 30;
clamp(0, 100);

// basic — RFC варіант (поверх sinceHt)
score = 50;
if (sinceHt.shotsOnTarget === 0) score += 18;
if (sinceHt.totalShots <= 2) score += 15;
if (sinceHt.corners <= 2) score += 6;
if (tempoTrend === 'flat') score += 8;
if (tempoTrend === 'falling') score += 12;
if (sinceHt.shotsOnTarget >= 1) score -= 22;
if (sinceHt.totalShots >= 5) score -= 18;
if (sinceHt.corners >= 4 && sinceHt.shotsOnTarget >= 1) score -= 10;
if (tempoTrend === 'growing') score -= 15;
if (tempoTrend === 'explosive') score -= 30;
```

Стара функція `calculateDrynessScoreForWindow(totals)` лишається — вона потрібна для
`updateComputed.dryScore60` (per-window dryness одного 45–60 вікна). Нова — для
глобального dryStateScore у `ftTmModelSignals`.

`src/computed/ftTmModelSignals.js`: замінити поточний усереднений `dryStateScore`
(`droughtScoreAcrossWindows` — видалити) на новий
`calculateDryStateScore({ sinceHt, tempoTrend6075, statsLevel })`.

#### `classifyTrend6075(windows, { statsLevel })` — activity-based

```js
function activityScore(t, statsLevel) {
  let s = (t.totalShots || 0) * 1
        + (t.shotsOnTarget || 0) * 3
        + (t.corners || 0) * 0.8
        + (t.xg || 0) * 8;
  if (statsLevel === 'detailed') {
    s += (t.xgot || 0) * 8
       + (t.bigChances || 0) * 5
       + (t.shotsInsideBox || 0) * 1.5
       + (t.touchesInBox || 0) * 0.3;
  }
  return s;
}

const last = activityScore(window70_75 || window65_70 || window60_65 || window45_60);
const prev = activityScore(window65_70 || window60_65 || window50_60 || window45_60);

if (last > prev * 2) return 'explosive';
if (last > prev * 1.3) return 'growing';
if (last <= prev * 0.75) return 'falling';
if (Math.abs(last - prev) <= 1.5) return 'flat';
return 'flat';
```

### Тести

- detailed dryStateScore: «глухий» матч (0 sot, 0 xg, 0 bc, flat) → score >= 95
- detailed dryStateScore: 1 big chance + sot → score < 25
- basic dryStateScore: те саме на shots/corners
- tempoTrend: explosive (last>2*prev), growing, flat, falling

---

## Task 4 — `lateActivationRisk` + `fullTimeNilNilScore`

### Що робимо

`src/computed/ftTmModelSignals.js` — повністю переписати ці два блоки.

#### `calculateLateActivationRisk({ firstHalfProfile, favorite, derived, marketSignal, tableSignal, tournamentImportance, realPressureScore50_60, realPressureScore60_70, tempoTrend, yellowCardsTotal, hasRedCard, isDryFirstHalf, fakePressureScore, realPressureScore })`

```js
let risk = 20; // RFC base

if (firstHalfProfile?.isHotButNoGoal) risk += 18;
if (favorite?.label === 'strong' /* and 0:0 */) risk += 12;
if (Math.abs(marketSignal || 0) > 0.4) risk += 8;
if (Math.abs(tableSignal || 0) > 0.45) risk += 8;
if ((tournamentImportance || 0) >= 3) risk += 10;
if (realPressureScore50_60 >= 35) risk += 10;
if (realPressureScore60_70 >= 35) risk += 12;
if (tempoTrend === 'growing') risk += 12;
if (tempoTrend === 'explosive') risk += 25;
if ((yellowCardsTotal || 0) >= 4) risk += 8;
if (hasRedCard) risk += 30;
// бонуси
if (isDryFirstHalf && dryStateScore >= 78 && realPressureScore < 30) risk -= 10;
if (fakePressureScore >= 60 && realPressureScore < 30) risk -= 5;

clamp(0, 100);
```

`tournamentImportance` беремо з `match.aiAnalysis.halftime.output.match_context.tournament_importance_home/away` (max).

#### `calculateFullTimeNilNilScore({ dryStateScore, realPressureScore, lateActivationRisk, isDryFirstHalf, isHotButNoGoal, fakePressureScore, dataQualityScore })`

```js
const noRealPressure = 100 - realPressureScore;
const noLateActivation = 100 - lateActivationRisk;
const firstHalfDryness = isDryFirstHalf ? 85 : isHotButNoGoal ? 25 : 55;
const sterilePressure = (fakePressureScore >= 45 && realPressureScore < 35) ? 75 : 50;

const score =
  dryStateScore * 0.30 +
  noRealPressure * 0.25 +
  noLateActivation * 0.25 +
  firstHalfDryness * 0.10 +
  sterilePressure * 0.05 +
  dataQualityScore * 0.05;

return clamp(score, 0, 100);
```

`dataQualityScore`:
```js
if (statsLevel === 'detailed' && hasXg && hasXgot) 90;
else if (statsLevel === 'detailed' && hasXg) 80;
else if (statsLevel === 'basic') 60;
else 45;
```

Зберегти `chaosRisk`/`favoriteDesperationRisk` як окремі ризики, але **не**
включати в формулу `fullTimeNilNilScore` напряму — вони залишаються гейтами в
`evaluateDecision60` (chaos_cards riskFlag, favorite_siege_risk).

### Тести

- lateActivationRisk: чистий dry → ~10–20; hot1h+strong fav → 50+; redCard → 50+
- fullTimeNilNilScore: dry+detailed → ≥80; hot1h+real pressure → <55

---

## Task 5 — TB80+ `lateGoalScore80` per RFC

### Що робимо

`src/computed/modelScoresRaw.js`:

```js
function calculateLateGoalScore80(totals, ctx = {}) {
  const { realPressureScore70_80, fakePressureScore70_80, tempoTrend70_80 } = ctx;
  let score = 30;
  if ((realPressureScore70_80 || 0) >= 45) score += 20;
  if ((totals.shotsOnTarget || 0) >= 1) score += 18;
  if (totals.xg != null && totals.xg >= 0.15) score += 15;
  if ((totals.xgot || 0) > 0) score += 15;
  if ((totals.bigChances || 0) >= 1) score += 18;
  if ((totals.shotsInsideBox || 0) >= 2) score += 8;
  if ((totals.corners || 0) >= 2 && (totals.shotsOnTarget || 0) >= 1) score += 6;
  if (tempoTrend70_80 === 'growing') score += 10;
  if (tempoTrend70_80 === 'explosive') score += 20;
  if ((fakePressureScore70_80 || 0) >= 65) score -= 18;
  if ((realPressureScore70_80 || 0) < 30) score -= 15;
  if ((totals.shotsOnTarget || 0) === 0 && (totals.xgot || 0) === 0) score -= 20;
  return clamp(score, 0, 100);
}
```

`src/computed/updateComputed.js`: передати `realPressureScore70_80`,
`fakePressureScore70_80`, `tempoTrend70_80` (новий — той самий activity-based, з вікнами 70_75, 75_80) у виклик.

### Тести

- сильний real7080 + sot + bc → score ≥ 80
- fake7080 (corners >= 2, sot=0) + low real → score ≤ 30
- tempoTrend explosive → +20

---

## Task 6 — Hard NO_BET filters в decision60

### Що робимо

`src/prediction/evaluateDecision60.js`: явні гейти на самому початку (після `redCard`):

```js
if (computed.modelSignals.lateActivationRisk >= 60) {
  predictionType = 'NO_BET';
  reasons.push('late_activation_risk_too_high');
  riskFlags.push('late_activation_signs');
} else if (computed.modelScoresRaw.realPressureScore60 >= 60) {
  predictionType = 'NO_BET';
  reasons.push('real_pressure_too_high');
  riskFlags.push('late_activation_signs');
}
```

(додатково до існуючого `tempoBad`, `trackedHard`, `redBlocked`).

### Тести

- realPressure60 = 65 → NO_BET, reason `real_pressure_too_high`
- lateActivationRisk = 65 → NO_BET, reason `late_activation_risk_too_high`

---

## Task 7 — AI overlay (CRITICAL)

### Що робимо

Новий модуль `src/prediction/aiOverlay.js`:

```js
const AI_SCENARIO_SCORE = {
  dead: 100, low_activity: 90, sterile_possession: 82, fake_pressure: 75,
  balanced: 55, pressure_building: 30, late_siege: 15, chaotic: 10,
};
const AI_PRESSURE_SCORE = { none: 100, fake: 80, mixed: 45, real: 15 };
const AI_LATE_RISK_SCORE = { low: 100, medium: 55, high: 15 };

function pickScenario(aiOutput) {
  // RFC передбачає: scenario, pressureQuality, lateActivationRisk
  // Але реальний AI повертає decision60Schema:
  // match_state ∈ {dead, low_activity, balanced, pressure_building, high_pressure, chaotic}
  // favorite_pressure ∈ {none, weak, moderate, strong}  → mapping → {none, fake, mixed, real}
  // recommendation.action як підказка agreement
}

function computeAiScenarioScore(aiOutput) {
  const scenario = pickScenario(aiOutput);
  const pressureQuality = pickPressureQuality(aiOutput);
  const lateRisk = pickLateRisk(aiOutput);
  return AI_SCENARIO_SCORE[scenario] * 0.45
       + AI_PRESSURE_SCORE[pressureQuality] * 0.35
       + AI_LATE_RISK_SCORE[lateRisk] * 0.20;
}

function computeAgreementAdjustment(aiOutput, ruleType) {
  // ruleType: FT_TM05_FROM_60_75 / LEAN / RISK / NO_BET
  // aiOutput.recommendation.action: under_candidate / lean_under / no_bet / lean_goal / goal_candidate
  // Мапа agreement: strong_agree=8, agree=4, neutral=0, disagree=-8, strong_disagree=-15
  // clamp(-10, +10) per RFC
}

function applyAiOverlay({ ruleScore, aiOutput, aiConfidence, agreementAdj }) {
  const aiWeight = aiConfidence >= 0.75 ? 0.20 : aiConfidence >= 0.65 ? 0.15 : 0.10;
  const aiScenarioScore = computeAiScenarioScore(aiOutput);
  const final = ruleScore * (1 - aiWeight) + aiScenarioScore * aiWeight + agreementAdj;
  return { aiWeight, aiScenarioScore, finalScore: clamp(final, 0, 100) };
}

function isPremiumAiSignal({ finalScore, ruleScore, aiOutput, aiConfidence, riskFlags }) {
  const scenario = pickScenario(aiOutput);
  const pressureQuality = pickPressureQuality(aiOutput);
  const lateRisk = pickLateRisk(aiOutput);
  return finalScore >= 82
    && ruleScore >= 76
    && aiConfidence >= 0.65
    && ['dead', 'low_activity', 'sterile_possession', 'fake_pressure'].includes(scenario)
    && ['none', 'fake'].includes(pressureQuality)
    && lateRisk !== 'high'
    && !riskFlags.includes('red_card')
    && !riskFlags.includes('real_pressure')
    && !riskFlags.includes('late_activation_signs');
}
```

`src/prediction/evaluateDecision60.js`:
- Після обчислення rule-based `predictionType` + `ftScore`, якщо
  `match.aiAnalysis?.decision60?.useInModel === true` і `output` валідний:
  - застосувати overlay → `finalScore` = AI-адаптований
  - `mode = 'detailed_ai'` (statsLevel='detailed' + AI use)
  - якщо `isPremiumAiSignal === true` AND rule-based predictionType ∈ {LEAN_FT_TM05_FROM_60_75, FT_TM05_RISK} → upgrade до `FT_TM05_FROM_60_75` premium
  - якщо `isPremiumAiSignal === false` AND rule-based predictionType === FT_TM05_FROM_60_75 AND agreement = strong_disagree → downgrade до LEAN
- Записати в `result.components`: `aiScenarioScore`, `aiAgreementAdjustment`, `aiWeight`, `finalScore` (post-AI), `ruleScore`.

### Тести

- AI strong_agree (dead+none+low) + ruleScore=78 → finalScore > ruleScore
- AI strong_disagree (chaotic+real+high) + ruleScore=78 → finalScore < ruleScore − 10
- AI use=false → overlay не застосовується, mode='detailed'
- isPremiumAiSignal upgrade lean → primary

---

## Task 8 — Confidence штрафи + caps + predictions shape

### Що робимо

`src/prediction/confidence.js`: додати explicit penalties:

```js
function buildConfidence({
  finalScore, activationThreshold, dataQuality, reasonsCount,
  lateActivationRisk, realPressureScore, isHotButNoGoal, hasRedCard,
  statsLevel, lowSnapshotCount, modelMode,
}) {
  // base формула як зараз
  let base = 0.45 + thresholdDistance*0.25 + dataQuality*0.20 + reasonsStrength*0.10;

  // RFC penalties
  if (lateActivationRisk > 40) base -= 0.08;
  if (realPressureScore > 40) base -= 0.08;
  if (isHotButNoGoal) base -= 0.08;
  if (hasRedCard) base -= 0.20;
  if (statsLevel === 'basic') base -= 0.06;
  if (lowSnapshotCount) base -= 0.08;

  // caps по mode
  const cap = modelMode === 'basic' ? 0.68
    : modelMode === 'detailed' ? 0.82
    : 0.86; // detailed_ai

  return clamp(base, 0.35, cap);
}
```

`src/prediction/evaluateDecision60.js` + `evaluateDecision80.js`: розширити фінальний `result`:
```js
{
  ...,
  mode: 'basic' | 'detailed' | 'detailed_ai', // legacy alias modelMode зберегти
  useInTelegram: actionablePrimary || (predictionType !== 'NO_BET' && confidence >= 0.7),
  useInBacktest: predictionType !== 'NO_BET',
  ...
}
```

### Тести

- detailed cap = 0.82 (хочаб одна модель не перевищує)
- detailed_ai cap = 0.86
- basic cap = 0.68
- redCard penalty знижує confidence до ~0.35

---

## Task 9 — Розширений backtest

### Що робимо

`scripts/predictionReplay.js` повністю переписати з групуваннями:

```js
// Групування:
//   predictionType x mode x scoreBand x confidenceBand x league x statsLevel
// Score bands: <70 / 70–75 / 75–80 / 80–85 / 85+
// Confidence bands: 0.35–0.55 / 0.55–0.7 / 0.7–0.82 / 0.82+
// + окремий cut по riskFlags (агрегати: %hit при флагах vs без)

// Output:
{
  generatedAt,
  totals: { n, hits, hitRate },
  byPredictionType: { ... },
  byMode: { ... },
  byScoreBand: { ... },
  byConfidenceBand: { ... },
  byLeague: { ... },
  byStatsLevel: { ... },
  riskFlagImpact: { flag: { withN, withHit, withoutN, withoutHit } },
}
```

Без флагів `--xlsx` (не потрібно). Stdout JSON + опційно `--out=path/to/report.json`.

### Тести (опц.)

- Голосний smoke-test на синтетичному `matches.json` з 5 матчами

---

## Acceptance criteria для всього плану

1. Усі існуючі 73 тести продовжують проходити.
2. Додано ≥ 25 нових тестів (~3 на task).
3. `npm test` зелений.
4. `node scripts/predictionReplay.js` дає розширений звіт.
5. У `predictions.decision60.mode` хочаб у одному синтетичному кейсі стоїть `'detailed_ai'`.
6. AI overlay активується тільки коли `aiAnalysis.decision60.useInModel === true`.
