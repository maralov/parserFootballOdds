'use strict';
// One-off aggregator: runs the analyze-predictions skill across the post-change
// test days and rolls up HR/ROI/calibration + the new consensus/floor/flip funnel.
const fs = require('fs');
const path = require('path');
const { analyze } = require('../.claude/skills/analyze-predictions/analyze');

const DAYS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22'];

const allBets = [];
const perDay = [];
const funnel = { signal: 0, skipped_by_consensus: 0, skipped_by_min_p: 0, flipped_away: 0, gate_blocked: 0, goal_during_decision: 0, ai_error: 0, ai_pending: 0, tracked: 0 };
const flips = []; // bets that were flipped (pred.flippedFrom present)

for (const day of DAYS) {
  let r;
  try { r = analyze(day); } catch (e) { console.log(`${day}: SKIP (${e.message})`); continue; }
  perDay.push(r);
  allBets.push(...r.bets);

  // Funnel from matches.json phases (both line keys).
  const mPath = path.resolve(__dirname, '..', 'data', 'logs', day, 'matches.json');
  const matches = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  for (const id of Object.keys(matches)) {
    funnel.tracked += 1;
    const preds = matches[id].predictions || {};
    for (const key of ['tm05_1h', 'tb05_1h']) {
      const p = preds[key];
      if (!p || !p.phase) continue;
      if (funnel[p.phase] != null) funnel[p.phase] += 1;
      if (p.flippedFrom) flips.push({ day, id, from: p.flippedFrom, to: p.direction, phase: p.phase });
    }
  }
}

function pct(n) { return n == null ? 'н/д' : `${(n * 100).toFixed(1)}%`; }

function rollup(bets) {
  const settled = bets.filter((b) => b.hit != null && b.odds != null);
  const hits = settled.filter((b) => b.hit);
  const stake = settled.length;
  const returns = hits.reduce((s, b) => s + b.odds, 0);
  const net = returns - stake;
  const avgOdds = stake ? settled.reduce((s, b) => s + b.odds, 0) / stake : null;
  return { n: bets.length, settled: stake, hits: hits.length, misses: stake - hits.length,
    hr: stake ? hits.length / stake : null, net, roi: stake ? net / stake : null,
    avgOdds, breakEven: avgOdds ? 1 / avgOdds : null, pending: bets.length - stake };
}

console.log(`\n═══ Агрегат тестових днів нового коду: ${DAYS.join(', ')} ═══\n`);

console.log('Per-day (на записаних модельних кефах):');
console.log('день       | ставок | HIT/MISS | HR     | net u  | ROI');
for (const r of perDay) {
  const a = r.agg.__all__;
  console.log(`${r.date} | ${String(a.n).padStart(6)} | ${`${a.hits}/${a.misses}`.padEnd(8)} | ${pct(a.hr).padEnd(6)} | ${String((a.net ?? 0).toFixed(2)).padStart(6)} | ${pct(a.roi)}`);
}

console.log('\nПо лініях (усі дні разом):');
console.log('лінія | ставок | HIT/MISS | HR     | сер.кеф | беззбит | net u  | ROI');
for (const key of ['tm05_1h', 'tb05_1h']) {
  const r = rollup(allBets.filter((b) => b.key === key));
  if (!r.settled) continue;
  const label = key === 'tm05_1h' ? 'ТМ  ' : 'ТБ  ';
  console.log(`${label}  | ${String(r.n).padStart(6)} | ${`${r.hits}/${r.misses}`.padEnd(8)} | ${pct(r.hr).padEnd(6)} | ${(r.avgOdds ?? 0).toFixed(2).padEnd(7)} | ${pct(r.breakEven).padEnd(7)} | ${r.net.toFixed(2).padStart(6)} | ${pct(r.roi)}`);
}
const all = rollup(allBets);
console.log(`УСЬОГО| ${String(all.n).padStart(6)} | ${`${all.hits}/${all.misses}`.padEnd(8)} | ${pct(all.hr).padEnd(6)} | ${(all.avgOdds ?? 0).toFixed(2).padEnd(7)} | ${pct(all.breakEven).padEnd(7)} | ${all.net.toFixed(2).padStart(6)} | ${pct(all.roi)}`);
console.log(`(pending/нерозв'язані: ${all.pending})`);

// Calibration across all settled bets.
const buckets = {};
for (const b of allBets) { if (b.p == null || b.hit == null) continue; (buckets[b.p.toFixed(2)] ||= []).push(b.hit); }
console.log('\nКалібрування p (усі дні):');
for (const [p, hs] of Object.entries(buckets).sort((a, b) => +a[0] - +b[0])) {
  console.log(`  p=${p}  n=${String(hs.length).padStart(3)}  HR=${pct(hs.filter(Boolean).length / hs.length)}`);
}

// New-gate funnel.
console.log('\nВоронка нового гейту (фази рішень, усі дні):');
console.log(`  кандидатів(record): ${funnel.tracked}`);
console.log(`  ✅ signal: ${funnel.signal}   | gate_blocked: ${funnel.gate_blocked}`);
console.log(`  ⛔ skipped_by_min_p (p<0.50): ${funnel.skipped_by_min_p}`);
console.log(`  ⛔ skipped_by_consensus: ${funnel.skipped_by_consensus}`);
console.log(`  🔄 flipped_away: ${funnel.flipped_away}`);
console.log(`  goal_during_decision: ${funnel.goal_during_decision} | ai_error: ${funnel.ai_error} | ai_pending(нерозв.): ${funnel.ai_pending}`);

// Flip outcomes.
console.log('\nРезультати флипів (ставки, що перевернулись):');
const flipIds = new Set(flips.map((f) => f.id));
const flipBets = allBets.filter((b) => flipIds.has(b.id));
if (!flipBets.length) console.log('  (жодна перевернута ставка не дійшла до сигналу/ставки)');
for (const b of flipBets) {
  console.log(`  ${b.id} ${b.teams} → ${b.dir} | кеф ${b.odds} | ${b.hit == null ? 'PENDING' : b.hit ? '✅' : '❌'}`);
}

// Contradiction residual (should be ~0 now — gate acts on them).
const contraTot = allBets.filter((b) => b.contradiction && b.hit != null);
console.log(`\nЗалишкові протиріччя серед СТАВОК: ${contraTot.length} (гейт мав їх зняти; ${contraTot.filter((b) => b.hit).length} виграно)`);
console.log('');
