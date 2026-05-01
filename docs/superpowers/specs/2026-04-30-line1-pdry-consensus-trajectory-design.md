# Лінія 1 — P_dry Consensus + Trajectory Model

**Версія:** v3.3
**Дата:** 2026-04-30
**Статус:** Draft (потребує ревью)

---

## 1. Мотивація

Поточна live-модель v3 ставить ТМ 0.5 у вікнах 60-70 / 70-80 / 80+ за станом snapshot-ів raw2H. Фактичний HR за квітень 2026:

| Період | HR | Кількість ставок |
|---|---|---|
| Дні з малою вибіркою (≤5 ставок) | 40-100% | волатильно |
| Дні з 7-8 ставками | 57-62% | стабільніше |
| Дні з 10+ ставками | 25-45% | падає |

**Середній HR ~40-45% з високою дисперсією.** Основні джерела втрат:
1. `basePGoal = 0.44` хардкод — не калібровано під лігу/ринок
2. Penalty-based score (зважена сума) — false positives при середніх показниках
3. Немає порівняння темпу 1H vs 2H — пропускаються матчі що "розкриваються"
4. Pre-match форма використовується слабко (тільки 60-70 cap=0.05)
5. Калібрування виконано на 7 днях / 214 матчах — мала вибірка

**Ціль Лінії 1:** HR ≥ 60% при recall ≥ 25% (~1-3 сигнали на день).

---

## 2. Бізнес-логіка

| Параметр | Значення |
|---|---|
| Тригер | 0:0 на 45-50' (HT або ранній 2H) |
| Моніторинг | snapshot stats кожні 5 хв з 45' до 75' |
| Точка рішення | 60-75' (15-хвилинне вікно прийняття рішення) |
| Тип ставки | ТМ 0.5 на залишок матчу |
| Win condition | Матч завершується 0:0 |
| Mode rollout | Shadow → активний (через 1-2 тижні) |

Лінія 1 **паралельна** з v3, не замінює її. Окремий TG-тег "Lin1", окремий лог.

---

## 3. Архітектура моделі — 4 шари

### Шар 1: Per-minute rate normalization

Поточний код працює з абсолютними `raw2H` сумами — на 50' це 5 хв даних, на 70' це 25 хв. Несправедливе порівняння.

**Pace-нормалізація:**
```
pace_1H[stat]      = stat_1H / 45
pace_2H(t)[stat]   = (stat_total(t) - stat_1H) / (t - 45)
intensityRatio(t)[stat] = pace_2H(t)[stat] / pace_1H[stat]
```

**Метрики які нормалізуємо:** `expectedGoalsXg`, `shotsOnTarget`, `touchesInOppositionBox`, `bigChances`, `totalShots`.

**Інтерпретація intensityRatio:**
| Значення | Сигнал |
|---|---|
| < 0.6 | 2H охолоджується vs 1H — сильний dry |
| 0.6–0.9 | 2H трохи спокійніше — нейтрально-dry |
| 0.9–1.1 | 2H = 1H темп — нейтрально |
| 1.1–1.4 | 2H трохи активніше — нейтрально-active |
| > 1.4 | **2H розкривається — cancel UNDER** |

### Шар 2: 5 компонентних dry_score [0, 1]

Замість єдиного `computeDryPenalty` — 5 незалежних скорів. Кожен повертає число [0, 1], де 1 = повна ознака сухого матчу.

**A. dry_1H** — наскільки порожній 1H
```
inputs: xG_1H, SOT_1H, BC_1H, touches_1H, totalShots_1H
формула:
  dry_1H = 1 - sigmoid(
    0.40 * normSOT(SOT_1H, max=8) +
    0.30 * normXG(xG_1H, max=2.0) +
    0.20 * normBC(BC_1H, max=4) +
    0.10 * normTouches(touches_1H, max=25)
  )
```
sigmoid центровано на лігову baseline-інтенсивність 1H.

**B. dry_2H** — наскільки порожній 2H зараз (на актуальний snapshot)
```
inputs: pace_2H[xG, SOT, BC, touches]
формула: те саме що A, але на pace_2H × 45 (приведений до повного тайму)
```

**C. trajectory_dry** — чи 2H темп ≤ 1H темп
```
inputs: intensityRatio для xG, SOT, touches, BC
формула:
  ratios = [intensityRatio[xG], intensityRatio[SOT], intensityRatio[touches]]
  weighted_ratio = 0.40*xG + 0.35*SOT + 0.25*touches
  trajectory_dry = clip(1.5 - weighted_ratio, 0, 1)

  → ratio=0.5 → trajectory_dry=1.0 (відмінно охолоджується)
  → ratio=1.0 → trajectory_dry=0.5 (нейтрально)
  → ratio=1.5 → trajectory_dry=0.0 (розкривається)
```

**D. odds_dry** — що каже ринок про тісність матчу
```
inputs: odds1X2 = {home, draw, away}
формула:
  inv_total = 1/h + 1/d + 1/a
  implied_draw = (1/d) / inv_total
  market_total_inv = 1/h + 1/a
  // в захисних матчах sum 1/h + 1/a менший (більші кф у обох команд)

  odds_dry = clip(
    0.5 * normalize(implied_draw, min=0.20, max=0.40)
    + 0.5 * (1 - normalize(market_total_inv, min=0.55, max=0.95))
  , 0, 1)
```

**E. prematch_dry** — профіль команд + H2H
```
inputs: aggregates з scrapeMatchFormAndH2h
формула:
  home_low  = aggregates.home.avgTotalGoals ≤ 2.0 AND n ≥ 3
  away_low  = aggregates.away.avgTotalGoals ≤ 2.0 AND n ≥ 3
  h2h_low   = aggregates.mutual.avgTotalGoals ≤ 2.2 AND n ≥ 2

  prematch_dry =
    0.4 * (home_low ? 1 : 0)
    + 0.4 * (away_low ? 1 : 0)
    + 0.2 * (h2h_low ? 1 : 0)
```

### Шар 3: Consensus агрегація → P_dry

```
base = league_baseline_dry  // calibrated per league, default 0.50

P_dry = base
       + 0.12 * dry_1H
       + 0.15 * dry_2H
       + 0.18 * trajectory_dry
       + 0.08 * odds_dry
       + 0.07 * prematch_dry
       - penalty_burst
       - penalty_redcard

P_dry = clip(P_dry, 0.10, 0.92)
```

Максимальний внесок ваг (без штрафів і базлайну) = 0.60. З base=0.50 → теоретичний максимум ~1.10 → clip 0.92.

**Telegram-сигнал тільки якщо ВСІ умови:**
1. `P_dry ≥ 0.62` (calibrated cutoff)
2. **Consensus:** ≥ 4 з 5 dry_score_i ≥ 0.5
3. **Hard gate:** trajectory_dry ≥ 0.4 (без сприятливої траєкторії — пропускаємо)
4. Має бути ≥ 2 snapshot-и 2H (один не дає trajectory)

### Шар 4: Hard SKIP gates (override все)

| Gate | Умова | Причина |
|---|---|---|
| Red card 2H | redCards_2H > 0 | Гра відкривається після видалення |
| xG burst | intensityRatio[xG] (last 5min) ≥ 1.5 | Активний натиск зараз |
| BC burst | Δ bigChances (last 5min) ≥ 1 | Створено момент → гол поруч |
| Score change | Гол зафіксовано між snapshot-ами | Зміна сценарію |

(`DangerousAttacks` немає в FlashScore desktop scrape — використовуємо `touchesInOppositionBox` як проксі.)

---

## 4. Калібрування (data-driven, не guess)

### Дані
- `data/historical/raw/2026-04-03..09` — 7 днів з sum-stats
- `data/logs/2026-04-15..29` — 15 днів з результатами
- ~22-30 днів матчів з 0:0 на 50' → ~150-200 кандидатів для backtest

### Процедура
1. **Re-scrape історичні матчі для 1H stats** — поточні логи мають тільки 2H/overall, треба перепарсити
2. **Для кожного 0:0 матчу на 50':** обчислити 5 dry_score → зафіксувати фактичний результат (стало 1+ голів чи матч закінчився 0:0)
3. **Logistic regression:** `P(dry_finish | dry_score_1..5)` → optimal weights
4. **Per-league baseline:** для кожної ліги з ≥10 матчами обчислити емпіричну `P(stay_dry | 0:0 at 50')` → це `league_baseline_dry`
5. **Threshold tuning:** sweep P_dry cutoff від 0.55 до 0.75, знайти точку де HR ≥ 60% і recall ≥ 25%
6. **Validation:** holdout 20% матчів для перевірки

### Калібрування зберігається у
- `src/helpers/leagueBaselines.js` — мапа league_name → baseline_dry
- `src/helpers/constants.js` — нові пороги LINE1_*

---

## 5. Структура коду (нові файли + зміни)

```
src/
  pipeline/
    line1/
      dryEngine.js              # головна точка входу evaluateLine1Dry()
      paceNormalizer.js         # Шар 1: pace_1H, pace_2H, intensityRatio
      dryScoreComponents.js     # Шар 2: 5 компонентних скорів
      consensusAggregator.js    # Шар 3: P_dry + consensus gate
      hardGates.js              # Шар 4: SKIP gates
      __tests__/
        paceNormalizer.test.js
        dryScoreComponents.test.js
        consensusAggregator.test.js
        hardGates.test.js
        dryEngine.integration.test.js

  helpers/
    leagueBaselines.js          # per-league baseline_dry (після калібрування)

  scrapeDesktopStats.js          # ЗМІНА: додати окрему секцію 1H stats
  pipeline/
    featureBuilder.js            # ЗМІНА: додати raw1H + pace fields

worker.js                        # ЗМІНА: паралельна маршрутизація Line 1
src/helpers/constants.js         # ЗМІНА: нові LINE1_* константи

scripts/
  calibrateLine1.js              # НОВИЙ: backtest + logistic regression
  shadowReportLine1.js           # НОВИЙ: денний звіт shadow-mode
```

### Ключові зміни в існуючих файлах

**`src/scrapeDesktopStats.js`**
- Додати парсинг 1H tab окремо від 2H (зараз парсимо overall + 2H)
- Тестово: на сторінці FlashScore є таб "1-й тайм" → потрібен click або URL parameter

**`src/pipeline/featureBuilder.js`**
- Додати `raw1H` поле з тими ж 6 PRIMARY metrics
- Додати `pace1H`, `pace2H` обчислення
- Додати `availability1H` метрику для якості 1H

**`worker.js`**
- Після `buildFeatures` → паралельно викликати `evaluateLiveModel` (v3) і `evaluateLine1Dry`
- Логувати рішення обох ліній окремо
- TG: для shadow-mode НЕ слати Line 1 повідомлення; писати в `data/logs/{date}/line1_shadow.json`
- Після переходу в активний режим: TG-префікс "Lin1" поряд з v3

**`src/helpers/constants.js` (нові константи)**
```js
LINE1_ENABLED              = envBool('LINE1_ENABLED', false)
LINE1_SHADOW_MODE          = envBool('LINE1_SHADOW_MODE', true)
LINE1_MIN_CANDIDATE_MINUTE = 45    // раніший ніж v3
LINE1_DECISION_MIN         = 60
LINE1_DECISION_MAX         = 75
LINE1_PDRY_THRESHOLD       = 0.62
LINE1_CONSENSUS_REQUIRED   = 4     // з 5
LINE1_TRAJECTORY_MIN       = 0.4
LINE1_INTENSITY_RATIO_MAX  = 1.4   // burst gate
LINE1_BC_DELTA_MAX         = 1     // BC burst gate
```

---

## 6. Rollout план

### Фаза 1: Інфраструктура (тиждень 1)
- Збір 1H stats у scraper
- Pace normalizer + dryScoreComponents
- Юніт-тести з seed-даними

### Фаза 2: Engine + Shadow (тиждень 2)
- consensusAggregator + hardGates
- Інтеграція у worker.js (тільки логування, без TG)
- `LINE1_ENABLED=true`, `LINE1_SHADOW_MODE=true`
- Логи у `data/logs/{date}/line1_shadow.json`

### Фаза 3: Калібрування (тиждень 3)
- Скрипт `calibrateLine1.js` на історичних даних
- Тюнінг ваг + per-league baselines
- Validation на holdout

### Фаза 4: Активація (тиждень 4)
- Shadow логи показують HR ≥ 55% при recall ≥ 20% → активуємо TG
- `LINE1_SHADOW_MODE=false`
- Моніторинг HR щоденно

### Критерії успіху
| Метрика | Ціль |
|---|---|
| HR (rolling 14 днів) | ≥ 60% |
| Recall (% 0:0 матчів які стали сигналом) | ≥ 20% |
| Сигналів на день | 1-3 (не більше) |
| False positive rate | ≤ 40% |

---

## 7. Очікуваний внесок у HR

| Покращення | Δ HR |
|---|---|
| Trajectory layer (1H vs 2H pace) | +8-10% |
| Per-league baseline calibration | +4-6% |
| Consensus (4 з 5) проти зваженої суми | +5-7% |
| Hard SKIP на 2H bursts/red cards | +3-4% |
| Реальні кф для Kelly + EV-фільтр | +2-3% |
| **Сумарно** | **30-45% → 55-65%** |

---

## 8. Тестування

### Unit
- `paceNormalizer.test.js` — pace формули, edge cases (мінута=45, відсутні поля)
- `dryScoreComponents.test.js` — кожен компонент окремо: low/medium/high inputs
- `consensusAggregator.test.js` — consensus гейт, weights, clipping
- `hardGates.test.js` — кожен gate з seed-даними

### Integration
- `dryEngine.integration.test.js` — повний цикл: snapshot history → P_dry → decision
- Seed-фікстури: 5 типових матчів (dry profile, active profile, edge cases)

### Calibration validation
- `calibrateLine1.js` має CLI: `--validate-only` режим — не міняти ваги, тільки перевірити поточну якість

### Smoke test
- Запустити `index.js` локально на 1 цикл, перевірити що Line 1 пише shadow-лог

---

## 9. Ризики та митигація

| Ризик | Вірогідність | Митигація |
|---|---|---|
| FlashScore не дає окремий 1H tab — треба click navigation | Середня | Fallback: 1H = overall - 2H якщо є обидві |
| Calibration overfit (мала вибірка) | Висока | Holdout validation, beware leakage |
| 5-хв polling reliability при scraping fails | Середня | Reuse v3 retry-logic, accept partial snapshots |
| `prematch_dry` слабкий через малу к-сть aggregates | Середня | Compatibility — компонент може бути 0 (тоді consensus=4 з 4) |
| Ринок dry-matches mispriced — низькі кф (<1.4) | Висока | EV-фільтр: skip якщо кф < threshold |
| Shadow-mode виявляє HR <50% — стратегія невалідна | Середня | Не активуємо TG, аналізуємо помилки, recalibrate |

---

## 10. Outstanding questions (до writing-plans)

1. **1H stats з FlashScore:** перевірити чи є окремий 1H tab (HTML-розвідка нам потрібна)
2. **EV-фільтр:** мінімальний кф для входу — 1.4? 1.5? Залежить від HR (HR=60% → break-even kf=1.67)
3. **GGBet integration:** Лінія 1 потребує реальний кф ТМ 0.5 — `scrapeGGBetOdds` вже є, треба тільки інтегрувати
4. **Score-фільтр:** строго 0:0, чи допускати 0:0 з пропущеним голом без зміни рахунку? (рідко, але можливо)

---

**Status:** реалізовано (shadow-mode) у v3.3. Дата імплементації: 2026-05-01. План: `docs/superpowers/plans/2026-04-30-line1-pdry-consensus-trajectory.md`.

**Outstanding (для наступних ітерацій):**
- Повне калібрування: re-scrape 1H stats + logistic regression
- Інтеграція реальних кф ТМ 0.5 з GGBet
- Активація TG після shadow HR ≥55% за 14 днів
