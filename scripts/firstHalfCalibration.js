#!/usr/bin/env node
'use strict';

// 1HUNDER calibration harness.
//
// Reads data/logs/<date>/matches.json, collects every match that produced a
// tm05_1h decision (any phase with a dsScore), determines the realized first-half
// outcome (dry = no goal at/before 45'), and reports realized P(dry) + ROI per
// DS bucket. Use the output to refit dsToProbability1H and LIVE_1H_DS_THRESHOLD_MIN.
//
// Usage:
//   node scripts/firstHalfCalibration.js [YYYY-MM-DD] [YYYY-MM-DD ...]
//   node scripts/firstHalfCalibration.js            # all dated logs

const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.resolve(__dirname, '../data/logs');
const { tm05_1hOddsAt } = require('../src/scoring/oddsTable');

function listDates(args) {
  if (args.length) return args;
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs.readdirSync(DATA_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

function loadMatches(dateKey) {
  const file = path.join(DATA_ROOT, dateKey, 'matches.json');
  if (!fs.existsSync(file)) return [];
  try {
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.values(store);
  } catch {
    return [];
  }
}

// Dry first half = no goal scored at/before minute 45.
function firstHalfDry(match) {
  const fgm = match?.final?.firstGoalMinute;
  if (fgm == null) return true;
  if (typeof fgm === 'number') return fgm > 45;
  return null; // unknown
}

function bucketOf(ds) {
  if (ds == null) return 'n/a';
  const lo = Math.floor(ds / 10) * 10;
  return `${lo}-${lo + 9}`;
}

function main() {
  const dates = listDates(process.argv.slice(2));
  const rows = [];

  for (const dateKey of dates) {
    for (const m of loadMatches(dateKey)) {
      const pred = m?.predictions?.tm05_1h;
      if (!pred || pred.dsScore == null) continue;
      const dry = firstHalfDry(m);
      if (dry == null) continue; // no final outcome yet
      rows.push({
        dateKey,
        matchId: m.matchId,
        ds: pred.dsScore,
        phase: pred.phase,
        signal: pred.phase === 'signal',
        odds: pred.odds ?? tm05_1hOddsAt(pred.requestedAtMinute),
        dry,
      });
    }
  }

  if (!rows.length) {
    console.log('No tm05_1h decisions with final outcomes found.');
    return;
  }

  // Per-bucket realized P(dry)
  const buckets = {};
  for (const r of rows) {
    const b = bucketOf(r.ds);
    (buckets[b] ||= []).push(r);
  }

  console.log(`\n1HUNDER calibration — ${rows.length} decisions across ${dates.length} day(s)\n`);
  console.log('DS bucket |   n | P(dry) | signals | signal ROI');
  console.log('----------+-----+--------+---------+-----------');
  for (const b of Object.keys(buckets).sort()) {
    const arr = buckets[b];
    const n = arr.length;
    const pDry = arr.filter((r) => r.dry).length / n;
    const signals = arr.filter((r) => r.signal);
    let roi = null;
    if (signals.length) {
      const profit = signals.reduce((s, r) => s + (r.dry ? (r.odds || 0) - 1 : -1), 0);
      roi = profit / signals.length;
    }
    console.log(
      `${b.padEnd(9)} | ${String(n).padStart(3)} | ${pDry.toFixed(2).padStart(6)} | ` +
      `${String(signals.length).padStart(7)} | ${roi == null ? '   n/a' : roi.toFixed(3).padStart(10)}`,
    );
  }

  // Overall signal ROI
  const sig = rows.filter((r) => r.signal);
  if (sig.length) {
    const profit = sig.reduce((s, r) => s + (r.dry ? (r.odds || 0) - 1 : -1), 0);
    console.log(`\nSignals: ${sig.length} · hit-rate ${(sig.filter((r) => r.dry).length / sig.length).toFixed(2)} · ROI ${(profit / sig.length).toFixed(3)}`);
  }
  console.log('');
}

main();
