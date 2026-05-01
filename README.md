# parserFootballOdds

Live-пайплайн: мобільний Flashscore (кандидати 0:0) → десктопна сторінка матчу → статистика → модель → логи / Telegram.

## NPM-скрипти

| Скрипт | Опис |
|--------|------|
| `npm run parse` | Аліас на `node index.js` (один цикл без `--watch`). |
| `npm run live` | Один повний цикл скану (без нескінченного циклу). |
| `npm run live:watch` | Безперервний режим; інтервал паузи з `LIVE_POLL_INTERVAL_MS` (дефолт у коді). |
| `npm run live:watch:anytime` | Як `live:watch`, але **ігнорує робочі години** (еквівалент `LIVE_IGNORE_HOURS=1`). |
| `npm run live:watch:3m` | Як `live:watch`, пауза **3 хв** між циклами. |
| `npm run live:watch:3m:anytime` | 3 хв + ігнор робочих годин. |
| `npm run live:watch:5m` | Як `live:watch`, пауза **5 хв**. |
| `npm run live:watch -- --ignore-hours` | Додати прапорець до будь-якого скрипта з `node index.js --watch` у кінці команди. |
| `npm run live:start` | Фоновий запуск через `scripts/live-start.sh` (`nohup` + `caffeinate`). |
| `npm run live:stop` | Зупинка процесу з PID-файлу `.pids/live-watch.pid`. |
| `npm run live:status` | Чи працює live-watcher і де лог `logs/live-watch.log`. |
| `npm run service:install` | macOS `launchd`: генерує plist, автозапуск і рестарт при падінні. |
| `npm run service:uninstall` | Видаляє сервіс з LaunchAgents. |
| `npm run service:start` | `launchctl start com.parser.football`. |
| `npm run service:stop` | `launchctl stop com.parser.football`. |
| `npm run service:status` | Статус сервісу в launchd. |
| `npm run service:logs` | `tail -f logs/launchd-stdout.log`. |
| `npm run deploy` | На сервері: `git pull`, `npm install --production`, рестарт launchd-сервісу. |
| `npm run build` | `node scripts/rebuild.js`. |
| `npm run analyze` | Офлайн-аналіз даних `data/*.json`. |
| `npm run analyze-g` | Варіант групового аналізу (`analyzeGroupe.js`). |

Скопіюй `.env.example` у `.env` і заповни секрети перед запуском.

## Змінні середовища (`.env`)

| Змінна | Обов’язково | Опис |
|--------|-------------|------|
| `TELEGRAM_TOKEN` | так* | Токен бота Telegram Bot API. |
| `TELEGRAM_CHAT_ID` | так* | ID чату для повідомлень (приватний або група, якщо бот доданий). |
| `LIVE_BASE_URL` | ні | URL мобільного лайву. За замовчуванням: `https://m.flashscore.ua/?s=2`. |
| `LIVE_POLL_INTERVAL_MS` | ні | Пауза між циклами в watch-режимі (мс). Дефолт: `180000` (3 хв). |
| `STATS_CONCURRENCY` | ні | Паралельність відкриття сторінок статистики. Дефолт: `2`. |
| `LIVE_MIN_CANDIDATE_MINUTE` | ні | Мінімальна хвилина матчу для кандидата 0:0, діапазон 0–120. Дефолт: `60`; для продакшену часто `60`. |
| `LIVE_IGNORE_HOURS` | ні | Якщо `1` / `true` / `yes` — ігнорувати обмеження робочих годин (тести вдень). Те саме дає запуск з `--ignore-hours` (див. `live:watch:anytime`). |
| `MIN_EDGE` | ні | Зарезервовано під поріг edge для рішень; у поточному коді може не читатися — залишено в `.env.example` для сумісності. |

\* Без Telegram скрипт працює, але відправка повідомлень падатиме або логуватиме помилку.

**Константи в коді** (без `.env`): `MAX_TELEGRAM_MINUTE=84` — сигнали в Telegram лише до 84′; робочі години: будні 17:00–23:00, пт–нд 16:00–23:00 (локальний час машини), якщо не ввімкнено `LIVE_IGNORE_HOURS`.

## Короткий runbook для іншого сервера

1. **Перший запуск**
   - Клонувати репозиторій і перейти в директорію проєкту.
   - Встановити залежності: `npm install`.
   - Створити `.env` на базі `.env.example` і заповнити токени.
   - Перевірити один цикл: `npm run live`.

2. **Постійний запуск як сервіс (рекомендовано на macOS)**
   - Встановити launchd-сервіс: `npm run service:install`.
   - Запустити сервіс: `npm run service:start`.
   - Перевірити статус: `npm run service:status`.
   - Дивитись лог: `npm run service:logs`.

3. **Оновлення через репозиторій**
   - Стандартно: `git pull --ff-only`.
   - Або одним кроком (pull + install + restart): `npm run deploy`.

4. **Ручний watcher-режим (без launchd)**
   - Запуск: `npm run live:start`.
   - Статус: `npm run live:status`.
   - Зупинка: `npm run live:stop`.

---

## Лінія 1 (v3.3) — P_dry Consensus + Trajectory

Нова паралельна стратегія ТМ 0.5 з раннім моніторингом 1H→2H. Працює поряд з v3, не замінює її.

**За замовчуванням вимкнено.** Для запуску:
```
LINE1_ENABLED=1 LINE1_SHADOW_MODE=1 npm run live:watch:v3
```

**Команди:**
```bash
# Денний звіт shadow-режиму
npm run line1:shadow-report -- 2026-05-01

# Preliminary backtest на існуючих логах
npm run line1:calibrate -- --validate-only
```

**Документація:**
- Спек: `docs/superpowers/specs/2026-04-30-line1-pdry-consensus-trajectory-design.md`
- План: `docs/superpowers/plans/2026-04-30-line1-pdry-consensus-trajectory.md`
- Наступні кроки: `docs/superpowers/plans/line1-next-steps.md`
