# matchStore Atomic + Debounced Persist

**Дата:** 2026-05-11
**Гілка:** v4

## Що зроблено

1. **Atomic write** — `matchStore.writeStore` пише в `matches.json.tmp` і робить `renameSync`. POSIX-атомарність → файл або повністю старий, або повністю новий.
2. **In-memory cache** — `readStore` повертає cached state; `writeStore` мутує cache і скидає на диск.
3. **Debouncing** — опційно через `MATCHSTORE_DEBOUNCE_MS` (мс). Default `0` = синхронна поведінка.
4. **`flushSync(date)` / `flushAll()`** — експортовані, використовуються в `finalize()` і shutdown handler.
5. **`process.on('exit')`** — belt+suspenders flush для ad-hoc скриптів (зареєстровано через `global` flag, один listener на процес).

## Як вмикати в production

У `.env` (або при запуску):

```
MATCHSTORE_DEBOUNCE_MS=500
```

500 мс — компроміс: write amplification падає в ~20-50× (групує множинні mutations одного матча в один flush), при цьому ризик втрати — ≤ 500 мс активних даних при kill -9.

## Гарантії

- `finalize()` завжди робить sync flush — телеграм/result-сповіщення йде тільки після disk-persistence.
- `SIGINT`/`SIGTERM` через `runWatch.shutdown` робить `flushAll()`.
- `process.on('exit')` як belt+suspenders для ad-hoc скриптів.
- Корупція файлу при збої виключена (atomic rename).
- `flushSync` повертає `true` коли дані на диску (щойно записані або вже були персистовані).

## Що **не** зроблено (свідомо)

- DB-міграція (SQLite/Postgres) — окрема велика задача.
- Розділення на per-match файли — окрема задача.
- Конкурентний доступ — не потрібен (single-process).

## Релевантні коміти

- `d7a71dd` — atomic write
- `7d5f37b` — cache + flushSync/flushAll
- `33c5a68` — finalize sync, shutdown wiring, exit handler
- `3c42468` — guard exit-handler registration
