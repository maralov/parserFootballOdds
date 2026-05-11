# TM 0.5 Cooling Override — Design

**Дата:** 2026-05-11
**Гілка:** v4
**Цільовий чекпоінт:** `decision60` (TM 0.5 матчу, вікно 60-75')

## Контекст і проблема

Модель `evaluateDecision60` оцінює сигнал на кожному снепшоті у вікні 60-75', але **не вміє переоцінити** матч, який охолов після активного початку 2-го тайму.

**Конкретний кейс (GC3SHdo1, 2026-05-11):**
- East Bengal vs Punjab (ISL), завершився 0:0 → TM 0.5 виграв би на 2.0.
- Модель: `NO_BET` через два hard caps:
  - `lateActivationRisk = 70` (≥ 60) — причина `late_activation_risk_too_high`.
  - `rpHardMax = 100` (через `window45_60`) — причина `real_pressure_too_high`.
- Реальна динаміка у момент рішення (~хв 73):
  - `window65_70 = 31.85`, `window70_75 = 6`, `tempoTrend6075 = "falling"`.
- Тобто матч **охолов прямо у вікні рішення**, але модель усе ще орієнтувалась на активний `window45_60 = 100`.

**Корінь проблеми:** `rpHardMax` бере максимум **по всіх вікнах**, включно з найдальшим від моменту рішення (45-60'). Жодного механізму "охолодження" не існує — `tempoTrend="falling"` ніяк не звільняє від cap.

## Цілі

1. Дозволити вхід на TM 0.5 у матчах, які охолоджуються у вікні рішення (60-75'), навіть якщо початок 2-го тайму був активний.
2. Зберегти захист від матчів з активним темпом або пізньою активацією.
3. Не вносити змін у `decision80` (TB) — TB-правки відкладені до накопичення кейсів MISS.
4. Без історичного бектесту — валідація на live-даних v4.

## Зміни

### Зміна 1: Виключити `window45_60` з `rpHardMax`

**Файл:** `src/prediction/evaluateDecision60.js:127-133`

**Зараз:**
```js
const rpHardMax = Math.max(
  ms?.realPressureScores?.window45_60 ?? 0,
  ms?.realPressureScores?.window60_70 ?? 0,
  ms?.realPressureScores?.window65_70 ?? 0,
  ms?.realPressureScores?.window70_75 ?? 0,
  ms?.realPressureScores?.windowTracked6075 ?? 0,
);
```

**Стане:**
```js
const rpHardMax = Math.max(
  ms?.realPressureScores?.window60_70 ?? 0,
  ms?.realPressureScores?.window65_70 ?? 0,
  ms?.realPressureScores?.window70_75 ?? 0,
  ms?.realPressureScores?.windowTracked6075 ?? 0,
);
```

**Обґрунтування:** `window45_60` залишається сигналом усередині `lateActivationRisk` (м'якший вплив), але не валить hard cap. Hard cap залишається для вікон, **дотичних до точки рішення**.

### Зміна 2: Cooling override

**Файл:** `src/prediction/evaluateDecision60.js` (нова логіка перед гейтами на ~рядку 160).

**Умова active:**
```js
const cooling =
  (ms?.realPressureScores?.window70_75 ?? 100) < 15 &&
  (ms?.realPressureScores?.window65_70 ?? 100) < 35;
```

**Як використовується:** `cooling=true` **обходить** обидва hard caps (`lateActivationRisk >= 60` і `rpHardMax >= 60`).

Гейти на `tempoBad` (growing/explosive) і `trackedHard` (жорсткі сирі цифри у вхідному вікні) **залишаються активними** — cooling їх не обходить.

**Псевдо-код нової послідовності:**
```js
if (redBlocked) { NO_BET }
else if (!liveTotals || !sinceHt) { NO_BET }
else if (lateAct >= 60 && !cooling) { NO_BET 'late_activation_risk_too_high' }
else if (rpHardMax >= 60 && !cooling) { NO_BET 'real_pressure_too_high' }
else if (tempoBad) { NO_BET }       // cooling НЕ обходить
else if (trackedHard) { NO_BET }    // cooling НЕ обходить
else { // → можливий BET через extended/basic premium gates }
```

**Обґрунтування порогів:**
- `window70_75 < 15` — остання 5-хвилинка перед рішенням; має бути практично порожня (≤ 1 удар без створу).
- `window65_70 < 35` — попередня 5-хвилинка; допускається мінімальна активність (1-2 удари, ні big chances).
- Поріг 35 для 65-70 м'якший, бо це вікно ще "в дорозі" до затухання.

### Зміна 3: Аудит

**Файл:** `src/prediction/evaluateDecision60.js` (секція `predictionAudit`).

У `predictionAudit.featuresSnapshot` додати:
```js
coolingOverride: {
  active: cooling,
  window70_75: ms?.realPressureScores?.window70_75 ?? null,
  window65_70: ms?.realPressureScores?.window65_70 ?? null,
  bypassedGates: cooling ? capsToList(lateAct, rpHardMax) : [],
}
```

Це дозволить пост-аналізу відрізнити "звичайний BET" від "cooling entry".

У `reasons` при cooling-вході додати рядок `cooling_override_applied`.

## Поза скоупом

- `evaluateDecision80` (TB 0.5) — без змін.
- `lateActivationRisk` як така — без змін (логіка нарахування лишається).
- `tempoTrend="falling"` relief у `modelScoresRaw.js` — **не робимо**. Cooling override на основі сирих RP-значень вирішує проблему точніше, без додаткового магічного числа.
- Зменшення ваги `window45_60` у `lateActivationRisk` — **не робимо**. Видалення з `rpHardMax` + cooling override уже покривають кейс.

## Очікуваний ефект

| Категорія | Як зміниться |
|---|---|
| TM-сигнали за день | ~0-2 → ~2-5 (груба оцінка) |
| Нова підкатегорія | "cooling entry" — матчі з активним початком 2H і затуханням до 70-75' |
| Стара категорія "premium dry entry" | Без змін |
| Конверсія HR | Можливо просяде (ще не валідовано) — компенсується об'ємом |
| Ризик нових MISS | Пізні активації 78-85' після затухання 65-75' (cooling не вловить) |

## Валідація

- **Метод:** збір live-даних на гілці v4 у наступні 7-14 днів.
- **Метрики для відстеження** (у `data/logs/<date>/predictions.json` через `predictionAudit.featuresSnapshot.coolingOverride`):
  - Кількість cooling-входів за день.
  - HR серед cooling-входів окремо vs звичайних.
  - MISS-кейси, де cooling спрацював, але матч закінчився не 0:0 → аналіз чи варто посилити пороги.
- **Без історичного бектесту** — за рішенням користувача.

## Точки коду, що зачіпаються

- `src/prediction/evaluateDecision60.js` — основні правки (rpHardMax, cooling override, audit).
- **Не зачіпається:** `src/computed/modelScoresRaw.js`, `src/computed/ftTmModelSignals.js`, `src/prediction/evaluateDecision80.js`.

## Регресії, на які звернути увагу

1. Існуючі позитивні TM-сигнали (premium/extended dry entries) — переконатись що не псуються (cooling — це додатковий шлях, основні гейти не змінюються).
2. Тести/фікстури, які перевіряють `rpHardMax` з `window45_60` — оновити очікувані значення.
3. Snapshot-тести `predictionAudit.featuresSnapshot` — додати поле `coolingOverride`.
