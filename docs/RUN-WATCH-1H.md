# Запуск 1HUNDER (`watch-1h`) на іншому компʼютері

Режим збору даних: працює **лише** лінія першого тайму (ТМ 0,5 тайму).
A/B-лінії вимкнені. Сигнали йдуть у Telegram з позначкою «некалібровано»,
а на перерві приходить підсумок (HIT/MISS) відповіддю на сигнал.

## 1. Вимоги

- **Node.js 18+** (рекомендовано 20/22).
- **git**.

## 2. Клонування + гілка

```bash
git clone https://github.com/maralov/parserFootballOdds.git
cd parserFootballOdds
git checkout feat/1hunder-watch-1h
```

## 3. Залежності

```bash
npm install
# браузерний фолбек фетчера (один раз):
npx playwright install chromium
```

## 4. Налаштування `.env`

```bash
cp .env.example .env
```

Відредагуй у `.env` як мінімум:

```ini
# Telegram — обовʼязково для сигналів і підсумків
TELEGRAM_TOKEN=<токен_бота>
TELEGRAM_CHAT_ID=<id_чату_або_каналу>
LIVE_TG_ENABLED=1
LIVE_TG_DRY_RUN=0          # 1 = тест без реальної відправки (лог замість повідомлення)

# Години роботи (за замовч. 16:00–23:00). Для тесту будь-коли — постав 1:
LIVE_IGNORE_HOURS=0

# Enrichment потрібен, щоб визначати фаворита (за замовч. вже 1)
LIVE_ENRICHMENT_ENABLED=1
```

> `LIVE_1H_ENABLED`, `LIVE_1H_ONLY` і `LIVE_TRACKER_ENABLED=0` **виставляє сам скрипт** —
> їх у `.env` чіпати не треба.

Параметри моделі (можна лишити дефолти): вікно відкриття `LIVE_1H_OPEN_MIN/MAX`,
вікно рішення `LIVE_1H_DECISION_MIN/MAX`, поріг `LIVE_1H_DS_THRESHOLD_MIN`,
коеф-базлайн `LIVE_1H_BASELINE_P` — усе в секції «Stage 6» у `.env.example`.

## 5. Запуск

```bash
# у робочі години (за розкладом LIVE_WORKING_HOURS_*)
npm run watch-1h

# або одразу, ігноруючи години (для тесту):
npm run watch-1h:anytime
```

Перевірити, що це справді 1H-only режим — у логах при старті буде:
`watch-1h: starting in 1HUNDER-only data-collection mode`.

Зупинка — `Ctrl+C`.

## 6. Де лежать дані

Усе пишеться по днях у `data/logs/YYYY-MM-DD/`:

- `matches.json` — кожен відібраний матч + `predictions.tm05_1h`
  (`dsScore`, `phase`, `evGate`, а після перерви — `htOutcome { score, dry, firstGoalMinute }`).
  Сюди потрапляють **усі** кандидати, навіть ті, що не дійшли до сигналу — це і є дата-сет для калібрування.
- `tg-outbox.json` — стан Telegram-повідомлень (сигнал + підсумок).

## 7. Швидка перевірка без Telegram

Постав `LIVE_TG_DRY_RUN=1` і `LIVE_IGNORE_HOURS=1` — система працюватиме,
збиратиме дані й логуватиме повідомлення замість реальної відправки.
