---
name: analyze-predictions
description: Use when the user asks to summarize, evaluate, score or analyze a day's football predictions / signals for the 1H ТМ/ТБ lines (tm05_1h / tb05_1h) — e.g. "підсумок прогнозів за вчора", "оціни прогнози", "аналіз ТМ/ТБ", hit-rate / ROI / calibration of a slate. Reads data/logs/<date>/.
---

# Analyze Predictions (1H ТМ/ТБ)

## Overview

Evaluates a day's dispatched signals for the two first-half lines and reports hit-rate, ROI vs break-even, p-calibration, first-goal timing, selectivity and pattern flags. Engine-agnostic: it scores the **persisted output** (`predictions.tm05_1h` / `predictions.tb05_1h` + `htOutcome`), so DS-based and AI (oneH) predictions are evaluated identically.

**Core principle:** HR alone is misleading — a line at odds 2.6 is profitable from 38.5% HR. Always judge a line by **ROI vs its break-even**, not by hit-rate.

## When to Use

- "Підсумок / оцінка / аналіз прогнозів за <день>"; "як відпрацювали ТМ/ТБ"; "порахуй HR / ROI / калібрування".
- After a slate ends, to score what was bet.
- NOT for live decisioning or backtesting the model logic — this only scores already-dispatched signals.

## Quick Reference

```bash
node .claude/skills/analyze-predictions/analyze.js            # today
node .claude/skills/analyze-predictions/analyze.js 2026-06-16 # a specific day
node .claude/skills/analyze-predictions/analyze.js 2026-06-16 --json
```

Default "yesterday": pass today's date minus one (the user usually means the last completed slate). Confirm the date in your summary.

The report has six blocks: **per-bet table · per-line summary · p-calibration · selectivity · first-goal minutes · flags**.

## How to Interpret

| Block | Read it as |
|---|---|
| Per-line summary | Compare `HR` to `беззбитк` (= 1/avg-odds). HR ≥ break-even → line was +EV in practice. `net u` / `ROI` are the verdict. |
| Калібрування | Higher `p` should give higher `HR`. Inversion (high p underperforms) = mis-calibrated `p`, flagged automatically. Small n → treat as weak signal. |
| Селективність | `кандидатів → ставок`, plus why the rest dropped (EV-gate / goal-before-decision / other). Confirms the filter isn't passing junk. |
| Хвилини голів | ТМ misses from goals at 43–46' are essentially un-forecastable at the 25–30' decision; the mirror — ТБ wins on those same late goals. |
| Прапорці | Auto-surfaced anomalies (sub-0.5 p bets, late-goal misses, rich-data losses, calibration inversion, sub-break-even lines). |

After running, **interpret** — don't just paste the table. Lead with HR/ROI per line and the overall verdict, then the 2–3 most important flags. Convert "yesterday" to the actual date.

## Data Sources (per `data/logs/<date>/`)

- `tg-outbox.json` — what was **bet**; `entry.decisionKey` (`tm05_1h`/`tb05_1h`), `snapshot.odds`, `result.hit` (source of truth for HIT/MISS).
- `matches.json` — keyed by `matchId`; `predictions.<key>` holds `direction`, `p`, `confidence`, `dataAvailability`, `evGate{pass,ev,pAdj}`, `htOutcome{score,dry,firstGoalMinute}`; `tracking.discardReason` drives selectivity.

Resolution: `under` wins iff `htOutcome.dry` (HT 0:0); `over` wins iff `!dry`. Script prefers `result.hit`, falls back to deriving from `htOutcome`.

## Common Mistakes

- **Judging by HR, not ROI vs break-even.** A 43% HR line at 2.6 is profitable; a 50% line at 1.9 is not.
- **Trusting calibration on tiny n.** One day is ~3–10 bets; flag trends, don't conclude. Aggregate across days for real calibration.
- **Treating `goal_before_halftime` as a loss for ТБ.** For the over line that same event is the WIN — the resolver handles it, but don't mis-read raw `discardReason`.
- **Forgetting `final`/`derived` are often null** — matches stop tracking at HT resolution; use `htOutcome`, not `final`.
- **Counting a `partial`-data caveat as a model bug** — most decisions fire at 25–30' on partial stats by design.

## Extending

To score multiple days, loop the script over dates and sum `net`/`stake` from `--json` output. Add new flags in the `flags` block of `analyze.js` (keep them aggregate-when-many to avoid walls of text).
