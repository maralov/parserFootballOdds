#!/usr/bin/env node
'use strict';

/**
 * MISS analysis script: reads matches.json files from one or more days,
 * finds predictions where predictionAudit.hit === false (MISS), and groups
 * them by pattern to show where predictions fail.
 *
 * Usage:
 *   node scripts/analyze-misses.js [--since=YYYY-MM-DD] [--date=YYYY-MM-DD] [--out=path.json]
 *
 *   --since=YYYY-MM-DD  analyze all days from that date to today
 *   --date=YYYY-MM-DD   analyze one specific date
 *   (neither)           analyze today
 *   --out=path.json     write JSON report to file, otherwise print to stdout
 */

const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.resolve(__dirname, '../data/logs');

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

function dateRange(since, date) {
  const today = new Date().toISOString().slice(0, 10);
  if (date) return [date];
  if (since) {
    const dates = [];
    let cur = new Date(since);
    const end = new Date(today);
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }
  return [today];
}

function confidenceBand(c) {
  const v = Number(c);
  if (!Number.isFinite(v)) return 'unknown';
  if (v < 0.55) return '<0.55';
  if (v < 0.70) return '0.55-0.70';
  if (v < 0.82) return '0.70-0.82';
  return '0.82+';
}

function goalMinuteBucket(minute) {
  const m = Number(minute);
  if (!Number.isFinite(m)) return 'unknown';
  if (m <= 65) return '60-65';
  if (m <= 70) return '65-70';
  if (m <= 75) return '70-75';
  if (m <= 80) return '75-80';
  if (m <= 85) return '80-85';
  if (m <= 90) return '85-90';
  return '90+';
}

function getFirstGoalMinute(match) {
  // Try final.goals first (most precise)
  const goals = match.final?.goals;
  if (Array.isArray(goals) && goals.length > 0 && goals[0].minute != null) {
    return goals[0].minute;
  }
  // Fall back to final.firstGoalMinute
  if (match.final?.firstGoalMinute != null) {
    return match.final.firstGoalMinute;
  }
  // Fall back to tracking.firstGoalMinute
  if (match.tracking?.firstGoalMinute != null) {
    return match.tracking.firstGoalMinute;
  }
  return null;
}

function printUsage() {
  console.log(`
Usage: node scripts/analyze-misses.js [options]

Options:
  --since=YYYY-MM-DD   Analyze all days from this date to today
  --date=YYYY-MM-DD    Analyze one specific date
  --out=path.json      Write JSON report to file (default: stdout)
  --help               Show this help message

If neither --since nor --date is given, analyzes today.

Examples:
  node scripts/analyze-misses.js --date=2026-05-09
  node scripts/analyze-misses.js --since=2026-05-01 --out=report.json
`);
}

function run() {
  const { flags } = parseArgs(process.argv);

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  const dates = dateRange(flags.since, flags.date);
  const fromDate = dates[0];
  const toDate = dates[dates.length - 1];

  const report = {
    generatedAt: new Date().toISOString(),
    dateRange: { from: fromDate, to: toDate },
    summary: {
      totalPredictions: 0,
      totalMisses: 0,
      missRate: 0,
      totalHits: 0,
      hitRate: 0,
    },
    missesByType: {},
    missesByRiskFlag: {},
    missesByConfidenceBand: {},
    goalMinuteDistribution: {
      '60-65': 0,
      '65-70': 0,
      '70-75': 0,
      '75-80': 0,
      '80-85': 0,
      '85-90': 0,
      '90+': 0,
    },
  };

  // Track totals per risk flag and confidence band (hits + misses)
  const riskFlagTotals = {}; // flag -> { misses, total }
  const confidenceBandTotals = {}; // band -> { misses, total }

  for (const date of dates) {
    const filePath = path.join(DATA_ROOT, date, 'matches.json');
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`Skipping ${date}: no matches.json found\n`);
      continue;
    }

    let store;
    try {
      store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      process.stderr.write(`Skipping ${date}: failed to parse matches.json — ${err.message}\n`);
      continue;
    }

    for (const m of Object.values(store)) {
      const checkpoints = [
        { key: 'decision60', p: m.predictions?.decision60 },
        { key: 'decision80', p: m.predictions?.decision80 },
      ];

      for (const { key, p } of checkpoints) {
        if (!p?.predictionAudit) continue;
        const isHit = p.predictionAudit.hit;
        if (isHit !== true && isHit !== false) continue; // pending

        report.summary.totalPredictions += 1;
        if (isHit === true) report.summary.totalHits += 1;
        if (isHit === false) report.summary.totalMisses += 1;

        const type = `${key}:${p.predictionType}`;
        const cb = confidenceBand(p.confidence);

        // Confidence band totals
        if (!confidenceBandTotals[cb]) confidenceBandTotals[cb] = { misses: 0, total: 0 };
        confidenceBandTotals[cb].total += 1;
        if (isHit === false) confidenceBandTotals[cb].misses += 1;

        // Risk flag totals
        for (const flag of p.riskFlags || []) {
          if (!riskFlagTotals[flag]) riskFlagTotals[flag] = { misses: 0, total: 0 };
          riskFlagTotals[flag].total += 1;
          if (isHit === false) riskFlagTotals[flag].misses += 1;
        }

        if (isHit === false) {
          // missesByType
          if (!report.missesByType[type]) report.missesByType[type] = { n: 0, goalMinutes: [] };
          report.missesByType[type].n += 1;

          // Goal minute
          const goalMinute = getFirstGoalMinute(m);
          if (goalMinute != null) {
            report.missesByType[type].goalMinutes.push(goalMinute);
            const bucket = goalMinuteBucket(goalMinute);
            if (bucket !== 'unknown' && report.goalMinuteDistribution[bucket] !== undefined) {
              report.goalMinuteDistribution[bucket] += 1;
            }
          }
        }
      }
    }
  }

  // Finalize rates
  const { totalPredictions, totalMisses, totalHits } = report.summary;
  report.summary.missRate = totalPredictions > 0 ? totalMisses / totalPredictions : 0;
  report.summary.hitRate = totalPredictions > 0 ? totalHits / totalPredictions : 0;

  // missesByRiskFlag
  for (const [flag, counts] of Object.entries(riskFlagTotals)) {
    report.missesByRiskFlag[flag] = {
      misses: counts.misses,
      total: counts.total,
      missRate: counts.total > 0 ? counts.misses / counts.total : 0,
    };
  }

  // missesByConfidenceBand
  for (const [band, counts] of Object.entries(confidenceBandTotals)) {
    report.missesByConfidenceBand[band] = {
      misses: counts.misses,
      total: counts.total,
      missRate: counts.total > 0 ? counts.misses / counts.total : 0,
    };
  }

  const json = JSON.stringify(report, null, 2);
  if (flags.out) {
    fs.writeFileSync(flags.out, json, 'utf8');
    console.log(`Wrote report to ${flags.out}`);
  } else {
    console.log(json);
  }
}

run();
