# Спека: P0–P3 фікси 1H AI-движка (ТМ/ТБ 0.5 першого тайму)

**Дата:** 2026-06-17 · **Гілка:** v4.1 · **Статус:** draft на рев'ю

## Контекст і проблема

Ревізія прогнозів за 2026-06-16 (див. [docs/plans/1h-model-fixes-2026-06-17.md](../../plans/1h-model-fixes-2026-06-17.md))
виявила три кореневі дефекти в живому 1H AI-движку ([runOneH_AiDecision.js](../../../src/prediction/runOneH_AiDecision.js)):

1. **Фіктивні коефіцієнти.** EV-гейт рахується на захардкодженій таблиці
   ([oddsTable.js:19-32](../../../src/scoring/oddsTable.js)): ТМ 2.6/2.2 проти реального ринку
   1.45–1.97; ТБ-таблиця ще й **інвертована за часом** (спадає 2.10→1.70, а реально для «гол
   до перерви» вікно скорочується → кеф росте 1.8→2.5). На реальних кефах день = −17%, не +20%.
2. **Напрям не гейтиться консенсусом AI-сигналів.** 3 ставки 06-16 суперечили власним сигналам
   (defensive_issues+H2H_goals на ТМ; xG≈0/SoT0 на ТБ) → 0/3 виграно; узгоджені 5/7.
3. **Ставки проти власної ймовірності.** p=0.45 проходив лише через фіктивний EV.

## Цілі / Non-goals

**Цілі:** чесний EV-гейт на реалістичних кефах; гейт напряму за сигналами; поріг p≥0.50;
промпт, що пріоритезує лайв-докази. **Non-goals (відкладено):** live-кефи від букмекерів
через API; калібрування p на 50+ ставках (P4); багатоденний режим скіла (P5).

## Рішення по пунктах

### P0 — Реалістичні, favorite-aware кефи
- `tm05_1hOddsAt(minute, matchOdds)` / `tb05_1hOddsAt(minute, matchOdds)` — додати `matchOdds`.
- **ТМ-under** прив'язати до прематч-кефа нічиєї `match.odds.draw` (проксі результативності),
  грубі бакети з 06-16 (provisional, калібрується в P4):
  | draw odds | ТМ-under кеф |
  |---|---|
  | < 2.6 | 1.45 |
  | 2.6–3.3 | 1.55 |
  | 3.3–3.8 | 1.70 |
  | ≥ 3.8 | 1.95 |
  Якщо `draw` відсутній → база 1.60.
- **ТБ-over** — реальна **зростаюча** крива за хвилиною: 25–27'→1.80, 30'→2.10, 35'→2.50
  (виправляє інверсію старої таблиці). У v1 — лише крива за хвилиною; нахил за силою
  фаворита **поза скоупом** (YAGNI, до P4).
- Callsite [runOneH_AiDecision.js:100](../../../src/prediction/runOneH_AiDecision.js) передає `match.odds`.
- `data/logs/<date>/real-odds.json` override лишається авторитетним у скілі для бектестів;
  жива гілка бере модель. Live-API від букмекерів — окремий план (non-goal).

### P1 — Гейт напряму за консенсусом (flip-when-confident)
- Новий `src/prediction/signalConsensus.js` — канонічна логіка (перенести з мого
  `analyze.js#classifyContradiction`): класифікує keySignals як goal-leaning / dead-live.
- Напрями взаємодоповнюючі (HT 0:0 vs ≥1 гол) → `pComplement = 1 − p`.
- Після того як AI повернув `direction`, `p`, `keySignals` (перед EV-гейтом):
  - **Впевнене протиріччя** (goal-leaning сигнал вагою `high` на under; або dead-live на over,
    де dead-live = `shotsOnTarget==0` АБО `xG ≤ 0.10` на момент рішення) → **FLIP**:
    `direction=complement`, `p=1−p`, кеф+baseline іншої сторони, прогнати
    EV-гейт; ставимо лише якщо комплемент проходить, інакше SKIP. Записати `flippedFrom`.
  - **Слабке протиріччя** (тільки med/low) → **SKIP** (фаза `skipped_by_consensus`).
  - **Узгоджено** → без змін.

### P2 — Поріг p ≥ 0.50
- Флаг `LIVE_1H_MIN_P` (дефолт 0.50) у [env.js](../../../src/config/env.js).
- Після можливого FLIP: якщо фінальний `p < LIVE_1H_MIN_P` → SKIP (фаза `skipped_by_min_p`),
  незалежно від EV.

### P3 — Промпт пріоритезує лайв + бекстоп P1
- В [oneH_Prompt.js](../../../src/ai/prompts/oneH_Prompt.js): при конфлікті лайв-доказів
  (xG/SoT/удари на момент рішення) з історією (H2H/форма) — довіряти **лайву**, знижувати
  `p`/`confidence` при тихій грі. Детермінований бекстоп — це P1 (без окремого коду).

## Архітектура / межі
- Єдине джерело правди детектора протиріч: `src/prediction/signalConsensus.js`; skill
  `.claude/skills/analyze-predictions/analyze.js` **імпортує** його (прибрати дублювання).
- Порядок гейтів у [runOneH_AiDecision.js](../../../src/prediction/runOneH_AiDecision.js):
  favorite-gate → AI(direction,p,signals) → **P1 consensus (flip/skip)** → **P2 p-floor** →
  P0 real-odds EV-gate → confirm-read / goal-during-decision → signal.

## Конфіг-флаги (нові)
| Флаг | Дефолт | Призначення |
|---|---|---|
| `LIVE_1H_MIN_P` | 0.50 | Поріг ймовірності (P2) |
| `LIVE_1H_CONSENSUS_GATE` | true | Увімкнути P1 (flip/skip) |
| `LIVE_1H_REAL_ODDS` | true | Брати favorite-aware кефи замість плоскої таблиці (P0) |

## Тести (TDD — спершу red)
- **P0** `test/oddsTable.test.js`: реалістичні значення; бакети нічиєї для ТМ; зростаюча ТБ-крива;
  fallback без draw → 1.60.
- **P1** `test/signalConsensus.test.js`: на 06-16 ловить Kuressaare/Akranes/France; flip-when-high;
  skip-when-med/low; `pComplement=1−p`; узгоджені не чіпає.
- **P1/P2** `test/runOneH_AiDecision.test.js`: flip→EV комплемента; p<0.50→skip; flip підняв p→не skip.
- **Регрес** через skill: на real-odds.json + P1/P2 день 06-16 виходить з −17% (очікувано ~+18.6%).

## Верифікація (вимога користувача — після green)
1. **Code review** — `superpowers:requesting-code-review` (субагент-рев'ю на відповідність спеці,
   тести, регресії).
2. **Business-logic review** — окремий фокусований прохід: коректність EV-математики, `pComplement=1−p`,
   логіки flip/skip, напряму кефів (ТБ зростає, ТМ за нічиєю), порядку гейтів; перевірити, що P0/P1/P2
   не дають хибних ставок на 06-16.

## Поведінковий вплив / ризики
- **Обсяг ТМ різко впаде**: на кефі ~1.6 беззбитковість ~62%, тож більшість 06-16 ТМ не пройдуть EV.
  Навмисно (лінія була −33%). Ризик: мало ставок → повільніше калібрування (приймаємо).
- Бакети ТМ і ТБ-крива — **provisional на 7 точках**; уточнюються в P4. Позначити в коді.
- FLIP на малій вибірці — ризик; пом'якшено умовою «тільки high-weight» + комплемент-EV-гейтом.

## Відкладено (записано, не робимо зараз)
- **P4** калібрування p на 50+ ставках. **P5** багатоденний режим скіла + автозбір кефів.
- **Live-кефи від букмекерів через API** — продумати шлях інтеграції окремим планом.

## Список змін по файлах
- `src/scoring/oddsTable.js` — P0 (нові таблиці/функції з matchOdds).
- `src/prediction/signalConsensus.js` — **новий**, P1.
- `src/prediction/runOneH_AiDecision.js` — оркестрація P1/P2 + передача odds у P0.
- `src/config/env.js` — нові флаги.
- `src/ai/prompts/oneH_Prompt.js` — P3.
- `.claude/skills/analyze-predictions/analyze.js` — імпорт signalConsensus.
- `test/oddsTable.test.js`, `test/signalConsensus.test.js`, `test/runOneH_AiDecision.test.js` — тести.
