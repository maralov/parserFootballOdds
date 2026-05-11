# Stage 1 — Live Scraper (Candidates Collector)

**Status:** ✅ Done (2026-05-07)
**Branch:** `v4`

Збірка кандидатів-матчів на перерві (`halftime` / `45+'`) з рахунком `0:0`. Вихід — `data/logs/YYYY-MM-DD/candidates.json` для подальшого enrichment та аналізу.

---

## Архітектура

```
scripts/once.js          ─► npm run parse           (одиночний цикл)
scripts/watch.js         ─► npm run watch           (endless live mode)

orchestrator/
  runOnce.js             — один cycle (fetch → parse → select → store → sleep)
  runWatch.js            — нескінченний loop з adaptive sleep
  computeSleep.js        — формула адаптивного sleep

fetcher/
  httpFetcher.js         — axios + UA rotation + exponential retry
  browserFetcher.js      — playwright + stealth (lazy fallback)
  resilientFetcher.js    — http first, browser fallback
  antibot/
    contextFactory.js    — isolated BrowserContext per request
    routeBlocker.js      — abort image/font/media/ads/analytics
    delays.js            — randomDelay / backoffDelay

parser/
  liveBoardParser.js     — cheerio: HTML → LiveMatch[]
  candidateSelector.js   — LiveMatch[] → { candidates, potentialSleepers }
  minuteUtils.js         — "45+'" → 46, "halftime" → 45 etc.
  urlUtils.js            — extractMatchId from /match/ID/

store/
  datasetStore.js        — data/logs/YYYY-MM-DD/candidates.json
  cycleLog.js            — cycles.ndjson
  alertLog.js            — alerts.ndjson

observability/
  logger.js              — JSON-line logger (debug/info/warn/error)
  display.js             — UI-friendly cycle output for terminal
  domAlerts.js           — 3 alert types
  metrics.js             — session counters

config/
  env.js                 — centralized .env loading
  userAgents.js          — UA pool + viewport pool
```

## Ключові рішення

| Аспект | Рішення |
|---|---|
| Source URL | `https://www.flashscore.mobi/?s=2` (lite-HTML, server-rendered) |
| Кандидат | `span.live ∈ {halftime, 45+'}` AND `a.live = 0:0` |
| DOM strategy | `cheerio.load + #score-data.contents()` walk зі state (lastH4 + pendingStatus + pendingTeamText) |
| Fetch transport | HTTP-first (cheerio) → Playwright fallback на 403/empty/error |
| Anti-bot | UA rotation, randomDelay, stealth init script, isolated context, route blocking |
| Working hours | `LIVE_WORKING_HOURS_START..END` (default 16-23) або `LIVE_IGNORE_HOURS=1` для 24/7 |
| Sleep policy | adaptive: `clamp((44 − minute) × 60s, MIN=60s, MAX=8min)`; fallback 5min якщо немає 0:0 у 1H |
| Storage | JSON per day, dedup за matchId |
| Reuse from v3 | `helpers/date.js`, `helpers/utils/normalizeMatchText.js` (sanitizeLeagueName, sanitizeTeams) |

## Candidate Schema

```json
{
  "matchId":       "GS3Jfzrf",
  "country":       "RUSSIA",
  "league":        "Youth League",
  "homeTeam":      "Nizhny Novgorod U19",
  "awayTeam":      "Rodina Moscow U19",
  "currentStatus": "Half Time",
  "matchUrl":      "/match/GS3Jfzrf/?s=2",
  "discoveredAt":  "2026-05-07T13:51:32.878Z",
  "cycleId":       1
}
```

## DOM peculiarities (важливі для майбутніх stage-ів)

1. **Flat #score-data:** немає вкладених контейнерів; матчі розділені `<br>`, ліга в `<h4>` тільки на зміну.
2. **`<h4>` має суфікс `<a>Standings</a>`** — strip через `sanitizeLeagueName`.
3. **`<img class="rcard-1">`** (red card) між іменами і score link — pendingTeamText акумулюється тільки з text nodes, ігноруючи теги.
4. **Команди з цифрами** ("Mekelle 70 Enderta") — `sanitizeTeams` коректно розділяє по " - ".
5. **`?s=2`** — параметр що відкриває live feed; обов'язковий.

## Output prikład

```
──────────────────────────────────────────────────────── 17:07:42
Run #1  |  https://www.flashscore.mobi/?s=2  [http, 2540ms]
Board: rows=19  0:0=15  candidates=2

Candidates (2):
  +  Juventus-SP - Ferroviaria  [BRAZIL: Paulista A2]  Half Time
  +  Nizhny Novgorod U19 - Rodina Moscow U19  [RUSSIA: Youth League]  Half Time
Saved: +0 new, 2 skipped

Watching (12 × 0:0 in 1H):
  ~  Iliria Fushe-Kruje - Besa Kavaje  @ 8'
  ...

Next scan: 17:13  (6 min)  |  nearest: Baladiyat El Mahalla @ 38'
────────────────────────────────────────────────────────
```

## Команди

```bash
npm run parse          # одиночний цикл
npm run watch          # live 16-23
npm run watch:anytime  # live 24/7
```

## Залежності

- `axios ^1.6.2` — HTTP fetcher
- `cheerio ^1.0.0` — HTML parser
- `playwright ^1.44.0` — browser fallback
- `dayjs ^1.11.13` — час/дата
- `dotenv ^16.3.1` — env loading

## Що далі (Stage 2)

Кожен кандидат із `candidates.json` — це лише metadata. Stage 2 збагачує його:
- **odds** з summary-сторінки (флаг фаворита)
- **statistics** за 1H (basic / detailed)
- **standings** (позиції команд + favoriteStrength)
- **h2h** (recent form + face-to-face)

Деталі — див. `stage-2-enrichment.md`.
