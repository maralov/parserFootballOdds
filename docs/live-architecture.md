# Live Pipeline Architecture

## Modules

- `LiveSource` - collects live matches from `m.flashscore.ua`.
- `StatsSource` - collects match statistics for second half.
- `FeatureBuilder` - converts raw stats to normalized model features.
- `ModelScoring` - returns `zone`, `pGoal`, `confidence`.
- `BetDecision` - returns `bet`, `edge`, `reason`.
- `Notifier` - sends Telegram signals.
- `Storage` - stores run artifacts (`raw`, `processed`, `decisions`).

## DTO contracts

### LiveMatchCandidate

```js
{
  id: string,
  league: string,
  home: string,
  away: string,
  minute: number,
  score: { home: string, away: string },
  matchDetailsUrl: string,
  provider: "flashscore-mobile-ua"
}
```

### FeaturePayload

```js
{
  matchId: string,
  league: string,
  minute: number,
  minuteBucket: "70-75" | "76-80" | "81-85" | "86+",
  expectedGoalsXg: number | null,
  shotsOnTarget: number | null,
  touchesInOppositionBox: number | null,
  availableMetrics: number,
  dataQualityScore: number,
  allowDecision: boolean
}
```

### ModelScore

```js
{
  zone: 0 | 1 | 2 | 3 | 4,
  pGoal: number,
  confidence: "low" | "medium" | "strong" | "max",
  minuteBucket: string,
  dataQualityScore: number
}
```

### BetDecision

```js
{
  bet: "OVER_0_5" | "UNDER_0_5" | "SKIP",
  edge: number | null,
  reason: string
}
```

## Run artifacts

- `data/live_predictions.json` - latest processed batch.
- `data/runs/<timestamp>-<runId>/raw_matches.json`
- `data/runs/<timestamp>-<runId>/processed_matches.json`
- `data/runs/<timestamp>-<runId>/decisions.json`
