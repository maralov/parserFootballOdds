'use strict';
// ТБ investigation: on DETAILED matches, in what live-xG range (at decision) do
// goals happen most, and WHEN do they fall? Clean 0:0 candidates only.
const fs = require('fs');
const days = ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22'];
const sum = (p) => p && (p.home != null || p.away != null) ? (p.home || 0) + (p.away || 0) : null;
const snapAt = (snaps, t) => { let s = null, b = 1e9; for (const x of snaps) { const mn = x.minute ?? 999; if (Math.abs(mn - t) < b) { b = Math.abs(mn - t); s = x; } } return b <= 4 ? s : null; };

const R = [];
for (const d of days) {
  const m = JSON.parse(fs.readFileSync(`data/logs/${d}/matches.json`, 'utf8'));
  for (const id of Object.keys(m)) {
    const M = m[id], preds = M.predictions || {};
    if (M.statsLevel !== 'detailed') continue;
    const p = preds.tm05_1h?.htOutcome ? preds.tm05_1h : (preds.tb05_1h?.htOutcome ? preds.tb05_1h : null);
    if (!p?.htOutcome || typeof p.htOutcome.dry !== 'boolean') continue;
    const decMin = p.requestedAtMinute || 27, fgm = p.htOutcome.firstGoalMinute;
    if (!(p.htOutcome.dry || (fgm != null && fgm > decMin))) continue;
    const s27 = snapAt(M.snapshots || [], decMin);
    R.push({ dry: p.htOutcome.dry, fgm, decMin, xg: sum(s27?.cumulative?.expectedGoalsXg), sot: sum(s27?.cumulative?.shotsOnTarget) });
  }
}
const withXg = R.filter((r) => r.xg != null);
console.log(`\n═══ ТБ-дослідження на DETAILED: ${R.length} чистих кандидатів, ${withXg.length} з xG ═══`);

// xG bucket -> goal rate (ТБ hit), with median goal minute
function band(name, lo, hi) {
  const l = withXg.filter((r) => r.xg >= lo && r.xg < hi);
  if (!l.length) { console.log(`  ${name.padEnd(16)} n=0`); return; }
  const goals = l.filter((r) => !r.dry);
  const mins = goals.map((r) => r.fgm).filter((x) => x != null).sort((a, b) => a - b);
  const med = mins.length ? mins[Math.floor(mins.length / 2)] : '—';
  console.log(`  ${name.padEnd(16)} n=${String(l.length).padStart(3)}  гол-rate ${String(Math.round(100 * goals.length / l.length)).padStart(3)}%  (n_голів=${goals.length}, медіана хв голу=${med})`);
}
console.log('\nГол-rate (ТБ hit) за лайв-xG на момент рішення:');
band('xG 0-0.05', 0, 0.05);
band('xG 0.05-0.15', 0.05, 0.15);
band('xG 0.15-0.30', 0.15, 0.30);
band('xG 0.30-0.50', 0.30, 0.50);
band('xG 0.50-0.80', 0.50, 0.80);
band('xG 0.80+', 0.80, 99);

// Goal timing on detailed (all non-dry)
const goalMins = R.filter((r) => !r.dry && r.fgm != null).map((r) => r.fgm).sort((a, b) => a - b);
const tb = (lo, hi) => goalMins.filter((x) => x >= lo && x <= hi).length;
console.log(`\nКоли падали голи (detailed, ${goalMins.length} голів):`);
console.log(`  ≤30': ${tb(0, 30)} | 31-35': ${tb(31, 35)} | 36-40': ${tb(36, 40)} | 41-45'+: ${tb(41, 60)}`);
console.log(`  медіана хв голу: ${goalMins.length ? goalMins[Math.floor(goalMins.length / 2)] : '—'}`);

// Cross: does higher xG mean EARLIER goal?
console.log('\nxG vs середня хвилина голу (для тих, що забили):');
for (const [nm, lo, hi] of [['xG<0.15', 0, 0.15], ['xG 0.15-0.40', 0.15, 0.40], ['xG≥0.40', 0.40, 99]]) {
  const g = withXg.filter((r) => !r.dry && r.fgm != null && r.xg >= lo && r.xg < hi);
  const avg = g.length ? (g.reduce((a, r) => a + r.fgm, 0) / g.length).toFixed(0) : '—';
  console.log(`  ${nm.padEnd(14)} n_голів=${String(g.length).padStart(2)}  сер.хв=${avg}`);
}
console.log('');
