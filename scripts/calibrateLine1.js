#!/usr/bin/env node
'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { evaluateLine1Dry } = require('../src/pipeline/line1/dryEngine');

const argv = process.argv.slice(2);
const validateOnly = argv.includes('--validate-only');
const verbose = argv.includes('--verbose');

const LIVE_LOGS_DIR = path.join(__dirname, '..', 'data', 'logs');

function listLogDates() {
  if (!fs.existsSync(LIVE_LOGS_DIR)) return [];
  return fs.readdirSync(LIVE_LOGS_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}

function loadDayMatchesRaw(date) {
  const fp = path.join(LIVE_LOGS_DIR, date, 'matches.json');
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) || []; } catch { return []; }
}

const dates = listLogDates();
console.log(`Found ${dates.length} log dates`);

const candidates = [];
for (const d of dates) {
  const matches = loadDayMatchesRaw(d);
  for (const m of matches) {
    if (!m.matchId || !m.finalScore) continue;
    if (!Array.isArray(m.snapshotHistoryV2) || m.snapshotHistoryV2.length < 2) continue;
    const snapAt50 = m.snapshotHistoryV2.find((s) => s.matchMinute >= 48 && s.matchMinute <= 55);
    if (!snapAt50) continue;
    if (!snapAt50.score || String(snapAt50.score.home) !== '0' || String(snapAt50.score.away) !== '0') continue;
    candidates.push({ date: d, match: m, snapAt50 });
  }
}
console.log(`Candidates 0:0 at 48-55': ${candidates.length}`);

let signals = 0, hits = 0, misses = 0;
for (const c of candidates) {
  // Approximate raw1H from snapAt50.raw2H (placeholder until real 1H scraping)
  const raw1H = { ...c.snapAt50.raw2H };
  const features = {
    matchId: c.match.matchId,
    league: c.match.league,
    minute: c.snapAt50.matchMinute,
    raw1H,
    raw2H: c.snapAt50.raw2H,
    rawOverall: c.snapAt50.raw2H,
    odds1X2: c.match.prediction?.odds1X2 || null,
    statsStatus: 'overall_only',
  };
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features,
    snapshots: c.match.snapshotHistoryV2 || [],
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    preMatchAggregates: c.match.preMatchV3?.aggregates || null,
  });

  if (result.bet === 'UNDER_0_5' && result.signalEligible) {
    signals++;
    const fs = c.match.finalScore;
    const isWin = String(fs.home) === '0' && String(fs.away) === '0';
    if (isWin) hits++; else misses++;
    if (verbose) {
      console.log(`  [${c.date}] ${c.match.home} - ${c.match.away}: pDry=${result.pDry} → ${isWin ? 'HIT' : 'MISS'} (final ${fs.home}:${fs.away})`);
    }
  }
}

const hr = signals > 0 ? (hits / signals) : null;
console.log(`\n=== Backtest results ===`);
console.log(`Candidates: ${candidates.length}`);
console.log(`Line1 signals: ${signals}`);
console.log(`Hits: ${hits}, Misses: ${misses}`);
console.log(`HR: ${hr == null ? 'n/a' : (hr * 100).toFixed(1) + '%'}`);
console.log(`Recall: ${candidates.length > 0 ? ((signals / candidates.length) * 100).toFixed(1) + '%' : 'n/a'}`);

if (validateOnly) {
  console.log('\n[validate-only] Not changing weights.');
}

console.log('\nNote: raw1H is approximated from snapshot data. Full calibration requires re-scraping with 1H endpoint.');
