'use strict';
// Late-goal (>=38') detectability + statsLevel signal, on clean 0:0 candidates.
const fs = require('fs');
const days = ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22'];
const sum = (p) => p && (p.home != null || p.away != null) ? (p.home || 0) + (p.away || 0) : null;
const snapAt = (snaps, target) => { let s = null, b = 1e9; for (const x of snaps) { const mn = x.minute ?? 999; if (Math.abs(mn - target) < b) { b = Math.abs(mn - target); s = x; } } return b <= 4 ? s : null; };

const rows = [];
for (const d of days) {
  const m = JSON.parse(fs.readFileSync(`data/logs/${d}/matches.json`, 'utf8'));
  for (const id of Object.keys(m)) {
    const M = m[id], preds = M.predictions || {};
    const p = preds.tm05_1h?.htOutcome ? preds.tm05_1h : (preds.tb05_1h?.htOutcome ? preds.tb05_1h : null);
    if (!p?.htOutcome || typeof p.htOutcome.dry !== 'boolean') continue;
    const decMin = p.requestedAtMinute || 27, fgm = p.htOutcome.firstGoalMinute;
    if (!(p.htOutcome.dry || (fgm != null && fgm > decMin))) continue;
    const snaps = M.snapshots || [];
    const s20 = snapAt(snaps, 20), s27 = snapAt(snaps, decMin), s35 = snapAt(snaps, 35);
    rows.push({
      dry: p.htOutcome.dry, fgm, statsLevel: M.statsLevel || '?',
      fav: M.odds?.isOddsFavorite?.favorite || 'none', drawOdds: M.odds?.draw ?? null,
      shots27: sum(s27?.cumulative?.totalShots), shots20: sum(s20?.cumulative?.totalShots),
      sot27: sum(s27?.cumulative?.shotsOnTarget),
      sot35: sum(s35?.cumulative?.shotsOnTarget), shots35: sum(s35?.cumulative?.totalShots),
      has35: !!s35,
    });
  }
}

const rate = (l) => l.length ? `${(100 * l.filter((r) => r.dry).length / l.length).toFixed(0)}% (${l.filter((r) => r.dry).length}/${l.length})` : '—';
const avg = (l, f) => { const v = l.map(f).filter((x) => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—'; };

console.log('=== statsLevel: розподіл + DRY ===');
const lv = {}; for (const r of rows) (lv[r.statsLevel] ||= []).push(r);
for (const k of Object.keys(lv)) console.log(`  ${k.padEnd(10)} n=${String(lv[k].length).padStart(3)}  DRY ${rate(lv[k])}`);

const dry = rows.filter((r) => r.dry);
const early = rows.filter((r) => !r.dry && r.fgm < 38);
const late = rows.filter((r) => !r.dry && r.fgm >= 38);
const traj = (r) => r.shots27 != null && r.shots20 != null ? r.shots27 - r.shots20 : null;
console.log('\n=== Сегменти результату (чи відрізняються на 27 хв?) ===');
console.log('сегмент       | n  | fav% | draw  | shots@27 | SoT@27 | траєкт20→27 | shots@35 | SoT@35');
for (const [nm, l] of [['DRY (0:0)', dry], ['гол 28-37', early], ['гол >=38', late]]) {
  console.log(`${nm.padEnd(13)} | ${String(l.length).padStart(2)} | ${String((100 * l.filter((r) => r.fav !== 'none').length / l.length).toFixed(0)).padStart(3)}% | ${String(avg(l, (r) => r.drawOdds)).padStart(5)} | ${String(avg(l, (r) => r.shots27)).padStart(8)} | ${String(avg(l, (r) => r.sot27)).padStart(6)} | ${String(avg(l, traj)).padStart(11)} | ${String(avg(l, (r) => r.shots35)).padStart(8)} | ${avg(l, (r) => r.sot35)}`);
}

console.log('\n=== Матчі ще 0:0 на ~35 хв (вікно для ТБ-late, високий кеф) ===');
const at35 = rows.filter((r) => r.has35);
const g = at35.filter((r) => !r.dry && r.fgm >= 35);
console.log(`  Зі снепшотом ~35: ${at35.length}; гол у 35-45: ${g.length} (${(100 * g.length / at35.length).toFixed(0)}%) — базова ТБ-late ставка`);
const hi = at35.filter((r) => r.shots35 != null && r.shots35 >= 8);
const lo = at35.filter((r) => r.shots35 != null && r.shots35 < 8);
const gr = (l) => l.length ? `${(100 * l.filter((r) => !r.dry && r.fgm >= 35).length / l.length).toFixed(0)}% (n=${l.length})` : '—';
console.log(`  + БАГАТО ударів до 35 (>=8): гол 35-45 = ${gr(hi)}`);
console.log(`  + мало ударів до 35 (<8):   гол 35-45 = ${gr(lo)}`);
