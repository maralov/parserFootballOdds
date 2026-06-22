'use strict';
// EDA: what predicts DRY (HT 0:0) at decision time? Uses ALL resolved decisions
// (not just bets) across given days. DRY-rate by feature = the calibration signal.
const fs = require('fs');
const days = process.argv.slice(2).length ? process.argv.slice(2)
  : ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22'];

const sum = (pair) => pair && (pair.home != null || pair.away != null) ? (pair.home || 0) + (pair.away || 0) : null;

const rows = [];
for (const d of days) {
  const m = JSON.parse(fs.readFileSync(`data/logs/${d}/matches.json`, 'utf8'));
  for (const id of Object.keys(m)) {
    const match = m[id];
    const preds = match.predictions || {};
    const p = preds.tm05_1h?.htOutcome ? preds.tm05_1h : (preds.tb05_1h?.htOutcome ? preds.tb05_1h : null);
    if (!p || !p.htOutcome || typeof p.htOutcome.dry !== 'boolean') continue;
    const decMin = p.requestedAtMinute || 27;
    const snaps = match.snapshots || [];
    // snapshot closest to the decision minute (apples-to-apples "what we saw at decision")
    let snap = null, best = 1e9;
    for (const s of snaps) { const mn = s.minute ?? s.observedMinute ?? 999; const dd = Math.abs(mn - decMin); if (dd < best) { best = dd; snap = s; } }
    const cum = snap?.cumulative || {};
    const o = match.odds || {};
    const fav = o.isOddsFavorite?.favorite || 'none';
    rows.push({
      day: d, id, league: `${match.country}/${match.league}`,
      dry: p.htOutcome.dry, fgm: p.htOutcome.firstGoalMinute,
      dir: p.direction, dataAvail: p.dataAvailability, p: p.p, decMin,
      fav, favMargin: o.isOddsFavorite?.margin ?? 0,
      drawOdds: o.draw ?? null, homeOdds: o.home ?? null, awayOdds: o.away ?? null,
      sot: sum(cum.shotsOnTarget), shots: sum(cum.totalShots), corners: sum(cum.cornerKicks),
      xg: sum(cum.expectedGoalsXg),
      possHome: snap?.ballPossession?.home ?? null,
      snapMin: snap?.minute ?? null,
    });
  }
}

const pct = (h, n) => n ? `${(100 * h / n).toFixed(0)}%` : '—';
function dryRate(list) { const n = list.length, h = list.filter((r) => r.dry).length; return { n, h, rate: n ? h / n : null }; }
function bucketReport(title, list, keyFn, order) {
  console.log(`\n${title}:`);
  const g = {};
  for (const r of list) { const k = keyFn(r); if (k == null) continue; (g[k] ||= []).push(r); }
  const keys = order || Object.keys(g).sort();
  for (const k of keys) { const b = g[k]; if (!b || !b.length) continue; const s = dryRate(b); console.log(`  ${String(k).padEnd(22)} DRY ${pct(s.h, s.n).padStart(4)}  (${s.h}/${s.n})`); }
}

// VALID candidates only: 0:0 AT the decision minute (goal never fell, or fell AFTER
// the decision). Excludes goal_during/before_decision matches that contaminate the base rate.
const excluded = rows.filter((r) => !(r.dry || (r.fgm != null && r.fgm > r.decMin))).length;
const all = rows.filter((r) => r.dry || (r.fgm != null && r.fgm > r.decMin));
const base = dryRate(all);
console.log(`\n═══ Калібрування DRY (1-й тайм 0:0) — ${days.length} днів ═══`);
console.log(`Вирішених матчів: ${rows.length}; виключено (гол до/на момент рішення): ${excluded}; ЧИСТИХ кандидатів: ${all.length}`);
console.log(`\nБАЗОВА ставка DRY: ${pct(base.h, base.n)} (${base.h}/${base.n}) — стільки чистих 0:0-кандидатів на ~27' доходять сухими до перерви.`);
console.log(`(Тобто наосліп ставити ТМ → HR ≈ ${pct(base.h, base.n)}; ставити ТБ → HR ≈ ${pct(base.n - base.h, base.n)}.)`);

bucketReport('За ФАВОРИТОМ (передматч)', all, (r) => r.fav, ['none', 'home', 'away']);
bucketReport('За силою фаворита (margin до порогу 1.8)', all.filter((r) => r.fav !== 'none'),
  (r) => r.favMargin >= 0.4 ? 'сильний (≥0.4)' : r.favMargin >= 0.2 ? 'середній (0.2-0.4)' : 'слабкий (<0.2)',
  ['слабкий (<0.2)', 'середній (0.2-0.4)', 'сильний (≥0.4)']);
bucketReport('За кефом НІЧИЄЇ (проксі результативності)', all,
  (r) => r.drawOdds == null ? null : r.drawOdds < 2.8 ? 'низький <2.8 (мало голів)' : r.drawOdds < 3.4 ? '2.8-3.4' : r.drawOdds < 3.8 ? '3.4-3.8' : 'високий ≥3.8 (чекають гол)',
  ['низький <2.8 (мало голів)', '2.8-3.4', '3.4-3.8', 'високий ≥3.8 (чекають гол)']);
bucketReport('За ЛАЙВ-ударами в площину (SoT) на момент рішення', all,
  (r) => r.sot == null ? null : r.sot === 0 ? '0 (тиша)' : r.sot <= 2 ? '1-2' : '3+ (активно)',
  ['0 (тиша)', '1-2', '3+ (активно)']);
bucketReport('За ЛАЙВ-ударами всього', all,
  (r) => r.shots == null ? null : r.shots <= 2 ? '0-2' : r.shots <= 5 ? '3-5' : '6+ (активно)',
  ['0-2', '3-5', '6+ (активно)']);
bucketReport('За домінуванням у володінні |home-50|', all,
  (r) => r.possHome == null ? null : Math.abs(r.possHome - 50) <= 5 ? 'рівно (≤5)' : Math.abs(r.possHome - 50) <= 15 ? 'перекіс 6-15' : 'домінація 16+',
  ['рівно (≤5)', 'перекіс 6-15', 'домінація 16+']);
bucketReport('За кутовими (лайв)', all,
  (r) => r.corners == null ? null : r.corners <= 1 ? '0-1' : r.corners <= 3 ? '2-3' : '4+',
  ['0-1', '2-3', '4+']);
bucketReport('За data_availability (AI)', all, (r) => r.dataAvail || 'н/д', ['rich', 'partial', 'none', 'н/д']);
bucketReport('⏱ За ХВИЛИНОЮ рішення (досі 0:0 на цій хв)', all,
  (r) => r.decMin == null ? null : r.decMin <= 27 ? '25-27′' : r.decMin <= 31 ? '28-31′' : '32-35′',
  ['25-27′', '28-31′', '32-35′']);

// Best combined segment: low draw odds (low-scoring) AND late decision.
const seg = all.filter((r) => r.drawOdds != null && r.drawOdds < 3.4 && r.decMin >= 30);
const sLate = dryRate(all.filter((r) => r.decMin >= 32));
const sSeg = dryRate(seg);
console.log('\nКомбіновані сегменти:');
console.log(`  пізно (≥32′) + ще 0:0:                 DRY ${pct(sLate.h, sLate.n)} (${sLate.h}/${sLate.n})`);
console.log(`  низький кеф нічиєї (<3.4) + пізно (≥30′): DRY ${pct(sSeg.h, sSeg.n)} (${sSeg.h}/${sSeg.n})`);

// Routing check: favorite → ТБ (over), none → ТМ (under). Is the routing right?
console.log('\nПеревірка РОУТИНГУ напряму:');
const favRows = all.filter((r) => r.fav !== 'none');
const noFavRows = all.filter((r) => r.fav === 'none');
console.log(`  Є фаворит → роутимо ТБ(over). Гол-rate (ТБ hit) = ${pct(favRows.filter((r) => !r.dry).length, favRows.length)} (${favRows.filter((r) => !r.dry).length}/${favRows.length})`);
console.log(`  Немає фаворита → роутимо ТМ(under). DRY-rate (ТМ hit) = ${pct(noFavRows.filter((r) => r.dry).length, noFavRows.length)} (${noFavRows.filter((r) => r.dry).length}/${noFavRows.length})`);

// When do goals come? (non-dry firstGoalMinute)
const goals = all.filter((r) => !r.dry && r.fgm != null).map((r) => r.fgm).sort((a, b) => a - b);
const band = (lo, hi) => goals.filter((x) => x >= lo && x <= hi).length;
console.log('\nКоли падає перший гол (серед НЕ-сухих):');
console.log(`  до 30': ${band(0, 30)} | 31-37': ${band(31, 37)} | 38-42': ${band(38, 42)} | 43-45'+: ${band(43, 60)}  (усього ${goals.length})`);
const lateShare = goals.length ? (band(38, 60) / goals.length) : 0;
console.log(`  частка «пізніх» голів (≥38'): ${(lateShare * 100).toFixed(0)}% — їх майже не видно на 27'.`);

// "Active but dry" — high SoT at decision yet still 0:0 at HT (false-active)
const active = all.filter((r) => r.sot != null && r.sot >= 3);
console.log(`\n«Активно, але 0:0» (SoT≥3 на рішенні): ${active.filter((r) => r.dry).length}/${active.length} все одно дійшли сухими (${pct(active.filter((r) => r.dry).length, active.length)}).`);
console.log('');
