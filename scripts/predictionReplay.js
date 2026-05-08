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

function run() {
  const { positional, flags } = parseArgs(process.argv);
  const fileArg = positional[0]
    || path.join(__dirname, '../data/logs', new Date().toISOString().slice(0, 10), 'matches.json');

  if (!fs.existsSync(fileArg)) {
    console.error('File not found:', fileArg);
    process.exit(1);
  }

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

  const allRows = [];
  for (const m of Object.values(store)) {
    const p60 = m.predictions?.decision60;
    const p80 = m.predictions?.decision80;

    if (p60?.predictionAudit) {
      processPrediction(report, p60, m, '60');
      const isHit = p60.predictionAudit.hit;
      if (isHit === true || isHit === false) allRows.push({ p: p60, isHit });
    }
    if (p80?.predictionAudit) {
      processPrediction(report, p80, m, '80');
      const isHit = p80.predictionAudit.hit;
      if (isHit === true || isHit === false) allRows.push({ p: p80, isHit });
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
