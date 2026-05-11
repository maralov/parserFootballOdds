#!/usr/bin/env node
'use strict';

/**
 * Розширений offline replay: групує predictions + hits з matches.json по
 * predictionType, mode, scoreBand, confidenceBand, league, statsLevel + аналізує
 * вплив riskFlag (з/без).
 *
 *   node scripts/predictionReplay.js [path/to/matches.json] [--out=path/to/report.json]
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else flags[a.slice(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function scoreBand(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'unknown';
  if (s < 70) return '<70';
  if (s < 75) return '70-75';
  if (s < 80) return '75-80';
  if (s < 85) return '80-85';
  return '85+';
}

function confidenceBand(c) {
  const v = Number(c);
  if (!Number.isFinite(v)) return 'unknown';
  if (v < 0.55) return '0.35-0.55';
  if (v < 0.70) return '0.55-0.70';
  if (v < 0.82) return '0.70-0.82';
  return '0.82+';
}

function emptyBucket() {
  return { n: 0, hits: 0, hitRate: 0 };
}

function bump(map, key, isHit) {
  if (!map[key]) map[key] = emptyBucket();
  map[key].n += 1;
  if (isHit === true) map[key].hits += 1;
}

function finalize(map) {
  for (const k of Object.keys(map)) {
    const b = map[k];
    b.hitRate = b.n > 0 ? b.hits / b.n : 0;
  }
  return map;
}

function bumpInside(b, isHit) {
  b.n += 1;
  if (isHit === true) b.hits += 1;
}

function processPrediction(report, p, match, checkpoint) {
  if (!p?.predictionAudit) return;
  const isHit = p.predictionAudit.hit;
  if (isHit !== true && isHit !== false) return; // Skip pending

  const type = `${checkpoint}:${p.predictionType}`;
  const mode = p.mode || p.modelMode || 'unknown';
  const sb = scoreBand(p.finalScore);
  const cb = confidenceBand(p.confidence);
  const league = match.league || match.tournament || 'unknown';
  const sl = match.statsLevel || 'unknown';

  report.totals.n += 1;
  if (isHit === true) report.totals.hits += 1;

  bump(report.byPredictionType, type, isHit);
  bump(report.byMode, mode, isHit);
  bump(report.byScoreBand, sb, isHit);
  bump(report.byConfidenceBand, cb, isHit);
  bump(report.byLeague, league, isHit);
  bump(report.byStatsLevel, sl, isHit);

  for (const flag of p.riskFlags || []) {
    if (!report.riskFlagImpact[flag]) {
      report.riskFlagImpact[flag] = {
        with: emptyBucket(),
        without: emptyBucket(),
      };
    }
    bumpInside(report.riskFlagImpact[flag].with, isHit);
  }
}

function fillRiskFlagImpactWithout(report, allRows) {
  // Для кожного флагу — розрахувати "без флагу" статистику:
  // прогноз НЕ містить цей флаг → bump в "without"
  for (const flag of Object.keys(report.riskFlagImpact)) {
    for (const { p, isHit } of allRows) {
      const flags = p.riskFlags || [];
      if (!flags.includes(flag)) {
        bumpInside(report.riskFlagImpact[flag].without, isHit);
      }
    }
    const b = report.riskFlagImpact[flag];
    b.with.hitRate = b.with.n > 0 ? b.with.hits / b.with.n : 0;
    b.without.hitRate = b.without.n > 0 ? b.without.hits / b.without.n : 0;
  }
}

/**
 * Load a threshold config from a JSON file (--config=path.json).
 * Returns the parsed config object or null if not specified.
 */
function loadConfig(flags) {
  if (!flags.config) return null;
  if (!fs.existsSync(flags.config)) {
    console.error('Config file not found:', flags.config);
    process.exit(1);
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(flags.config, 'utf8'));
  } catch (err) {
    console.error('Failed to parse config file:', err.message);
    process.exit(1);
  }
  // Print a summary of overrides to stderr
  for (const [section, overrides] of Object.entries(config)) {
    for (const [key, value] of Object.entries(overrides)) {
      process.stderr.write(`Config loaded: ${section}.${key}=${value}\n`);
    }
  }
  return config;
}

/**
 * Filter allRows by config thresholds.
 * If config specifies decision80.tbActionableLateTh, only include decision80 predictions
 * where p.finalScore >= that threshold. Same logic applies to any <checkpoint>.<thresholdKey>
 * mapping where the threshold key ends in "Th".
 *
 * Each row is { p, isHit } where p is the prediction object.
 * Checkpoint is inferred from p.checkpoint or the decision key.
 */
function applyConfigFilter(allRows, config) {
  if (!config) return allRows;

  return allRows.filter(({ p }) => {
    const checkpoint = p.checkpoint || 'unknown';

    for (const [section, overrides] of Object.entries(config)) {
      // section must match the checkpoint (e.g. "decision80" matches checkpoint "decision80")
      if (section !== checkpoint) continue;

      for (const [key, threshold] of Object.entries(overrides)) {
        // Map known threshold keys to the prediction field to compare
        let fieldValue;
        if (key === 'tbActionableLateTh' || key === 'tbActionableRealTh') {
          fieldValue = p.finalScore;
        } else if (key === 'tbLeanLateTh' || key === 'tbLeanRealTh') {
          fieldValue = p.finalScore;
        } else {
          // Generic: any key ending in "Th" — compare against finalScore
          if (key.endsWith('Th')) {
            fieldValue = p.finalScore;
          }
        }

        if (fieldValue !== undefined && Number.isFinite(Number(fieldValue))) {
          if (Number(fieldValue) < Number(threshold)) {
            return false; // Does not meet threshold
          }
        }
      }
    }

    return true;
  });
}

function run() {
  const { positional, flags } = parseArgs(process.argv);
  const fileArg = positional[0]
    || path.join(__dirname, '../data/logs', new Date().toISOString().slice(0, 10), 'matches.json');

  if (!fs.existsSync(fileArg)) {
    console.error('File not found:', fileArg);
    process.exit(1);
  }

  const config = loadConfig(flags);

  const store = JSON.parse(fs.readFileSync(fileArg, 'utf8'));

  const report = {
    generatedAt: new Date().toISOString(),
    file: fileArg,
    totals: { n: 0, hits: 0, hitRate: 0 },
    byPredictionType: {},
    byMode: {},
    byScoreBand: {},
    byConfidenceBand: {},
    byLeague: {},
    byStatsLevel: {},
    riskFlagImpact: {},
  };

  let allRows = [];
  for (const m of Object.values(store)) {
    const p60 = m.predictions?.decision60;
    const p80 = m.predictions?.decision80;

    if (p60?.predictionAudit) {
      const isHit = p60.predictionAudit.hit;
      if (isHit === true || isHit === false) allRows.push({ p: p60, isHit });
    }
    if (p80?.predictionAudit) {
      const isHit = p80.predictionAudit.hit;
      if (isHit === true || isHit === false) allRows.push({ p: p80, isHit });
    }
  }

  // Apply config threshold filter before processing
  allRows = applyConfigFilter(allRows, config);

  // Build a lookup of filtered match predictions for processPrediction
  const filteredPredictionKeys = new Set(
    allRows.map(({ p }) => `${p.matchId}:${p.checkpoint}`)
  );

  for (const m of Object.values(store)) {
    const p60 = m.predictions?.decision60;
    const p80 = m.predictions?.decision80;

    if (p60?.predictionAudit) {
      const key = `${p60.predictionAudit?.matchId || m.matchId}:${p60.checkpoint || 'decision60'}`;
      if (!config || filteredPredictionKeys.has(key)) {
        processPrediction(report, p60, m, '60');
      }
    }
    if (p80?.predictionAudit) {
      const key = `${p80.predictionAudit?.matchId || m.matchId}:${p80.checkpoint || 'decision80'}`;
      if (!config || filteredPredictionKeys.has(key)) {
        processPrediction(report, p80, m, '80');
      }
    }
  }

  finalize(report.byPredictionType);
  finalize(report.byMode);
  finalize(report.byScoreBand);
  finalize(report.byConfidenceBand);
  finalize(report.byLeague);
  finalize(report.byStatsLevel);
  fillRiskFlagImpactWithout(report, allRows);

  report.totals.hitRate = report.totals.n > 0 ? report.totals.hits / report.totals.n : 0;

  const json = JSON.stringify(report, null, 2);
  if (flags.out) {
    fs.writeFileSync(flags.out, json, 'utf8');
    console.log(`Wrote report to ${flags.out}`);
  } else {
    console.log(json);
  }
}

run();
