'use strict';
// Counterfactual backtest of SELECTION rules over all clean 0:0 candidates.
// Uses production oddsTable for odds. ТМ wins iff dry; ТБ wins iff goal before HT.
const fs = require('fs');
const { tm05_1hOddsAt, tb05_1hOddsAt } = require('../src/scoring/oddsTable');
const days = ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22'];
const sum = (p) => p && (p.home != null || p.away != null) ? (p.home || 0) + (p.away || 0) : null;
const snapAt = (snaps, t) => { let s = null, b = 1e9; for (const x of snaps) { const mn = x.minute ?? 999; if (Math.abs(mn - t) < b) { b = Math.abs(mn - t); s = x; } } return b <= 4 ? s : null; };

const C = [];
for (const d of days) {
  const m = JSON.parse(fs.readFileSync(`data/logs/${d}/matches.json`, 'utf8'));
  for (const id of Object.keys(m)) {
    const M = m[id], preds = M.predictions || {};
    const p = preds.tm05_1h?.htOutcome ? preds.tm05_1h : (preds.tb05_1h?.htOutcome ? preds.tb05_1h : null);
    if (!p?.htOutcome || typeof p.htOutcome.dry !== 'boolean') continue;
    const decMin = p.requestedAtMinute || 27, fgm = p.htOutcome.firstGoalMinute;
    if (!(p.htOutcome.dry || (fgm != null && fgm > decMin))) continue;
    const snaps = M.snapshots || [];
    const s27 = snapAt(snaps, decMin), s35 = snapAt(snaps, 35);
    C.push({
      dry: p.htOutcome.dry, fgm, decMin, statsLevel: M.statsLevel || '?',
      fav: M.odds?.isOddsFavorite?.favorite || 'none', drawOdds: M.odds?.draw ?? null,
      xg: sum(s27?.cumulative?.expectedGoalsXg), sot27: sum(s27?.cumulative?.shotsOnTarget),
      odds: M.odds, has35: !!s35, goal3545: (!p.htOutcome.dry && fgm >= 35),
      tmOdds: tm05_1hOddsAt(decMin, M.odds), tbOdds: tb05_1hOddsAt(decMin, M.odds),
    });
  }
}

// Evaluate a strategy: pick(c)->null|'TM'|'TB'|'TB35'. Returns stats.
function evalStrat(name, pick) {
  let n = 0, hits = 0, stake = 0, ret = 0, oddsSum = 0;
  for (const c of C) {
    const side = pick(c);
    if (!side) continue;
    let odds, win;
    if (side === 'TM') { odds = c.tmOdds; win = c.dry; }
    else if (side === 'TB') { odds = c.tbOdds; win = !c.dry; }
    else if (side === 'TB35') { if (!c.has35) continue; odds = 2.5; win = c.goal3545; }
    if (odds == null) continue;
    n += 1; oddsSum += odds; stake += 1; ret += win ? odds : 0; if (win) hits += 1;
  }
  const net = ret - stake;
  const hr = stake ? hits / stake : null, avg = stake ? oddsSum / stake : null;
  return { name, n, hr, avg, be: avg ? 1 / avg : null, net, roi: stake ? net / stake : null };
}

const pct = (x) => x == null ? '—' : `${(100 * x).toFixed(0)}%`;
const strategies = [
  evalStrat('ТМ наосліп (усі кандидати)', () => 'TM'),
  evalStrat('ТМ на detailed', (c) => c.statsLevel === 'detailed' ? 'TM' : null),
  evalStrat('ТМ на detailed + xG≤0.15', (c) => (c.statsLevel === 'detailed' && c.xg != null && c.xg <= 0.15) ? 'TM' : null),
  evalStrat('ТМ на detailed + нічия<3.4', (c) => (c.statsLevel === 'detailed' && c.drawOdds != null && c.drawOdds < 3.4) ? 'TM' : null),
  evalStrat('ТМ на xG≤0.15 (будь-яка ліга з xG)', (c) => (c.xg != null && c.xg <= 0.15) ? 'TM' : null),
  evalStrat('ТБ наосліп (усі)', () => 'TB'),
  evalStrat('ТБ на basic', (c) => c.statsLevel === 'basic' ? 'TB' : null),
  evalStrat('ТБ на basic + є фаворит', (c) => (c.statsLevel === 'basic' && c.fav !== 'none') ? 'TB' : null),
  evalStrat('ТБ-late (ще 0:0 на 35′, кеф 2.5)', () => 'TB35'),
];

console.log(`\n═══ Бектест відбору на ${C.length} чистих кандидатах (модельні кефи) ═══\n`);
console.log('стратегія                          | n   | HR   | сер.кеф | беззбит | net u  | ROI');
console.log('-'.repeat(92));
for (const s of strategies) {
  console.log(`${s.name.padEnd(34)} | ${String(s.n).padStart(3)} | ${pct(s.hr).padStart(4)} | ${(s.avg ?? 0).toFixed(2).padStart(7)} | ${pct(s.be).padStart(7)} | ${(s.net).toFixed(2).padStart(6)} | ${pct(s.roi)}`);
}
console.log('\n(ТМ виграє якщо 1-й тайм 0:0; ТБ — якщо гол до перерви. Беззбитковість = 1/кеф.)');
