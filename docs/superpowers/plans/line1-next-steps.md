# Лінія 1 — Наступні кроки після Shadow Rollout

## Тиждень 1 (shadow active)
- [ ] Запустити в продакшні: `LINE1_ENABLED=1 LINE1_SHADOW_MODE=1`
- [ ] Щоденно перевіряти: `npm run line1:shadow-report`
- [ ] Збирати ~7-14 днів даних перед аналізом

## Тиждень 2 (calibration)
- [ ] Re-scrape історичних матчів для отримання реальних 1H stats
- [ ] Запустити logistic regression для калібрування ваг
- [ ] Налаштувати per-league baselines в `src/helpers/leagueBaselines.js`
- [ ] Tune thresholds: знайти P_dry cutoff де HR≥60% AND recall≥25%

## Тиждень 3 (активація)
- [ ] Перевірити: shadow HR ≥55% за останні 14 днів?
- [ ] Якщо так: `LINE1_SHADOW_MODE=0` → активні TG сигнали
- [ ] Перші 7 днів — щоденний моніторинг
- [ ] Критерій зупинки: HR (rolling 14d) < 50% → повернути в shadow

## Паралельно
- [ ] Інтегрувати реальні кф ТМ 0.5 з GGBet (`scrapeGGBetOdds.js` вже є)
- [ ] Налаштувати EV-фільтр: skip якщо кф < 1.50 (break-even при HR=67%)
- [ ] Розробка Лінії 2 (явний лідер + сухий матч → гол у кінці)
