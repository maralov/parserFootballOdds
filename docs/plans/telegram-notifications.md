# Telegram-нотифікації для прогнозів (entry → result thread)

**Статус:** 📝 Plan
**Власник:** prediction pipeline / observability
**Залежності:** RFC-alignment (`prediction-model-rfc-alignment.md` — ✅ Реалізовано)
**Архітектурний стиль:** out-of-band дispatcher (відокремлений від prediction pipeline через store + hook), без блокування основного циклу.

---

## 1. Бізнес-контекст

Після виконання RFC-alignment ми вже маємо:
- `data/logs/<date>/matches.json` — повна історія всіх прогнозів (actionable + не).
- `data/logs/<date>/prediction-signals.json` — тільки **actionable** (primary FT_TM05/TB80+ + PROTECT_UNDER).
- `match.predictions.<decision>.predictionAudit.hit` — заповнюється після `matchStore.finalize()`.

**Ціль етапу:** щоб actionable прогнози не лежали в JSON, а **автоматично летіли в Telegram-канал** як trade-сигнали з результатами через тред.

### Ключові продуктові рішення (зафіксовано)

| Питання | Рішення |
|---------|---------|
| Звідки odds | З вже існуючого `match.odds` (1X2 home/draw/away + `isOddsFavorite`) — pre-match Flashscore. Окремий скрапер не потрібен. |
| Які прогнози шлемо | Тільки **primary**: `FT_TM05_FROM_60_75` (decision60) + `TB05_80_PLUS` (decision80). LEAN/RISK/PROTECT_UNDER **не шлемо** в TG (залишаються в JSON). |
| Тред entry↔result | `reply_to_message_id` — result надсилається як відповідь на entry-повідомлення в каналі. |
| Опис прогнозу | Список ключових `components` + `riskFlags` + AI-вердикт (технічно, без LLM-фрази). |
| Тег моделі | Емітимо `mode` як людський лейбл: `Базовий` / `Повний` / `Повний АІ`. |
| Канал | Один загальний канал (`TELEGRAM_CHAT_ID`) — для primary entry+result. |

---

## 2. Цільовий вигляд повідомлень

### 2.1 Entry-повідомлення (на момент рішення)

```
🎯 FT TM0.5 · Повний АІ · 65'
🏟 *Borussia Dortmund — Bayern Munich*
🏆 Bundesliga · 0:0

📊 Параметри рішення:
• fullTimeNilNilScore: 78
• dryStateScore: 82
• realPressureScore60_75: 18
• fakePressureScore60_75: 35 (sterile)
• lateActivationRisk: 22
• AI: dead_match (premium upgrade)
• Confidence: 0.81
• Risk flags: HIGH_FAKE_PRESSURE

💰 Pre-match odds:
• 1: 1.80 · X: 3.60 · 2: 4.50 · fav: home (margin 0.20)

🔗 [Flashscore desktop](https://www.flashscore.com/match/abcd1234/)
```

### 2.2 Result-повідомлення (як reply на entry)

#### HIT (FT TM0.5 = 0:0)
```
✅ HIT · FT TM0.5
Фінал: 0:0 · доданих хв 4'
Прогноз тримався 30' (від 65' до 95').
```

#### MISS
```
❌ MISS · FT TM0.5
Фінал: 1:0 (гол на 78')
Прогноз тримався 13' до пробою.
```

#### TB80+
```
✅ HIT · TB0.5 (after 80')
Гол на 87' (Lewandowski, home) → 1:0
```

```
❌ MISS · TB0.5 (after 80')
Фінал: 0:0 — голу після 80' не було.
```

---

## 3. Архітектура: out-of-band dispatcher

Принцип — **prediction pipeline нічого не знає про Telegram**. Ми додаємо два хука:

```
appendSignalsIfEligible (runLivePrediction.js)
        │
        ▼
   prediction-signals.json (вже є)
        │
        ▼
   tg-outbox.json (новий — append-only with status FSM)
        │
        ▼
   tgDispatcher.flush() (новий — pure I/O)
        │
        ▼
   Telegram Bot API (sendMessage)
        │
        ▼
   tg-outbox.json (update entryMessageId, status='pending_result')


matchStore.finalize() → applyPredictionHits()
        │
        ▼
   tgDispatcher.dispatchResults(match)
        │
        ▼
   Telegram Bot API (sendMessage with reply_to_message_id)
        │
        ▼
   tg-outbox.json (update resultMessageId, status='resolved')
```

### Чому окремий outbox, а не пишемо одразу

1. **Crash safety**: запис у outbox = транзакційний намір. Якщо процес упав між записом у `prediction-signals.json` і відправкою — наступний flush повторить.
2. **Idempotency**: outbox-ключ `matchId + decisionKey` гарантує одну відправку.
3. **Тестованість**: dispatcher працює з outbox, без знання про prediction pipeline.
4. **Retry/throttle**: у нас один центральний state, де лежать `attempts`, `lastError`, `nextRetryAt`.

---

## 4. Структури даних

### 4.1 `data/logs/<date>/tg-outbox.json` (новий)

```json
[
  {
    "matchId": "KvzyKxD4",
    "decisionKey": "decision60",
    "predictionType": "FT_TM05_FROM_60_75",
    "tier": "ai_premium_upgrade",
    "modelMode": "detailed_ai",
    "createdAt": "2026-05-09T20:35:12.123Z",
    "status": "pending_result",
    "entry": {
      "messageId": 12345,
      "sentAt": "2026-05-09T20:35:13.456Z",
      "attempts": 1,
      "lastError": null
    },
    "result": {
      "messageId": null,
      "sentAt": null,
      "attempts": 0,
      "lastError": null,
      "hit": null
    },
    "snapshot": {
      "minute": 65,
      "score": "0:0",
      "confidence": 0.81,
      "components": { "...": "..." },
      "riskFlags": ["HIGH_FAKE_PRESSURE"],
      "aiVerdict": "dead_match"
    }
  }
]
```

**Стани (FSM):**
- `queued` — записано в outbox, ще не відправлено (rare, тільки при crash recovery)
- `pending_result` — entry успішно відправлено, очікуємо finalize
- `resolved` — result відправлено
- `failed` — обидві спроби (entry або result) провалились після `LIVE_TG_MAX_RETRIES`

### 4.2 Розширення `match.predictions.<decision>` (опційно, для UI/debug)

Додаємо легкий маркер у `predictions.decision60.tg`:
```json
"tg": { "queued": true, "queuedAt": "..." }
```
Дозволяє в `matches.json` бачити, який прогноз пішов у TG. Не впливає на жодну логіку.

---

## 5. Файлова структура

| Файл | Дія | Опис |
|------|-----|------|
| `src/integrations/telegram/client.js` | DONE ✅ | axios-обгортка з retry, escape Markdown, повертає `message_id` |
| `src/integrations/telegram/formatters/entryMessage.js` | DONE ✅ | `formatEntryMessage(payload)` |
| `src/integrations/telegram/formatters/resultMessage.js` | DONE ✅ | `formatResultMessage(payload)` |
| `src/integrations/telegram/formatters/flashscoreUrl.js` | DONE ✅ | `buildFlashscoreDesktopUrl(match.matchUrl)` |
| `src/integrations/telegram/formatters/modeLabels.js` | DONE ✅ | `'basic' → 'Базовий'`, `'detailed' → 'Повний'`, `'detailed_ai' → 'Повний АІ'` |
| `src/store/tgOutbox.js` | DONE ✅ | CRUD по `tg-outbox.json` (idempotent append, find by status, update FSM) |
| `src/integrations/telegram/dispatcher.js` | DONE ✅ | `enqueueEntry(match, prediction, decisionKey)` + `flushEntries()` + `dispatchResults(match)` |
| `src/prediction/runLivePrediction.js` | DONE ✅ | у `appendSignalsIfEligible` після фільтра primary → `dispatcher.enqueueEntry(...)` |
| `src/store/matchStore.js` | DONE ✅ | у `finalize()` ПІСЛЯ `applyPredictionHits(match)` → `dispatcher.dispatchResults(match, date)` |
| `src/config/env.js` | DONE ✅ | додати `LIVE_TG_ENABLED`, `LIVE_TG_DRY_RUN`, `LIVE_TG_MAX_RETRIES`, `LIVE_TG_RETRY_BASE_MS` |
| `.env.example` | DONE ✅ | додати нові env-змінні |
| `test/telegram.test.js` | NEW | unit-тести: format, escape, URL builder, outbox FSM, dispatcher dry-run |
| `scripts/tgReplay.js` | NEW (опц.) | проходить по past `matches.json`, наповнює outbox для backfill (опціонально) |

---

## 6. Atomic tasks (subagent-driven implementation)

### T1 — Telegram client + Markdown escape

**Файли:** `src/integrations/telegram/client.js`, `test/telegram.test.js`

- Експортує `sendMessage({ text, replyToMessageId, parseMode='MarkdownV2', disableWebPagePreview=true })` → `{ messageId, ok, error }`.
- Підтримує `LIVE_TG_DRY_RUN=1` → не шле, але повертає синтетичний `messageId = -1`.
- Якщо `TELEGRAM_TOKEN` або `TELEGRAM_CHAT_ID` не задані → `ok=false, error='disabled'` (no-throw).
- Експортує `escapeMarkdownV2(text)` — escape `_*[]()~`!#+-=|{}.>` (специфікація MarkdownV2).
- Retry: при HTTP 5xx або network error → exponential backoff (`LIVE_TG_RETRY_BASE_MS`, до `LIVE_TG_MAX_RETRIES`).
- Тести: dry-run, escape, retry counter.

### T2 — `tgOutbox.js` store з FSM

**Файли:** `src/store/tgOutbox.js`, `test/telegram.test.js`

- API:
  - `enqueue(dayDir, payload)` — idempotent по `matchId+decisionKey` (existing → no-op + return existing record).
  - `markEntrySent(dayDir, key, { messageId, sentAt })` → `status='pending_result'`.
  - `markEntryFailed(dayDir, key, { error, attempts })` → `status='failed'` після MAX_RETRIES.
  - `findPendingResult(dayDir)` → `Array<record>`.
  - `findByMatchId(dayDir, matchId)` → `Array<record>`.
  - `markResultSent(dayDir, key, { messageId, sentAt, hit })` → `status='resolved'`.
- Storage: `tg-outbox.json` як array (як `prediction-signals.json`), atomic write через temp file rename.
- Тести: idempotency, FSM transitions, concurrent-safe write.

### T3 — Форматери (entry, result, URL, mode labels)

**Файли:** `src/integrations/telegram/formatters/*.js`, `test/telegram.test.js`

- `buildFlashscoreDesktopUrl(matchUrl)`:
  - Input може бути `/match/ID/?s=2`, `https://www.flashscore.mobi/match/ID/`, або вже `https://www.flashscore.com/match/ID/`.
  - Витягує `ID` regex'ом → `https://www.flashscore.com/match/${ID}/#match-summary`.
  - Якщо ID не знайдено → return null.
- `MODE_LABELS = { basic: 'Базовий', detailed: 'Повний', detailed_ai: 'Повний АІ' }`.
- `formatEntryMessage({ match, prediction, decisionKey, minute, score })`:
  - Markdown V2 layout (див. п.2.1).
  - Components — рендеримо тільки top-N з whitelist: `fullTimeNilNilScore`, `dryStateScore`, `realPressureScore60_75`, `realPressureScore70_80`, `fakePressureScore60_75`, `lateActivationRisk`, `lateGoalScore80` (для TB), `aiScenarioScore`.
  - Risk flags — list як `HIGH_FAKE_PRESSURE, LATE_PRESSURE_SPIKE`.
  - AI verdict: з `prediction.aiOverlay.scenario` + tier (`ai_premium_upgrade` / `ai_downgrade` / null).
  - Odds: рендеримо лише якщо `match.odds.home` і не `null`. Інакше блок прибираємо.
  - Якщо команд немає → return null (не шлемо).
- `formatResultMessage({ outboxRecord, match })`:
  - Аналогічно п.2.2 (HIT/MISS, фінал, мінута гола для TB80).
  - Хвилина гола: з `match.final.goals` (regular goals only).
- Тести: snapshot tests на готових fixtures (fixed match.odds, components, etc.).

### T4 — Dispatcher (entry side)

**Файли:** `src/integrations/telegram/dispatcher.js`, `test/telegram.test.js`

- `enqueueEntry(match, prediction, decisionKey, date)`:
  - Перевіряє `LIVE_TG_ENABLED` → no-op якщо `0`.
  - Фільтр **тільки primary**: `FT_TM05_FROM_60_75` або `TB05_80_PLUS`. Інакше return.
  - Викликає `tgOutbox.enqueue(...)`. Якщо вже existing → no-op.
  - Викликає `client.sendMessage(...)` з `formatEntryMessage(...)`.
  - Success → `tgOutbox.markEntrySent(...)`.
  - Failure → `tgOutbox.markEntryFailed(...)` (після retries в client).
  - Логуємо у `logger.info('tg.entry.sent', {...})`.
- Hook: у `runLivePrediction.appendSignalsIfEligible()` ПІСЛЯ запису в `prediction-signals.json` →
  ```js
  tgDispatcher.enqueueEntry(match, evaluated, evaluated.decisionKey, date);
  ```
  (`decisionKey` ← `'decision60'` / `'decision80'` додамо в evaluated, або визначимо з checkpoint).
- Тести: dry-run відправляє і пише outbox; повторний виклик з тим же matchId+decision = no-op.

### T5 — Result dispatcher

**Файли:** `src/integrations/telegram/dispatcher.js` (продовження), `src/store/matchStore.js`, `test/telegram.test.js`

- `dispatchResults(match, date)`:
  - Перевіряє `LIVE_TG_ENABLED`.
  - `tgOutbox.findByMatchId(dayDir, match.matchId)` → для кожного запису зі `status='pending_result'`:
    - Формуємо `formatResultMessage(...)`.
    - Шлемо з `replyToMessageId = entry.messageId`.
    - Success → `tgOutbox.markResultSent(...)`.
    - Failure → інкрементуємо `result.attempts`; якщо ≥ MAX_RETRIES → `status='failed'`.
- Hook: `matchStore.finalize()` ПІСЛЯ `applyPredictionHits(match)`:
  ```js
  try {
    tgDispatcher.dispatchResults(match, date);
  } catch (err) {
    logger.warn('tg.dispatchResults.failed', { matchId, err: err.message });
  }
  ```
  Помилка ніколи не блокує `finalize`.
- Тести: hit→HIT message; miss→MISS message; reply_to_message_id передається; idempotency (повторний finalize не шле дубль).

### T6 — Crash recovery flush

**Файли:** `src/integrations/telegram/dispatcher.js`, `src/orchestrator/runWatch.js`, `test/telegram.test.js`

- `flushPending(date)`:
  - На старті cycle / watch:
    - `tgOutbox.findByStatus(dayDir, 'queued')` → пробуємо знову відправити entry.
    - `tgOutbox.findByStatus(dayDir, 'pending_result')` де матч уже finalized → пробуємо знову відправити result.
- Hook: на початку `runWatch.js` cycle (після завантаження store).
- Тести: симуляція crash між `enqueue` і `markEntrySent` → `flushPending` довідправляє.

### T7 — Env + конфіг + `.env.example`

**Файли:** `src/config/env.js`, `.env.example`

- Нові змінні:
  ```
  LIVE_TG_ENABLED=1
  LIVE_TG_DRY_RUN=0
  LIVE_TG_MAX_RETRIES=3
  LIVE_TG_RETRY_BASE_MS=1000
  ```
- Документ у `.env.example` пояснює, що `TELEGRAM_TOKEN`+`TELEGRAM_CHAT_ID` лишаються вимушеними при `LIVE_TG_ENABLED=1`.
- Якщо `LIVE_TG_ENABLED=0` → жодних викликів TG, outbox не пишеться.

### T8 — Backfill / replay tool (опціонально)

**Файл:** `scripts/tgReplay.js`

- Прохід по `data/logs/<date>/matches.json` для заданих дат.
- Знаходить актуальні primary прогнози.
- Якщо в `tg-outbox.json` немає запису — створює з `status='queued'`.
- Якщо матч уже finalized — формує і відправляє і entry, і result у тред.
- Корисно для:
  - первинного запуску (історія за тиждень → одним прогоном);
  - відновлення після disaster recovery.
- CLI: `node scripts/tgReplay.js --from 2026-05-01 --to 2026-05-08 [--dry-run]`.

### T9 — Тести (інтеграційний smoke)

**Файл:** `test/telegram.test.js` (доповнення)

- E2E flow з фіктивним TG-stub:
  1. Симулюємо `evaluatePrediction` → `appendSignalsIfEligible` → outbox містить запис, stub отримав entry.
  2. Симулюємо `matchStore.finalize` → outbox запис updated, stub отримав result з `replyToMessageId`.
  3. Перевіряємо, що повторний `finalize` не шле дубль.

---

## 7. Edge-кейси та політики

| Кейс | Поведінка |
|------|-----------|
| `TELEGRAM_TOKEN` не задано | dispatcher → no-op (logger.warn один раз на startup), outbox не пишеться. |
| Команд або league немає в matches.json | `formatEntryMessage` → `null`, dispatcher логує `tg.entry.skipped` і **не** робить enqueue. |
| `match.odds.home === null` | Блок odds прибирається з повідомлення. |
| Прогноз ре-оцінений (frozen) на наступних tick'ах | `enqueueEntry` idempotent → no-op. Гарантовано один entry на (matchId, decisionKey). |
| Decision60 + Decision80 на одному матчі | Два окремі threads (два entry, два result). Це нормально — це різні bets. |
| TB80+ HIT швидкий (гол на 81', а ми тільки відправили entry на 80') | `dispatchResults` спрацьовує тільки в `finalize`, тобто result прийде вже після кінця матчу. Інтервал між entry і result може бути 5–15 хв — це OK. |
| Telegram API rate limit (429) | client retry з backoff (читаємо `Retry-After` header). |
| Команди мають Markdown special chars (`_Wolves_FC*`) | `escapeMarkdownV2` екранує. |
| Crash після `markEntrySent` але до `setPrediction` | Безпечно — outbox state не залежить від `matches.json`. |

---

## 8. Відкриті питання (не блокуючі для T1–T7)

1. **Топік / Channel splitting:** зараз — один канал. Якщо в майбутньому захочемо `RISK`/`LEAN` — додамо окремий `LIVE_TG_EXPERIMENTAL_CHAT_ID`. Архітектура dispatcher'а вже підтримує (chat_id як параметр).
2. **Telegram Topics (forum):** `message_thread_id` — можна додати в client як опціональний параметр. Не блокує MVP.
3. **AI-генерована 1-реченьова саммарі:** користувач обрав components-list. Якщо знадобиться — додамо опціональний AI-call у formatter (нова task T10).
4. **Live odds (post-decision)** — користувач обрав pre-match `match.odds`. Якщо потрібні live betting odds — окремий стейдж скрапінгу (out of scope).
5. **Editorial polish** (емодзі, форматування) — після першого тижня у production.

---

## 9. Послідовність реалізації

```
T1 (client) ──► T2 (outbox) ──► T3 (formatters) ──► T4 (entry dispatcher)
                                                      │
                                                      ├──► T5 (result dispatcher)
                                                      │
                                                      └──► T6 (crash recovery)
                                                            │
                                                            ▼
                                                          T7 (env)
                                                            │
                                                            ▼
                                                          T9 (E2E test)
                                                            │
                                                            ▼
                                                          T8 (backfill, опційно)
```

T1, T2, T3 — **паралельні** (немає залежностей між собою). T4 потребує T1+T2+T3.

---

## 10. Definition of Done

- [ ] `npm test` проходить (включно з новими TG-тестами).
- [ ] `LIVE_TG_DRY_RUN=1` дозволяє запустити повний `runWatch.js` без реальних викликів TG, з повним заповненням `tg-outbox.json`.
- [ ] Для одного завершеного primary прогнозу в `tg-outbox.json` міститься запис у стані `resolved` з заповненими `entry.messageId` і `result.messageId`.
- [ ] Жодна помилка TG-API не призводить до краху `matchStore.finalize` або `runLivePrediction`.
- [ ] `.env.example` оновлено, документація в README/`docs/stages/` згадує цей етап.
- [ ] `scripts/tgReplay.js` (якщо T8) — успішно проганяє минулу дату без дублів.

---

## 11. Метрики успіху (через тиждень після запуску)

- **% primary прогнозів, що дійшли до TG**: 100% (за вирахуванням `LIVE_TG_ENABLED=0`).
- **% entry → result connection**: 100% з тих, що мають `final` (тред повинен зімкнутись).
- **TG API error rate**: < 1% (після retry).
- **Mean latency entry sent**: < 3 секунди від `appendSignalsIfEligible`.
- **Дублі в каналі**: 0.

---

## ✅ Implementation summary (after T1–T6)

- T1 ✅ — `src/integrations/telegram/client.js` (axios + MarkdownV2 escape + retry/dry-run, 10 tests)
- T2 ✅ — `src/store/tgOutbox.js` (FSM + atomic writes, 13 tests)
- T3 ✅ — `src/integrations/telegram/formatters/{markdown,modeLabels,flashscoreUrl,entryMessage,resultMessage}.js` (9 tests)
- T4 ✅ — `src/integrations/telegram/dispatcher.js` (entry side + setImmediate hook + concurrency lock, 8 tests)
- T5 ✅ — result side dispatch + `matchStore.finalize` hook + concurrency lock + persisted-write gate (9 tests)
- T6 ✅ — `flushPending()` startup recovery + `runWatch.js` hook (6 tests, finished-status gate)
- T7 ✅ — `.env.example` updated, legacy `sendTelegramMessage.js` removed

Total: telegram tests 56/56, prediction regression 71/71.
