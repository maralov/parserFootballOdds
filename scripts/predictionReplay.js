'use strict';
const fs = require('fs');
const path = require('path');
const { brier, logLoss, roiFlat, roiKelly } = require('../src/prediction/calibrationMetrics');

const DATA_ROOT = path.resolve(__dirname, '../data/logs');

function totalGoals(final) {
  if (!final) return null;
  return (final.scoreHome || 0) + (final.scoreAway || 0);
}

// Returns { tm05: [...samples], tb05: [...samples] }.
// A sample is included only when the track has a logged probability AND a final exists.
function buildSamplesFromStore(store) {
  const tm05 = []; const tb05 = [];
  for (const [matchId, m] of Object.entries(store)) {
    const g = totalGoals(m.final);
    if (g == null) continue;
    const tm = m.predictions?.tm05;
    if (tm && tm.pNoGoal != null) {
      tm05.push({ matchId, p: tm.pNoGoal, confidence: tm.confidence ?? null,
        odds: tm.odds ?? null, phase: tm.phase, outcome: g === 0 ? 1 : 0 });
    }
    const tb = m.predictions?.tb05;
    if (tb && tb.pGoal != null) {
      tb05.push({ matchId, p: tb.pGoal, confidence: tb.confidence ?? null,
        odds: tb.odds ?? null, phase: tb.phase, outcome: g >= 1 ? 1 : 0 });
    }
  }
  return { tm05, tb05 };
}

function report(label, samples) {
  if (!samples.length) return { label, n: 0 };
  const bets = samples.filter(s => s.phase === 'signal' && s.odds);
  return {
    label,
    n: samples.length,
    brier: brier(samples),
    logLoss: logLoss(samples),
    signals: bets.length,
    hitRate: bets.length ? +(bets.filter(b => b.outcome).length / bets.length).toFixed(4) : null,
    roiFlat: roiFlat(bets),
    roiKelly: roiKelly(bets),
  };
}

function listDateDirs(range) {
  const all = fs.readdirSync(DATA_ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!range) return all;
  const [from, to] = range.split('..');
  return all.filter(d => d >= from && d <= (to || from));
}

function main() {
  const range = process.argv[2]; // e.g. "2026-05-09..2026-05-13"
  const dirs = listDateDirs(range);
  const merged = { tm05: [], tb05: [] };
  for (const d of dirs) {
    const file = path.join(DATA_ROOT, d, 'matches.json');
    if (!fs.existsSync(file)) continue;
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = buildSamplesFromStore(store);
    merged.tm05.push(...s.tm05);
    merged.tb05.push(...s.tb05);
  }
  const out = { range: range || 'all', dates: dirs,
    tm05: report('TM05', merged.tm05), tb05: report('TB05', merged.tb05) };
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main();

module.exports = { buildSamplesFromStore, report };
