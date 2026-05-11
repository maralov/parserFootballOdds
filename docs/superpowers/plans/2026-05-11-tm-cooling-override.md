# TM 0.5 Cooling Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дозволити `decision60` віддавати TM 0.5 сигнал, коли матч охолоджується у вікні 60-75', навіть якщо ранні фази (45-60' / початок 60-70') були активні.

**Architecture:** Дві точкові правки у `src/prediction/evaluateDecision60.js`: (1) виключити `window45_60` з обчислення `rpHardMax`; (2) додати `cooling override`, який обходить обидва hard caps, коли `window70_75 < 15 AND window65_70 < 35`. Все інше (tempoBad, trackedHard, premium gates) лишається без змін. Аудит збагачується полем `coolingOverride` для пост-аналізу live-даних.

**Tech Stack:** Node.js, `node --test`, без додаткових залежностей.

**Спека:** `docs/superpowers/specs/2026-05-11-tm-cooling-override-design.md`

---

## File Structure

- **Modify:** `src/prediction/evaluateDecision60.js`
  - `rpHardMax` (рядки 127-133): прибрати `window45_60`.
  - Перед гейтами (рядок ~160): додати обчислення `cooling`.
  - Гейти `lateAct >= 60` і `rpHardMax >= 60`: додати `!cooling`.
  - `reasons`: додати `cooling_override_applied` при cooling-вході.
  - `finalizeReturn` / `predictionAudit.featuresSnapshot`: додати поле `coolingOverride`.
- **Modify:** `test/prediction.test.js`
  - Оновити існуючий тест `NO_BET on realPressureScore >= 60` — переконатись що `window45_60` сам по собі більше не валить.
  - Додати нові тести під cooling override (4 кейси: позитивний, негативний по window70_75, негативний по window65_70, не обходить tempoBad).

Нові файли не створюємо. Усі правки локалізовані в одному модулі і одному тестовому файлі.

---

## Task 1: Видалити `window45_60` з `rpHardMax`

**Files:**
- Modify: `src/prediction/evaluateDecision60.js:127-133`
- Modify: `test/prediction.test.js:115-139`

- [ ] **Step 1: Оновити існуючий тест, щоб довести нову поведінку**

У `test/prediction.test.js` знайди тест `evaluateDecision60 NO_BET on realPressureScore >= 60` (рядки 115-139). Заміни його тіло так, щоб `window45_60` був високий, а решта — низька, і очікувалось, що **NO_BET через rpHardMax більше не спрацьовує**:

```javascript
test('evaluateDecision60 NO_BET on realPressureScore >= 60', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 30,
      realPressureScores: { window45_60: 20, window60_70: 65 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert.ok(pred.reasons.includes('real_pressure_too_high'));
  assert.ok(pred.riskFlags.includes('late_activation_signs'));
});

test('evaluateDecision60 window45_60 alone no longer triggers rpHardMax', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 30,
      realPressureScores: { window45_60: 100, window60_70: 20, window65_70: 20, window70_75: 20, windowTracked6075: 20 },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(!pred.reasons.includes('real_pressure_too_high'));
});
```

(Перший тест — лишається як був, але переконатись, що бере `window60_70: 65`. Другий — новий, перевіряє що тільки `window45_60=100` більше не валить.)

- [ ] **Step 2: Запустити тести, переконатись що новий тест ФЕЙЛИТЬ**

Run: `node --test test/prediction.test.js`
Очікувано: тест `window45_60 alone no longer triggers rpHardMax` **fail** з `real_pressure_too_high` у reasons (бо `window45_60=100` усе ще в `rpHardMax`).

- [ ] **Step 3: Виправити `rpHardMax` у `evaluateDecision60.js`**

Файл `src/prediction/evaluateDecision60.js`, рядки 127-133. Замінити:

```javascript
const rpHardMax = Math.max(
  ms?.realPressureScores?.window45_60 ?? 0,
  ms?.realPressureScores?.window60_70 ?? 0,
  ms?.realPressureScores?.window65_70 ?? 0,
  ms?.realPressureScores?.window70_75 ?? 0,
  ms?.realPressureScores?.windowTracked6075 ?? 0,
);
```

на:

```javascript
const rpHardMax = Math.max(
  ms?.realPressureScores?.window60_70 ?? 0,
  ms?.realPressureScores?.window65_70 ?? 0,
  ms?.realPressureScores?.window70_75 ?? 0,
  ms?.realPressureScores?.windowTracked6075 ?? 0,
);
```

- [ ] **Step 4: Запустити тести — усі мають пройти**

Run: `node --test test/prediction.test.js`
Очікувано: PASS на всіх існуючих тестах + новому.

- [ ] **Step 5: Коміт**

```bash
git add src/prediction/evaluateDecision60.js test/prediction.test.js
git commit -m "feat(prediction): exclude window45_60 from rpHardMax in decision60

Far-past pressure window no longer triggers hard cap. window45_60 still
contributes via lateActivationRisk."
```

---

## Task 2: Додати Cooling Override

**Files:**
- Modify: `src/prediction/evaluateDecision60.js` (декларації змінних на ~рядку 119-133 і блок гейтів на ~160-176)
- Modify: `test/prediction.test.js`

- [ ] **Step 1: Написати тест на позитивний cooling override (GC3SHdo1 кейс)**

Додай у `test/prediction.test.js` (наприкінці блоку decision60-тестів, перед іншими групами):

```javascript
test('evaluateDecision60 cooling override bypasses lateActivationRisk hard cap', () => {
  const match = {
    matchId: 'm1',
    statsLevel: 'detailed',
    snapshots: [],
  };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window45_60: 100,
        window60_70: 57.7,
        window65_70: 31.85,
        window70_75: 6,
        windowTracked6075: 63.7,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 3 },
      tempoTrend6075: 'falling',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: true },
    snapshotCount: 6,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(!pred.reasons.includes('late_activation_risk_too_high'),
    'cooling override повинен зняти lateActivationRisk hard cap');
  assert.ok(!pred.reasons.includes('real_pressure_too_high'),
    'cooling override повинен зняти rpHardMax hard cap');
  assert.ok(pred.reasons.includes('cooling_override_applied'),
    'reasons має містити маркер cooling_override_applied');
});
```

- [ ] **Step 2: Написати тест на негативний кейс (window70_75 ≥ 15 → cooling НЕ спрацьовує)**

```javascript
test('evaluateDecision60 cooling override does not fire when window70_75 >= 15', () => {
  const match = { matchId: 'm1', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window60_70: 57.7,
        window65_70: 30,
        window70_75: 20,
        windowTracked6075: 50,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(pred.reasons.includes('late_activation_risk_too_high'));
  assert.ok(!pred.reasons.includes('cooling_override_applied'));
});
```

- [ ] **Step 3: Написати тест на негативний кейс (window65_70 ≥ 35 → cooling НЕ спрацьовує)**

```javascript
test('evaluateDecision60 cooling override does not fire when window65_70 >= 35', () => {
  const match = { matchId: 'm1', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window60_70: 57.7,
        window65_70: 40,
        window70_75: 5,
        windowTracked6075: 50,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.ok(pred.reasons.includes('late_activation_risk_too_high'));
  assert.ok(!pred.reasons.includes('cooling_override_applied'));
});
```

- [ ] **Step 4: Написати тест: cooling НЕ обходить `tempoBad`**

```javascript
test('evaluateDecision60 cooling override does not bypass tempoBad gate', () => {
  const match = { matchId: 'm1', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window60_70: 30,
        window65_70: 25,
        window70_75: 5,
        windowTracked6075: 30,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'growing',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  assert.equal(pred.predictionType, 'NO_BET');
  assert.ok(pred.reasons.includes('late_activation_tempo_negative'));
});
```

- [ ] **Step 5: Запустити тести — переконатись що нові тести ФЕЙЛЯТЬ**

Run: `node --test test/prediction.test.js`
Очікувано: 3 з 4 нових тестів — fail (тест на tempoBad пройде вже зараз; решта впадуть, бо cooling override ще не реалізований).

- [ ] **Step 6: Реалізувати cooling override у `evaluateDecision60.js`**

У файлі `src/prediction/evaluateDecision60.js` знайди блок навколо рядка 119-133 (після оголошення `tempoBad`, `trackedHard`, `hot1hDanger`, `siegeBad`, `ftScore`, `lateAct`, `rpHardMax`, `hasNgDetailed`, `missingXgotFlag`).

Одразу **після** оголошення `rpHardMax` (і його `Math.max(...)`) додай блок:

```javascript
const coolingWindow70_75 = ms?.realPressureScores?.window70_75;
const coolingWindow65_70 = ms?.realPressureScores?.window65_70;
const cooling = Boolean(
  typeof coolingWindow70_75 === 'number' &&
  typeof coolingWindow65_70 === 'number' &&
  coolingWindow70_75 < 15 &&
  coolingWindow65_70 < 35
);
```

Далі знайди гейти на рядках ~160-170:

```javascript
else if (lateAct >= LATE_ACTIVATION_HARD_CAP) {
  predictionType = PRED_TYPES_60.NO_BET;
  reasons.push('late_activation_risk_too_high');
  riskFlags.push('late_activation_signs');
}

else if (rpHardMax >= REAL_PRESSURE_HARD_CAP) {
  predictionType = PRED_TYPES_60.NO_BET;
  reasons.push('real_pressure_too_high');
  riskFlags.push('late_activation_signs');
}
```

Заміни на:

```javascript
else if (lateAct >= LATE_ACTIVATION_HARD_CAP && !cooling) {
  predictionType = PRED_TYPES_60.NO_BET;
  reasons.push('late_activation_risk_too_high');
  riskFlags.push('late_activation_signs');
}

else if (rpHardMax >= REAL_PRESSURE_HARD_CAP && !cooling) {
  predictionType = PRED_TYPES_60.NO_BET;
  reasons.push('real_pressure_too_high');
  riskFlags.push('late_activation_signs');
}
```

Останній `else if (tempoBad === false && trackedHard === false)` блок (рядок ~184) — у ньому додай `cooling`-маркер у reasons, якщо cooling справді обійшов хоча б один cap. Знайди:

```javascript
else if (tempoBad === false && trackedHard === false) {
  reasons.push(`fullTimeNilNilScore=${ftScore}`);
  reasons.push(`lateActivationRisk=${lateAct}`);
  reasons.push(`tempoTrend=${ms?.tempoTrend6075 ?? '?'}`);
```

Додай **на самому початку** цього блоку (перед `reasons.push('fullTimeNilNilScore=...')`):

```javascript
  if (cooling && (lateAct >= LATE_ACTIVATION_HARD_CAP || rpHardMax >= REAL_PRESSURE_HARD_CAP)) {
    reasons.push('cooling_override_applied');
  }
```

- [ ] **Step 7: Запустити тести — усе має пройти**

Run: `node --test test/prediction.test.js`
Очікувано: PASS, включно з 4 новими cooling-тестами.

- [ ] **Step 8: Коміт**

```bash
git add src/prediction/evaluateDecision60.js test/prediction.test.js
git commit -m "feat(prediction): add cooling override to decision60

Bypass lateActivationRisk and rpHardMax hard caps when match cools down
in decision window (window70_75 < 15 AND window65_70 < 35).
Does NOT bypass tempoBad or trackedHard gates."
```

---

## Task 3: Додати `coolingOverride` у `predictionAudit.featuresSnapshot`

**Files:**
- Modify: `src/prediction/evaluateDecision60.js` (функції `evaluateDecision60` і `finalizeReturn`)
- Modify: `test/prediction.test.js`

- [ ] **Step 1: Написати тест на наявність `coolingOverride` в аудиті**

Додай у `test/prediction.test.js`:

```javascript
test('evaluateDecision60 audit includes coolingOverride payload when cooling fires', () => {
  const match = { matchId: 'm1', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 70,
      realPressureScores: {
        window45_60: 100,
        window60_70: 57.7,
        window65_70: 31.85,
        window70_75: 6,
        windowTracked6075: 63.7,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 3 },
      tempoTrend6075: 'falling',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: true },
    snapshotCount: 6,
  };
  const pred = evaluateDecision60(match, computed);
  const co = pred.predictionAudit.featuresSnapshot.coolingOverride;
  assert.ok(co, 'coolingOverride object повинен існувати');
  assert.equal(co.active, true);
  assert.equal(co.window70_75, 6);
  assert.equal(co.window65_70, 31.85);
  assert.ok(Array.isArray(co.bypassedGates));
  assert.ok(co.bypassedGates.includes('lateActivationRisk'));
  assert.ok(co.bypassedGates.includes('rpHardMax'));
});

test('evaluateDecision60 audit coolingOverride.active=false when not firing', () => {
  const match = { matchId: 'm1', statsLevel: 'detailed', snapshots: [] };
  const computed = {
    windows: {},
    modelSignals: {
      fullTimeNilNilScore: 80,
      lateActivationRisk: 30,
      realPressureScores: {
        window60_70: 30, window65_70: 25, window70_75: 20, windowTracked6075: 25,
      },
      sinceHtTotalsSnapshot: { shotsOnTarget: 0, xg: 0.05, xgot: 0 },
      cumulativeLiveTotals: { yellowCardsTotal: 1 },
      tempoTrend6075: 'flat',
    },
    pressure: { redCards: { anyRed: false } },
    firstHalfProfile: { isHotButNoGoal: false },
    snapshotCount: 5,
  };
  const pred = evaluateDecision60(match, computed);
  const co = pred.predictionAudit.featuresSnapshot.coolingOverride;
  assert.ok(co);
  assert.equal(co.active, false);
  assert.deepEqual(co.bypassedGates, []);
});
```

- [ ] **Step 2: Запустити тести — переконатись що нові ФЕЙЛЯТЬ**

Run: `node --test test/prediction.test.js`
Очікувано: 2 нові тести — fail (`coolingOverride` відсутнє).

- [ ] **Step 3: Передати `cooling`-дані з основної функції у `finalizeReturn`**

У `src/prediction/evaluateDecision60.js`, перед викликом `finalizeReturn(...)` (рядок ~349), обчисли список обійдених гейтів. Знайди блок:

```javascript
  return finalizeReturn({
    match,
    predictionType,
    tier,
    ...
    missingXgotFlag,
    hasNgDetailed,
  });
```

Додай **перед** `return finalizeReturn(...)`:

```javascript
  const coolingBypassedGates = [];
  if (cooling) {
    if (lateAct >= LATE_ACTIVATION_HARD_CAP) coolingBypassedGates.push('lateActivationRisk');
    if (rpHardMax >= REAL_PRESSURE_HARD_CAP) coolingBypassedGates.push('rpHardMax');
  }
  const coolingOverride = {
    active: cooling,
    window70_75: coolingWindow70_75 ?? null,
    window65_70: coolingWindow65_70 ?? null,
    bypassedGates: coolingBypassedGates,
  };
```

І передай у виклик `finalizeReturn`:

```javascript
  return finalizeReturn({
    match,
    predictionType,
    tier,
    actionable,
    actionablePrimary,
    confidence,
    ftScore,
    finalScore,
    modelMode: mode,
    overlay,
    ruleScoreSnapshot,
    aiUse,
    premium,
    reasons,
    riskFlags,
    ms,
    sinceHt,
    tracked6075Totals,
    statsLevel,
    hot1hDanger,
    missingXgotFlag,
    hasNgDetailed,
    coolingOverride,
  });
```

- [ ] **Step 4: Записати `coolingOverride` в audit у `finalizeReturn`**

У функції `finalizeReturn(p)`, рядки ~376-399 (деструкція):

```javascript
  const {
    match,
    predictionType,
    ...
    hasNgDetailed,
  } = p;
```

Додай `coolingOverride` у список:

```javascript
  const {
    match,
    predictionType,
    tier,
    actionable,
    actionablePrimary,
    confidence,
    ftScore,
    finalScore,
    modelMode,
    overlay,
    ruleScoreSnapshot,
    aiUse,
    premium,
    reasons,
    riskFlags,
    ms,
    sinceHt,
    tracked6075Totals,
    statsLevel,
    hot1hDanger,
    missingXgotFlag,
    hasNgDetailed,
    coolingOverride,
  } = p;
```

Знайди `featuresSnapshot` (рядки ~438-442):

```javascript
      featuresSnapshot: {
        modelSignals: ms,
        totalsTracked6075: tracked6075Totals,
        sinceHtTotals: sinceHt,
      },
```

Замінити на:

```javascript
      featuresSnapshot: {
        modelSignals: ms,
        totalsTracked6075: tracked6075Totals,
        sinceHtTotals: sinceHt,
        coolingOverride,
      },
```

- [ ] **Step 5: Запустити тести — усі мають пройти**

Run: `node --test test/prediction.test.js`
Очікувано: PASS, включно з 2 новими audit-тестами.

- [ ] **Step 6: Коміт**

```bash
git add src/prediction/evaluateDecision60.js test/prediction.test.js
git commit -m "feat(prediction): emit coolingOverride payload in decision60 audit

Adds featuresSnapshot.coolingOverride with active flag, window values
and list of bypassed gates for post-analysis of live cooling entries."
```

---

## Task 4: Smoke test на повний прогон тестів і ручна перевірка

- [ ] **Step 1: Запустити повний тест-сьют**

Run: `npm test`
Очікувано: усі існуючі тести (`replay`, `tracker`, `ai`, `telegram`, `prediction`, `snapshotCadence`) проходять.

- [ ] **Step 2: Прогнати GC3SHdo1 через replay (опціонально, sanity check)**

Якщо є `scripts/predictionReplay.js` або аналог — запустити на даних 2026-05-11 і переконатись, що для матча `GC3SHdo1` у `predictions.decision60`:
- `predictionType` тепер **не** `NO_BET` (або з `cooling_override_applied` в reasons).
- `featuresSnapshot.coolingOverride.active === true`.

Команда (приклад, уточнити за репо):
```bash
node scripts/predictionReplay.js --date 2026-05-11 --match GC3SHdo1
```

Якщо такого скрипта нема — пропустити цей крок, фінальна валідація буде на live-даних наступних днів.

- [ ] **Step 3: Push гілки**

```bash
git push -u origin v4
```

(Не робити merge у `main` — спершу збір даних на v4.)

---

## Self-Review (виконано при написанні плану)

- **Spec coverage:** ✓
  - Зміна 1 (виключити window45_60) → Task 1.
  - Зміна 2 (cooling override) → Task 2.
  - Зміна 3 (audit `coolingOverride`) → Task 3.
  - Валідація на live-даних → Task 4 (+ моніторинг у наступні дні через існуючий пайплайн логів).
- **Placeholder scan:** ✓ — нема "TBD/TODO", усі тести і код блоки в повному обсязі.
- **Type consistency:** ✓ — поле `coolingOverride.active` (boolean), `window70_75`/`window65_70` (number|null), `bypassedGates` (string[]) консистентно у тестах і коді.
