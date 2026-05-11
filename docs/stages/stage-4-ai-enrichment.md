# Stage 4 — AI Enrichment

**Status:** Spec / Awaiting Implementation  
**Depends on:** Stage 3 (`matches.json` → snapshots, baseline1H, odds, standings, h2h)

Інтеграція OpenAI GPT-4o для числової оцінки ймовірностей розвитку матчу на ключових checkpoint-ах. AI працює як **паралельний сигнал** — не блокує основний pipeline (fire-and-forget), результат зберігається в `matches.json` поряд з існуючими даними.

---

## Контекст: три рівні прогнозування

Система прогнозування працюватиме на трьох рівнях залежно від доступних даних:

| Рівень | Назва | Вхідні дані | Умова |
|--------|-------|-------------|-------|
| 1 | **Basic** | Скорочена стата (shots, corners, possession — без xG) | `statsLevel === "basic"` |
| 2 | **Full** | Розширена стата (+ xG, detailed stats) | `statsLevel === "detailed"` |
| 3 | **Full + AI** | Full + AI enrichment (числові оцінки GPT-4o) | `statsLevel === "detailed"` AND `aiAnalysis` present |

AI-запити виконуються **тільки для матчів рівня 2+** (`statsLevel === "detailed"`). Для basic-матчів AI не викликається — недостатньо вхідних даних для якісної оцінки.

Stage 4 готує дані для рівня 3. Рівні 1 і 2 — окрема майбутня робота (Stage 5: prediction model).

---

## Головна ідея

```
discovered (Stage 1)
     │
     ▼
enriched   (Stage 2)         ← baseline1H + odds + standings + h2h
     │
     ▼
tracked    (Stage 3)         ← snapshot кожні 5 хв
     │
     ├── [HT, фільтр xG]   ← AI checkpoint "halftime" (умовний)
     ├── [60', valid]       ← AI checkpoint "decision60"
     ├── [80', 0:0]         ← AI checkpoint "decision80"
     │
     ▼
finished   (Stage 3)         ← final score + goals + derived + aiAnalysis
```

AI не знає, що система прогнозує ставки. Промпти описують задачу як "оцінку ймовірностей розвитку матчу". Відповідь — структурований JSON з числовими оцінками.

---

## Архітектурні рішення

| Аспект | Рішення |
|---|---|
| **Інтеграція** | Fire-and-forget Promise в `snapshotCollector.js` після збереження snapshot |
| **Блокування** | AI НЕ блокує snapshot pipeline; якщо AI лагає — snapshots продовжуються |
| **Провайдер** | OpenAI API (`openai` npm package) |
| **Модель** | `gpt-4o` (конфігурується через `LIVE_AI_MODEL`) |
| **Temperature** | 0.2 — низька для стабільності числових оцінок |
| **Response format** | `response_format: { type: "json_object" }` — гарантований валідний JSON |
| **Retry** | До `LIVE_AI_MAX_RETRIES` (default 2) з exponential backoff |
| **Timeout** | `LIVE_AI_TIMEOUT_MS` (default 15s) per request |
| **Зберігання** | Inline в `matches.json` → поле `aiAnalysis` |
| **Feature flag** | `LIVE_AI_ENABLED` — повне вимкнення без зміни коду |
| **Telegram** | Не відправляється (тільки console + matches.json) |
| **Ідемпотентність** | Кожен checkpoint викликається максимум 1 раз (прапорець в `aiAnalysis`) |

---

## Checkpoints

### 1. `halftime` — умовний, після перерви

- **Тригер:** перший snapshot з `minute >= 45` AND NOT `isHalftime` AND score 0:0 (після discard policy — якщо матч discarded, AI не викликається)
- **Глобальний фільтр:** `statsLevel === "detailed"` — basic-матчі не отримують AI-запитів (рівень 1 працює без AI)
- **Фільтр xG:** `totalXg1H = baseline1H.expectedGoalsXg.home + baseline1H.expectedGoalsXg.away`. Якщо `totalXg1H >= LIVE_AI_HT_XG_THRESHOLD` (default 1.5) → **пропускаємо** (матч "гольовий", економія токенів)
- **Захист від дублів:** `match.aiAnalysis?.halftime !== undefined` → не викликати
- **Дані:** odds, marketSignal, tableSignal, standings summary, h2h summary, baseline1H stats
- **Мета:** загальна оцінка стану матчу, яка передається в наступні checkpoint-и як контекст

### 2. `decision60` — точка рішення лінії A (ТМ 0.5)

- **Тригер:** snapshot з `minute >= 60` AND `validForPrediction === true`
- **Захист від дублів:** `match.aiAnalysis?.decision60 !== undefined`
- **Дані:** все від halftime + since2H stats + 5-хвилинні windows (дельти) + HT AI assessment (якщо є) + `half1_tempo_xg_per_min`
- **Мета:** оцінка ймовірності "сухого" матчу на основі динаміки 2-го тайму

### 3. `decision80` — точка рішення лінії B (ТБ 0.5)

- **Тригер:** snapshot з `minute >= 80` AND score 0:0
- **Захист від дублів:** `match.aiAnalysis?.decision80 !== undefined`
- **Дані:** ідентично decision60, але з більшою кількістю windows + додаткове речення: "До фінального свистка залишилось 10 регулярних хвилин + компенсований час"
- **Мета:** оцінка ймовірності пізнього гола

---

## Промпти

### System prompt (фіксований, єдиний для всіх checkpoints)

```
Ти аналітик футбольних матчів. Отримуєш об'єктивні статистичні дані 
матчу і даєш числові оцінки ймовірностей розвитку подій.

ПРАВИЛА:
1. Базуйся ТІЛЬКИ на наданих даних. Не використовуй знання про команди.
2. Не давай рекомендацій щодо ставок чи інвестицій.
3. Не використовуй термінологію беттінгу (тотал, ТМ, ТБ, коеф).
4. Видавай ТІЛЬКИ JSON, без коментарів до або після.
5. Сума ймовірностей альтернатив має бути 1.0.
6. Якщо даних мало для впевненої оцінки — встановлюй confidence < 0.5.

ФОРМАТ ВІДПОВІДІ:
{
  "p_match_ends_0_0": <число 0-1>,
  "p_match_has_goal": <число 0-1>,
  "match_state": "low_tempo" | "balanced" | "building_pressure" | "high_tempo",
  "dominant_side": "home" | "away" | "none",
  "key_observations": [<3 коротких факти українською>],
  "confidence": <число 0-1>
}
```

### User prompt — `halftime`

```
Матч на перерві з рахунком 0:0.

КОМАНДИ:
{home_team} (дім) vs {away_team} (гості)
Ліга: {league}, {country}

ПЕРЕДМАТЧЕВИЙ КОНТЕКСТ:
- Коефіцієнти 1X2: {odds.home} / {odds.draw} / {odds.away}
- Market signal (чисті ймовірності): {market_signal} 
  (від -1 до +1, мінус = фаворит гості)
- Table signal: {table_signal}
- H2H останні 5: {h2h_summary}
- Турнірне положення: {standings_summary}

СТАТИСТИКА ПЕРШОГО ТАЙМУ:
- Удари: {totalShots.home} - {totalShots.away}
- Удари у створ: {shotsOnTarget.home} - {shotsOnTarget.away}
- Кутові: {cornerKicks.home} - {cornerKicks.away}
- Очікувані голи (xG): {expectedGoalsXg.home} - {expectedGoalsXg.away}
- Володіння: {ballPossession.home}% - {ballPossession.away}%
- Жовті картки: {yellowCards.home} - {yellowCards.away}
- Червоні: {redCards.home} - {redCards.away}

Оціни ймовірності розвитку матчу.
```

### User prompt — `decision60`

```
Матч триває, поточна хвилина 60, рахунок 0:0.

КОМАНДИ: {home_team} vs {away_team}

ПЕРШИЙ ТАЙМ (baseline):
- Удари: {baseline1H.totalShots.home} - {baseline1H.totalShots.away}
- У створ: {baseline1H.shotsOnTarget.home} - {baseline1H.shotsOnTarget.away}
- xG: {baseline1H.expectedGoalsXg.home} - {baseline1H.expectedGoalsXg.away}

ДРУГИЙ ТАЙМ ДО ЦЬОГО МОМЕНТУ (хв 45-60):
- Удари: {since2H.totalShots.home} - {since2H.totalShots.away}
- У створ: {since2H.shotsOnTarget.home} - {since2H.shotsOnTarget.away}
- Кутові: {since2H.cornerKicks.home} - {since2H.cornerKicks.away}
- xG 2-го тайму: {since2H.expectedGoalsXg.home} - {since2H.expectedGoalsXg.away}
- Володіння: {ballPossession.home}% - {ballPossession.away}%

ДИНАМІКА ПО 5-ХВИЛИННИХ ВІКНАХ:
{five_min_windows_table}

БАЗОВИЙ ТЕМП 1-ГО ТАЙМУ: {half1_tempo_xg_per_min} xG/хв

{halftime_ai_section}

Оціни ймовірності розвитку матчу до фінального свистка.
Зверни увагу на динаміку — чи зростає тиск, чи матч уповільнюється.
```

Блок `{halftime_ai_section}` — вставляється тільки якщо `aiAnalysis.halftime.output` існує:
```
ОЦІНКА В ПЕРЕРВІ (AI):
- p(0:0): {ht.p_match_ends_0_0}
- Стан: {ht.match_state}
- Домінує: {ht.dominant_side}
- Впевненість: {ht.confidence}
```

### User prompt — `decision80`

Ідентичний `decision60` з відмінностями:
- `current_minute: 80`
- Більше entries в `five_min_windows`
- Додатковий рядок в кінці: `"До фінального свистка залишилось 10 регулярних хвилин + компенсований час."`
- `halftime_ai_section` + `decision60_ai_section` (якщо є)

---

## Побудова 5-хвилинних windows

```javascript
function buildFiveMinWindows(snapshots) {
  return snapshots
    .filter(s => s.delta !== null)
    .map(s => ({
      minute: s.minute,
      shots_total: (s.delta.totalShots?.home || 0) + (s.delta.totalShots?.away || 0),
      sot_total: (s.delta.shotsOnTarget?.home || 0) + (s.delta.shotsOnTarget?.away || 0),
      xg_total: safeAdd(s.delta.expectedGoalsXg?.home, s.delta.expectedGoalsXg?.away),
      corners: (s.delta.cornerKicks?.home || 0) + (s.delta.cornerKicks?.away || 0),
    }));
}
```

Формат у промпті (табличний):
```
хв  | удари | у_створ | xG    | кутові
52  |   5   |    2    | 0.37  |   1
57  |   3   |    1    | 0.18  |   0
```

---

## Формат відповіді AI (єдиний для всіх checkpoints)

```json
{
  "p_match_ends_0_0": 0.62,
  "p_match_has_goal": 0.38,
  "match_state": "low_tempo",
  "dominant_side": "away",
  "key_observations": [
    "Гості домінують по xG (1.39 vs 0.39)",
    "Низька реалізація ударів у створ",
    "Темп знижується у другому таймі"
  ],
  "confidence": 0.71
}
```

### Валідація відповіді

1. **JSON parsing** — гарантовано `response_format: { type: "json_object" }`
2. **Required fields:** `p_match_ends_0_0`, `p_match_has_goal`, `match_state`, `dominant_side`, `key_observations`, `confidence`
3. **Probability sum:** `|p_match_ends_0_0 + p_match_has_goal - 1.0| < 0.05`
4. **Enum check:** `match_state` ∈ `["low_tempo", "balanced", "building_pressure", "high_tempo"]`
5. **Enum check:** `dominant_side` ∈ `["home", "away", "none"]`
6. **Range check:** `confidence` ∈ [0, 1]
7. При невдалій валідації → retry з backoff (1s, 2s, ...) до `LIVE_AI_MAX_RETRIES`

---

## matches.json Schema Extension

Новий блок `aiAnalysis` на рівні кожного матчу:

```json
{
  "matchId": "OfvqEnzG",
  "...": "existing fields (candidate, enrichment, tracking, snapshots, final, derived)",

  "aiAnalysis": {
    "halftime": {
      "output": {
        "p_match_ends_0_0": 0.62,
        "p_match_has_goal": 0.38,
        "match_state": "low_tempo",
        "dominant_side": "away",
        "key_observations": ["...", "...", "..."],
        "confidence": 0.71
      },
      "latencyMs": 3420,
      "promptTokens": 487,
      "completionTokens": 156,
      "model": "gpt-4o",
      "costUsd": 0.0048,
      "error": null,
      "requestedAt": "2026-05-07T13:36:50Z"
    },
    "decision60": {
      "output": { "...same schema..." },
      "latencyMs": 4100,
      "promptTokens": 712,
      "completionTokens": 168,
      "model": "gpt-4o",
      "costUsd": 0.0058,
      "error": null,
      "requestedAt": "2026-05-07T14:02:30Z"
    },
    "decision80": null,
    "totalCostUsd": 0.0106,
    "requestCount": 2
  }
}
```

- Checkpoint не відбувся → `null`
- AI-виклик зафейлився після всіх retry → `{ "output": null, "error": "timeout", ... }`
- `totalCostUsd` і `requestCount` — агреговані метрики по матчу

---

## Module Layout

```
src/ai/
  aiClient.js           — OpenAI API wrapper: callAI(), cost calculation, retry logic
  prompts.js            — prompt builders: buildHalftimePrompt(), buildDecision60Prompt(), buildDecision80Prompt()
  aiOrchestrator.js     — checkpoint dispatcher: maybeRequestAI(matchId, minute, date)
  schemas.js            — response validation schema + validateAIResponse()

src/config/
  env.js                — EXTENDED: LIVE_AI_* variables

src/store/
  matchStore.js         — EXTENDED: setAiAnalysis(matchId, checkpoint, data, date)

src/tracker/
  snapshotCollector.js  — EXTENDED: fire-and-forget call to aiOrchestrator after snapshot store

src/observability/
  display.js            — EXTENDED: AI status in tracking display
```

---

## ENV (Stage 4)

```bash
LIVE_AI_ENABLED=1
OPENAI_API_KEY=sk-...
LIVE_AI_MODEL=gpt-4o
LIVE_AI_MAX_RETRIES=2
LIVE_AI_TIMEOUT_MS=15000
LIVE_AI_TEMPERATURE=0.2
LIVE_AI_MAX_TOKENS=500
LIVE_AI_HT_XG_THRESHOLD=1.5      # пропускати HT якщо totalXg1H >= цього
```

---

## Flow: snapshotCollector integration

```
collectSnapshot(matchId, scheduleNext, date)
  │
  ├── ... existing steps 1-6 (fetch, parse, discard, delta, store) ...
  │
  ├── [STEP 6.5 — NEW] AI checkpoint check (fire-and-forget)
  │   │
  │   └── aiOrchestrator.maybeRequestAI(matchId, minute, header, match, date)
  │        │
  │        ├── if !LIVE_AI_ENABLED → return
  │        ├── if match.statsLevel !== "detailed" → return (basic = рівень 1, без AI)
  │        ├── if minute matches checkpoint AND filters pass AND not already called:
  │        │     → Promise: aiClient.callAI(prompt)
  │        │       → validate response
  │        │       → matchStore.setAiAnalysis(matchId, checkpoint, result, date)
  │        │       → logger.info('AI analysis complete', { matchId, checkpoint, ... })
  │        └── catch: logger.warn('AI analysis failed', { matchId, checkpoint, error })
  │
  ├── [STEP 7] if Finished → finalCollector
  └── [STEP 7] else → scheduleNext
```

`maybeRequestAI` НЕ awaited — це fire-and-forget. Помилки логуються, але не пропагуються.

---

## Console Display (extended)

```
Tracking (4 active, 1 finished):
  ~  OfvqEnzG  @ 67'  0:0   shots:6/18  xG:0.42/1.55   AI:HT✓ D60✓      next: 72' (4:23)
  ~  GS3Jfzrf  @ 52'  1:0   DISCARDED (goal_before_60)
  ~  ABCdef12  @ 82'  0:0   valid       AI:HT✓ D60✓ D80…  next: 87'
  ✓  XYZ12345  FINISHED  0:1  AI:HT— D60✓ (p00=0.38)
```

Legend: `HT✓` = halftime AI done, `HT—` = skipped (xG filter), `D60…` = in progress, `D60✗` = failed.

---

## Cost Estimation

Per-request costs (gpt-4o, ~500 input + 200 output tokens):
- Halftime: ~$0.004
- Decision60: ~$0.006 (more context)
- Decision80: ~$0.007 (most context)

Per-match: $0.004–$0.017 (1–3 requests, depending on filters)

Daily (10–20 matches): ~$0.10–$0.35/day

Monthly: ~$3–$10

---

## Edge Cases

| Випадок | Обробка |
|---|---|
| **AI timeout** | Retry з backoff; після max retries → `{ output: null, error: "timeout" }` |
| **Invalid JSON (shouldn't happen)** | `response_format: json_object` prevents this; fallback: catch, retry |
| **Probabilities don't sum to 1.0** | Tolerance 5%; if exceeded → retry |
| **OpenAI API down** | Fire-and-forget — snapshots continue normally; error logged |
| **Race: AI writes while snapshot writes** | `matchStore.setAiAnalysis` reads fresh state, merges only `aiAnalysis` field |
| **Match finished before AI responds** | AI result still saved (useful for historical analysis) |
| **Basic statsLevel (no xG)** | AI не викликається взагалі — глобальний фільтр `statsLevel === "detailed"` |
| **HT filter skips** | `aiAnalysis.halftime` set to `{ "output": null, "skipped": true, "reason": "xg_above_threshold" }` |
| **Multiple snapshots on same minute** | Checkpoint check uses `aiAnalysis.{checkpoint} !== undefined` — idempotent |
| **Process restart** | AI state persisted in matches.json; `resume()` won't re-trigger completed checkpoints |
| **OPENAI_API_KEY missing** | `LIVE_AI_ENABLED` check + early return with warning log |

---

## AI Signal Usage (for future Stage 5)

AI output is stored purely for analysis at this stage. Future integration:

```javascript
function getAISignalForLineA(match) {
  const ai = match.aiAnalysis?.decision60?.output
          || match.aiAnalysis?.halftime?.output;
  if (!ai) return null;
  return ai.p_match_ends_0_0 * ai.confidence;
}

function getAISignalForLineB(match) {
  const ai = match.aiAnalysis?.decision80?.output;
  if (!ai) return null;
  return ai.p_match_has_goal * ai.confidence;
}
```

These helper functions are NOT part of Stage 4. They belong to Stage 5 (model/decision engine).

---

## Що далі (Stage 5)

Після збору ≥100 матчів з AI-аналізом:

- **Calibration analysis** — чи AI p_match_ends_0_0 корелює з фактичним результатом?
- **Feature integration** — AI signal як додаткова фіча до статистичної моделі
- **Prompt tuning** — оптимізація промптів на основі calibration
- **Model comparison** — gpt-4o vs gpt-4o-mini accuracy/cost trade-off
- **Telegram alerts** — відправка AI-оцінок у Telegram на точках рішення
