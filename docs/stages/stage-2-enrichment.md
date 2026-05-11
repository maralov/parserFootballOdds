# Stage 2 — Candidate Enrichment

**Status:** 📋 Spec / Awaiting Implementation
**Depends on:** Stage 1 (`candidates.json`)

Кожен кандидат з `candidates.json` отримує додатковий контекст з flashscore.mobi: odds, statistics за 1H, standings (з favoriteStrength), h2h. Вихід — `data/logs/YYYY-MM-DD/enrichment.json` для майбутньої predictive-моделі.

---

## Архітектурні рішення

| Аспект | Рішення |
|---|---|
| **Trigger** | inline в `runOnce` після `appendCandidates`, тільки для нових кандидатів (added > 0) |
| **Concurrency** | `p-limit(3)` — 3 кандидати паралельно; per-кандидат запити послідовні з randomDelay 500-1500ms |
| **Fetch transport** | `axios + cheerio` (всі сторінки на flashscore.mobi server-rendered, без JS) |
| **Storage** | `data/logs/YYYY-MM-DD/enrichment.json` — single aggregated file, key = matchId |
| **Status** | `enriched` / `skip:no_stats` / `failed` / `pending` |
| **Stats context** | На перерві = 1H снапшот → `statistics.1half.{home, away, overall}` |
| **Re-run** | команда `npm run enrich:retry` — обробляє `failed` + `pending` за сьогодні |

## Pipeline

```
candidate (halftime 0:0)
  │
  ├─► GET /match/{id}/?s=2          ← summary
  │     ├─ #detail-tabs: [Stats?, Standings?, H2H?]
  │     ├─ .p-set.odds-detail → odds
  │     └─ if no Stats tab → status: "skip:no_stats" → STOP
  │
  ├─► GET /match/{id}/?t=stats      ← statistics
  │     └─ #detail-tab-content → rows
  │        ├─ statsLevel: detailed | basic
  │        └─ map labels → camelCase fields
  │
  ├─► GET /match/{id}/?t=standings  (if tab exists)
  │     └─ table → home/away positions + favoriteStrength
  │
  └─► GET /match/{id}/?t=h2h        (if tab exists)
        └─ recent form + face-to-face
```

## Module layout

```
src/enrichment/
  enrichOne.js                — orchestrator per candidate (4 GETs sequenced)
  enrichBatch.js              — p-limit driver
  parsers/
    matchSummaryParser.js     — tabs detection + odds
    matchStatsParser.js       — rows → camelCase stats
    standingsParser.js        — table → positions
    h2hParser.js              — form + face-to-face
  helpers/
    oddsExtractor.js          — parseOddsBlock + computeFavorite
    statsLevelDetector.js     — detailed | basic
    statsLabelMap.js          — label → key mapping
    statsValueParser.js       — "70% (185/264)", "0.39", "5"
    statsOverall.js           — computeOverall(home, away)
    favoriteStrength.js       — composite score
    urlBuilder.js             — buildSummary/Stats/Standings/H2hUrl
    flashscoreUrlNormalizer.js — flashscore.com → flashscore.mobi
src/store/
  enrichmentStore.js          — read/write/dedup/retry queue
scripts/
  enrich-retry.js             — standalone retry command
```

## Statistics Schema

```javascript
/**
 * @typedef {Object} StatsTeam
 *
 * --- Top stats / basic ---
 * @property {number|null} ballPossession       // %
 * @property {number|null} totalShots
 * @property {number|null} shotsOnTarget
 * @property {number|null} cornerKicks
 * @property {number|null} yellowCards
 * @property {number|null} redCards
 *
 * --- Detailed ---
 * @property {number|null} expectedGoalsXg
 * @property {number|null} xgOnTargetXgot
 * @property {number|null} bigChances
 * @property {number|null} shotsOffTarget
 * @property {number|null} blockedShots
 * @property {number|null} shotsInsideTheBox
 * @property {number|null} shotsOutsideTheBox
 * @property {number|null} hitTheWoodwork
 * @property {number|null} headedGoals
 * @property {number|null} touchesInOppositionBox
 * @property {number|null} accurateThroughPasses
 * @property {number|null} offsides
 * @property {number|null} freeKicks
 *
 * --- Passes (% (made/attempted)) ---
 * @property {number|null} passesPct
 * @property {number|null} passesMade
 * @property {number|null} passesAttempted
 * @property {number|null} longPassesPct
 * @property {number|null} longPassesMade
 * @property {number|null} longPassesAttempted
 * @property {number|null} passesInFinalThirdPct
 * @property {number|null} passesInFinalThirdMade
 * @property {number|null} passesInFinalThirdAttempted
 * @property {number|null} crossesPct
 * @property {number|null} crossesMade
 * @property {number|null} crossesAttempted
 * @property {number|null} expectedAssistsXa
 * @property {number|null} throwIns
 *
 * --- Defense ---
 * @property {number|null} fouls
 * @property {number|null} tacklesPct
 * @property {number|null} tacklesMade
 * @property {number|null} tacklesAttempted
 * @property {number|null} duelsWon
 * @property {number|null} clearances
 * @property {number|null} interceptions
 * @property {number|null} errorsLeadingToShot
 * @property {number|null} errorsLeadingToGoal
 *
 * --- Goalkeeping ---
 * @property {number|null} goalkeeperSaves
 * @property {number|null} xgotFaced
 * @property {number|null} goalsPrevented
 */

/**
 * @typedef {Object} Statistics
 * @property {'detailed'|'basic'} statsLevel
 * @property {string} capturedAtStatus
 * @property {{ home: StatsTeam, away: StatsTeam, overall: StatsTeam }} '1half'
 * @property {Array<{ label, home, away }>} rawRows  // діагностика
 */
```

### `overall` — обчислене поле

```javascript
// computeOverall(home, away):
//   - count fields → home + away
//   - numeric (xG, xA) → home + away (round to 2 decimals)
//   - percentage fields (possession, passesPct, ...) → null
//   - made/attempted fields → made: sum, attempted: sum
```

## Enrichment Item Schema

```json
{
  "matchId": "OfvqEnzG",
  "status": "enriched",
  "enrichedAt": "2026-05-07T18:45:12.123Z",
  "tabs": { "stats": true, "standings": true, "h2h": true },
  "odds": {
    "home": 4.53,
    "draw": 4.30,
    "away": 1.63,
    "isOddsFavorite": {
      "favorite": "away",
      "margin": 0.17,
      "threshold": 1.8
    }
  },
  "statsLevel": "detailed",
  "statistics": {
    "capturedAtStatus": "Half Time",
    "1half": {
      "home":    { "totalShots": 5,  "expectedGoalsXg": 0.39, "ballPossession": 31, "..." },
      "away":    { "totalShots": 17, "expectedGoalsXg": 1.39, "ballPossession": 69, "..." },
      "overall": { "totalShots": 22, "expectedGoalsXg": 1.78, "ballPossession": null, "..." }
    }
  },
  "standings": {
    "totalTeams": 16,
    "home": { "position": 12, "mp": 10, "w": 2, "d": 1, "l": 7, "gd": -9,  "pts": 7 },
    "away": { "position": 1,  "mp": 10, "w": 9, "d": 1, "l": 0, "gd": 18,  "pts": 28 },
    "favoriteStrength": {
      "label": "strong",
      "score": 0.82,
      "favorite": "away",
      "components": {
        "positionScore": 0.69,
        "pointsScore":   0.75,
        "goalDiffScore": 0.90,
        "winRateScore":  0.70
      }
    }
  },
  "h2h": {
    "recentForm": {
      "home": [{ "result": "L", "score": "0:2", "vs": "Team X", "matchUrl": "https://www.flashscore.mobi/match/.../" }],
      "away": [{ "result": "W", "score": "3:0", "vs": "Team Y", "matchUrl": "..." }]
    },
    "faceToFace": [
      { "date": "2025-09-12", "score": "1:1", "matchUrl": "https://www.flashscore.mobi/match/.../" }
    ]
  }
}
```

### Skip приклад

```json
{
  "matchId": "GS3Jfzrf",
  "status": "skip:no_stats",
  "skippedAt": "...",
  "reason": "no stats tab in #detail-tabs"
}
```

## Helpers (малі focused функції)

| Helper | Опис |
|---|---|
| `extractTabs($)` | `{ stats, standings, h2h }: bool` з `#detail-tabs` |
| `parseOddsBlock($)` | `{ home, draw, away }` з `.p-set.odds-detail`, або `null` |
| `computeFavorite(odds, threshold=1.8)` | `{ favorite: 'home'\|'away'\|null, margin, threshold }` |
| `parseStatsRows($)` | `Array<{ label, home, away }>` сирих рядків |
| `mapStatsLabel(label)` | "Expected goals (xG)" → `expectedGoalsXg` |
| `parseStatsValue(str)` | "70% (185/264)" / "0.39" / "5" / "—" → typed value |
| `detectStatsLevel(rows)` | `'detailed'` якщо є xG/big chances/touches markers |
| `computeOverall(home, away)` | per-field sum/null logic |
| `parseStandingsTable($)` | `Array<{ pos, team, mp, w, d, l, gf, ga, gd, pts }>` |
| `findTeamPosition(rows, teamName)` | match по нормалізованому імені (з sanitizeTeamName) |
| `computeFavoriteStrength(home, away, totalTeams)` | composite score |
| `parseH2hSection($, sectionTitle)` | recent form / face-to-face з h2h-сторінки |
| `flashscoreToMobi(url)` | `flashscore.com/match/X` → `https://www.flashscore.mobi/match/X/` |

## favoriteStrength formula

```javascript
positionDiff   = abs(homePos - awayPos)            // напр. 12 - 1 = 11
positionScore  = clamp(positionDiff / totalTeams, 0, 1)   // 11/16 = 0.69

pointsDiff     = abs(homePts - awayPts)
maxPossibleGap = 3 * mp                            // 3 очки за матч × matches played
pointsScore    = clamp(pointsDiff / maxPossibleGap, 0, 1)

gdDiff         = abs(homeGd - awayGd)              // напр. |−9 − 18| = 27
goalDiffScore  = clamp(gdDiff / (totalTeams × 2), 0, 1)  // нормалізація до розміру ліги

winRateHome    = home.w / home.mp
winRateAway    = away.w / away.mp
winRateScore   = abs(winRateHome - winRateAway)    // 0..1

score          = avg(positionScore, pointsScore, goalDiffScore, winRateScore)

label =
  score >= 0.6  → 'strong'
  score >= 0.3  → 'slight'
  score <  0.3  → 'balanced'

favorite =
  if homeScore > awayScore by >= 0.05  → 'home'
  if awayScore > homeScore by >= 0.05  → 'away'
  else                                 → null
```

(homeScore / awayScore вище — це per-team середнє, де команда з кращою позицією/очками має більше)

## runOnce інтеграція

```javascript
// в runOnce.js, після:
//   const saveResult = appendCandidates(candidates);

if (saveResult.added > 0) {
  const newCandidates = candidates.filter(c =>
    saveResult.addedIds.includes(c.matchId)
  );
  result.enrichment = await enrichBatch(newCandidates, cycleId);
}
```

display.js додає секцію:

```
Enrichment (3 new):
  +  GS3Jfzrf  status=skip:no_stats
  +  GItJZjCM  status=enriched  level=basic     fav=away (1.63)
  +  OfvqEnzG  status=enriched  level=detailed  fav=away  strength=strong (0.82)
```

## ENV (Stage 2)

```
LIVE_ENRICHMENT_ENABLED=1
LIVE_ENRICHMENT_CONCURRENCY=3
LIVE_ENRICHMENT_TIMEOUT_MS=15000
LIVE_ENRICHMENT_DELAY_MIN_MS=500
LIVE_ENRICHMENT_DELAY_MAX_MS=1500
LIVE_ODDS_FAVORITE_THRESHOLD=1.8
```

## Команди (Stage 2)

```bash
npm run enrich:retry   # обробити failed + pending за сьогоднішній день
```

(основна enrichment запускається автоматично разом із `parse` / `watch`)

## Що далі (Stage 3 — план)

- **Post-match overall stats** — повторне відвідування матчу після фіналу для збору повної статистики (90 хв) як supplement до 1H.
- **Outcome label** — фінальний рахунок, чи був гол у 2H (over_0_5 = bool) — це target variable для ML.
- **Dataset export** — convert `candidates + enrichment + outcome` у NDJSON / Parquet для тренування.
