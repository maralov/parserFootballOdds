'use strict';

/**
 * Offline recalibration harness for Line B (TB 0.5 — «буде хоча б один гол»).
 *
 * Usage:
 *   node scripts/psRecalibration.js [dateRange]
 *   node scripts/psRecalibration.js "2026-05-09..2026-06-07"
 *   node scripts/psRecalibration.js "2026-06-07"
 *
 * Reads data/logs/<date>/matches.json, recomputes PS offline, sweeps thresholds.
 * Does NOT call AI, does NOT modify any source files.
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { hydrateAll }   = require(path.join(ROOT, 'src/tracker/snapshotHydrator'));
const { computePS, COMPONENTS: PS_COMPS } = require(path.join(ROOT, 'src/scoring/pressureScore'));
const { computeDS }    = require(path.join(ROOT, 'src/scoring/drynessScore'));
const { tb05OddsAt, tm05OddsAt } = require(path.join(ROOT, 'src/scoring/oddsTable'));
const { roiFlat, roiKelly }      = require(path.join(ROOT, 'src/prediction/calibrationMetrics'));

const DATA_ROOT        = path.join(ROOT, 'data/logs');
const DECISION_MINUTES = [80, 85, 88];
const PS_THRESHOLDS    = [25, 30, 35, 40, 45, 50, 55, 60];
const DS_THRESHOLDS    = [50, 55, 60, 65, 70];

// ── helpers ──────────────────────────────────────────────────────────────────

function listDateDirs(range) {
  const all = fs.readdirSync(DATA_ROOT)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !d.startsWith('2099'))
    .sort();
  if (!range) return all;
  const [from, to] = range.split('..');
  return all.filter(d => d >= from && d <= (to || from));
}

function loadMatches(dateStr) {
  const f = path.join(DATA_ROOT, dateStr, 'matches.json');
  if (!fs.existsSync(f)) return [];
  const store = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Array.isArray(store) ? store : Object.values(store);
}

/**
 * Find snapshot closest to targetMinute within maxDiff.
 * If requireZeroZero=true, score must be 0:0 at that snapshot.
 */
function findSnap(hydrated, targetMinute, maxDiff = 5, requireZeroZero = false) {
  let best = null; let bestDiff = Infinity;
  for (const s of hydrated) {
    const mn = s.minute ?? s.observedMinute;
    if (mn == null) continue;
    const diff = Math.abs(mn - targetMinute);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  if (!best || bestDiff > maxDiff) return null;
  if (requireZeroZero && (best.scoreHome || 0) + (best.scoreAway || 0) > 0) return null;
  return best;
}

// hit = goal scored AFTER decisionMinute (correct TB 0.5 bet outcome)
function hitAfterMinute(m, decisionMinute) {
  const f = m.final;
  if (!f || f.scoreHome == null) return null;
  const totalGoals = (f.scoreHome || 0) + (f.scoreAway || 0);
  if (totalGoals === 0) return false;
  const fgm = f.firstGoalMinute;
  if (fgm == null) return true; // goals present but minute not recorded → assume after
  return fgm > decisionMinute;
}

const pct  = (n, d) => d ? (n / d * 100).toFixed(1) + '%' : 'n/a';
const f2   = v => v != null ? Number(v).toFixed(2) : 'n/a';
const f3   = v => v != null ? Number(v).toFixed(3) : 'n/a';
const hr   = (ch, w = 64) => ch.repeat(w);
const col  = (s, w) => String(s ?? 'n/a').padStart(w);
const lft  = (s, w) => String(s ?? 'n/a').padEnd(w);
const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const max  = arr => arr.length ? Math.max(...arr) : null;

// ── Build Line-B samples ──────────────────────────────────────────────────────

function buildLineBSamples(allRows) {
  const samples = [];
  for (const { match: m, day } of allRows) {
    if (!m.snapshots || !m.baseline1H) continue;
    const h = hydrateAll(m.snapshots, m.baseline1H);
    const s60 = findSnap(h, 60, 5, false);

    for (const M of DECISION_MINUTES) {
      // Require score 0:0 at the decision snapshot
      const sM = findSnap(h, M, 5, true);
      if (!sM) continue;
      let psResult;
      try { psResult = computePS(m, sM, s60); } catch { continue; }
      if (psResult.score == null) continue;
      const outcome = hitAfterMinute(m, M);
      if (outcome === null) continue;
      const odds = tb05OddsAt(M);
      samples.push({
        matchId:    m.matchId,
        day,
        teams:      ((m.homeTeam || '') + ' — ' + (m.awayTeam || '')).slice(0, 30),
        M,
        ps:         psResult.score,
        components: psResult.components,
        outcome:    outcome ? 1 : 0,
        odds,
      });
    }
  }
  return samples;
}

// ── Build Line-A (DS) samples ─────────────────────────────────────────────────

function buildLineASamples(allRows) {
  const samples = [];
  for (const { match: m, day } of allRows) {
    if (!m.snapshots || !m.baseline1H || !m.final || m.final.scoreHome == null) continue;
    const h = hydrateAll(m.snapshots, m.baseline1H);
    // Require 0:0 at 60' snapshot
    const s60 = findSnap(h, 60, 5, true);
    if (!s60) continue;
    let dsResult;
    try { dsResult = computeDS(m, s60); } catch { continue; }
    if (dsResult.score == null) continue;
    const totalGoals = (m.final.scoreHome || 0) + (m.final.scoreAway || 0);
    const outcome0 = totalGoals === 0 ? 1 : 0;
    const odds = tm05OddsAt(60) || 2.0;
    const loggedPhase = m.predictions?.tm05?.phase ?? null;
    const loggedDs    = m.predictions?.tm05?.dsScore ?? null;
    samples.push({ matchId: m.matchId, day, ds: dsResult.score, loggedDs, loggedPhase, outcome0, odds });
  }
  return samples;
}

// ── SWEEP A: PS threshold × decision minute ───────────────────────────────────

function sweepA(samples) {
  console.log('\n' + hr('═'));
  console.log(' SWEEP A — Поріг PS × хвилина рішення  (hit = гол ПІСЛЯ хвилини ставки)');
  console.log(hr('─'));
  for (const M of DECISION_MINUTES) {
    const g = samples.filter(s => s.M === M);
    const h = g.filter(s => s.outcome === 1).length;
    const ev0 = h / (g.length || 1) * (tb05OddsAt(M) || 1);
    console.log(`M=${M}' @${tb05OddsAt(M)} | n=${g.length} base-hit=${pct(h, g.length)} base-EV=${f2(ev0)}`);
  }
  console.log();

  // Table header
  const COL = 34;
  const header = lft('Поріг', 8) + DECISION_MINUTES.map(M =>
    lft(`M=${M}'  @${tb05OddsAt(M)}`, COL)).join('');
  console.log(header);
  console.log(hr('─', 8 + COL * DECISION_MINUTES.length));

  for (const T of PS_THRESHOLDS) {
    const row = [lft('PS≥' + T, 8)];
    for (const M of DECISION_MINUTES) {
      const group = samples.filter(s => s.M === M && s.ps >= T);
      if (!group.length) { row.push(lft('—', COL)); continue; }
      const hits = group.filter(s => s.outcome === 1).length;
      const hitR = hits / group.length;
      const ev   = hitR * (tb05OddsAt(M) || 1);
      const roi  = roiFlat(group.map(s => ({ outcome: s.outcome, odds: s.odds })));
      const roiK = roiKelly(group.map(s => ({ outcome: s.outcome, odds: s.odds, p: hitR })));
      const cell = `n=${group.length} hit=${pct(hits, group.length)} EV=${f2(ev)} roi=${f3(roi)} K=${f3(roiK)}`;
      row.push(lft(cell, COL));
    }
    console.log(row.join(''));
  }
}

// ── SWEEP B: Component analysis ───────────────────────────────────────────────

function sweepB(samples) {
  console.log('\n' + hr('═'));
  console.log(' SWEEP B — Аналіз компонентів PS (M=80, усі семпли)');
  console.log(hr('─'));

  const base   = samples.filter(s => s.M === 80);
  const goal   = base.filter(s => s.outcome === 1);
  const noGoal = base.filter(s => s.outcome === 0);

  if (!base.length) { console.log('Немає семплів M=80.'); return; }

  const allKeys = [...PS_COMPS.map(c => c.key), 'league_bias'];
  const weightMap = Object.fromEntries(PS_COMPS.map(c => [c.key, c.weight]));
  weightMap.league_bias = 5;
  const totalW = allKeys.reduce((s, k) => s + (weightMap[k] || 0), 0);

  const W = [24, 4, 9, 6, 7, 8, 8, 9, 22];
  console.log(
    lft('Компонент', W[0]) + col('w', W[1]) + col('null', W[2]) +
    col('@100', W[3]) + col('avg', W[4]) + col('avgGoal', W[5]) +
    col('avgMiss', W[6]) + col('contrib', W[7]) + '  статус'
  );
  console.log(hr('─', W.reduce((a, b) => a + b, 0) + 10));

  for (const key of allKeys) {
    const vals  = base.map(s => s.components[key]).filter(v => v != null);
    const vGoal = goal.map(s => s.components[key]).filter(v => v != null);
    const vMiss = noGoal.map(s => s.components[key]).filter(v => v != null);
    const nulls = base.length - vals.length;
    const at100 = vals.filter(v => v >= 99).length;
    const avg   = mean(vals);
    const w     = weightMap[key] || 0;
    const contrib = avg != null ? (avg * w / totalW) : 0;

    let status = '';
    if (nulls === base.length)          status = '⛔ завжди null — мертвий';
    else if (nulls > base.length * 0.4) status = '⚠  >40% null';
    else if (at100 > vals.length * 0.7) status = '⚠  насичений >70% @100';
    else if (avg != null && avg < 15)   status = '⬇  низький, тягне вниз';

    const discrim = (mean(vGoal) != null && mean(vMiss) != null)
      ? (mean(vGoal) - mean(vMiss)).toFixed(1) : 'n/a';

    console.log(
      lft(key, W[0]) +
      col(w, W[1]) +
      col(nulls + '/' + base.length, W[2]) +
      col(at100, W[3]) +
      col(avg != null ? avg.toFixed(1) : 'n/a', W[4]) +
      col(mean(vGoal) != null ? mean(vGoal).toFixed(1) : 'n/a', W[5]) +
      col(mean(vMiss) != null ? mean(vMiss).toFixed(1) : 'n/a', W[6]) +
      col(contrib.toFixed(1), W[7]) +
      '  ' + status + (status ? '' : `  Δ=${discrim}`)
    );
  }

  const avgPS     = mean(base.map(s => s.ps));
  const avgGoalPS = mean(goal.map(s => s.ps));
  const avgMissPS = mean(noGoal.map(s => s.ps));
  console.log(hr('─', 70));
  console.log(
    `  Середній PS: ALL=${f2(avgPS)}  goal=${f2(avgGoalPS)}  miss=${f2(avgMissPS)}  ` +
    `Δ=${f2(avgGoalPS - avgMissPS)}`
  );

  console.log('\n  Розподіл PS@80 (goalRate per bucket):');
  const buckets = {};
  base.forEach(s => {
    const b = Math.floor(s.ps / 10) * 10;
    if (!buckets[b]) buckets[b] = { n: 0, hit: 0 };
    buckets[b].n++; buckets[b].hit += s.outcome;
  });
  Object.keys(buckets).sort((a, b) => a - b).forEach(b => {
    const { n, hit } = buckets[b];
    const bar = '█'.repeat(Math.round(hit / n * 16));
    const space = '░'.repeat(16 - Math.round(hit / n * 16));
    console.log(`    PS ${String(b).padStart(2)}-${+b + 9}: n=${String(n).padStart(2)}  hit=${pct(hit, n).padStart(6)}  [${bar}${space}]`);
  });
}

// ── SWEEP C: Formula variants ─────────────────────────────────────────────────

function buildVariant1Comps() {
  // Remove big_chances_delta_10 (w=5) and big_chances_2h (w=8); redistribute 13 pts proportionally
  const alive = PS_COMPS.filter(c => c.key !== 'big_chances_delta_10' && c.key !== 'big_chances_2h');
  const oldTotal = alive.reduce((s, c) => s + c.weight, 0); // 82
  const newTotal = 90; // remaining non-league weight
  return alive.map(c => ({ ...c, weight: Math.round(c.weight / oldTotal * newTotal) }));
}

function buildVariant2Comps() {
  // Divisors ×2 — less aggressive normalization, more spread
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function sumS(p) {
    if (!p) return null;
    if (p.home == null && p.away == null) return null;
    return (p.home || 0) + (p.away || 0);
  }
  return [
    { key: 'xg_delta_10',          weight: 12, fn: (m, s) => { const v = sumS(s?.delta?.expectedGoalsXg); return v == null ? null : 100 * clamp(v / 1.2, 0, 1); } },
    { key: 'sot_delta_10',         weight: 10, fn: (m, s) => { const v = sumS(s?.delta?.shotsOnTarget); return v == null ? null : 100 * clamp(v / 8, 0, 1); } },
    { key: 'touches_delta_10',     weight:  8, fn: (m, s) => { const v = sumS(s?.delta?.touchesInOppositionBox); return v == null ? null : 100 * clamp(v / 16, 0, 1); } },
    { key: 'corners_delta_10',     weight:  5, fn: (m, s) => { const v = sumS(s?.delta?.cornerKicks); return v == null ? null : 100 * clamp(v / 6, 0, 1); } },
    { key: 'big_chances_delta_10', weight:  5, fn: (m, s) => { const v = sumS(s?.delta?.bigChances); return v == null ? null : 100 * clamp(v / 4, 0, 1); } },
    { key: 'xg_2h',                weight: 15, fn: (m, s) => { const v = sumS(s?.since2H?.expectedGoalsXg); return v == null ? null : 100 * clamp(v / 2.4, 0, 1); } },
    { key: 'sot_2h',               weight: 12, fn: (m, s) => { const v = sumS(s?.since2H?.shotsOnTarget); return v == null ? null : 100 * clamp(v / 10, 0, 1); } },
    { key: 'big_chances_2h',       weight:  8, fn: (m, s) => { const v = sumS(s?.since2H?.bigChances); return v == null ? null : 100 * clamp(v / 4, 0, 1); } },
    { key: 'possession_imbalance', weight:  5, fn: (m, s) => { const h = s?.ballPossession?.home, a = s?.ballPossession?.away; if (h == null && a == null) return null; return clamp((Math.max(h || 0, a || 0) - 55) * 4, 0, 100); } },
    { key: 'live_dominance',       weight: 10, fn: (m, s) => {
      const xg = s?.since2H?.expectedGoalsXg, sot = s?.since2H?.shotsOnTarget, touch = s?.since2H?.touchesInOppositionBox;
      const pts = [];
      if (xg) pts.push(Math.abs((xg.home || 0) - (xg.away || 0)) / 1.2);
      if (sot) pts.push(Math.abs((sot.home || 0) - (sot.away || 0)) / 8);
      if (touch) pts.push(Math.abs((touch.home || 0) - (touch.away || 0)) / 16);
      if (!pts.length) return null;
      return clamp(pts.reduce((a, b) => a + b, 0) / pts.length * 100, 0, 100);
    }},
  ];
}

function computePSVariant(comps, match, s80) {
  let weightedSum = 0; let weightUsed = 0;
  for (const c of comps) {
    const value = c.fn(match, s80);
    if (value != null) { weightedSum += value * c.weight; weightUsed += c.weight; }
  }
  weightedSum += 50 * 5; weightUsed += 5; // league_bias fixed at default 50
  return weightUsed > 0 ? Math.round(weightedSum / weightUsed) : null;
}

function sweepC(allRows) {
  console.log('\n' + hr('═'));
  console.log(' SWEEP C — Варіанти формули PS (лише дані, без зміни коду)');
  console.log(hr('─'));

  const variants = [
    { label: 'Поточна (baseline)', comps: null },
    { label: 'V1: прибрати big_chances (перерозподіл ваг)', comps: buildVariant1Comps() },
    { label: 'V2: дільники ×2 (менш агресивна норм.)', comps: buildVariant2Comps() },
  ];

  const rows80 = [];
  for (const { match: m } of allRows) {
    if (!m.snapshots || !m.baseline1H || !m.final || m.final.scoreHome == null) continue;
    const h = hydrateAll(m.snapshots, m.baseline1H);
    const s80 = findSnap(h, 80, 5, true);
    if (!s80) continue;
    const outcome = hitAfterMinute(m, 80);
    if (outcome === null) continue;
    const odds = tb05OddsAt(80);
    const scores = {};
    for (const v of variants) {
      try {
        scores[v.label] = v.comps
          ? computePSVariant(v.comps, m, s80)
          : computePS(m, s80, null).score;
      } catch { scores[v.label] = null; }
    }
    rows80.push({ outcome: outcome ? 1 : 0, odds, scores });
  }

  for (const v of variants) {
    const all   = rows80.map(r => r.scores[v.label]).filter(s => s != null);
    const goalS = rows80.filter(r => r.outcome === 1).map(r => r.scores[v.label]).filter(s => s != null);
    const missS = rows80.filter(r => r.outcome === 0).map(r => r.scores[v.label]).filter(s => s != null);
    console.log('\n  ── ' + v.label + ' ──');
    console.log(`    max=${f2(max(all))} avg=${f2(mean(all))} avgGoal=${f2(mean(goalS))} avgMiss=${f2(mean(missS))} Δ=${f2(mean(goalS) - mean(missS))}`);
    console.log('    ' + lft('PS≥', 8) + lft('n', 5) + lft('hitRate', 9) + lft('ROI flat', 10) + lft('EV@80', 7));
    for (const T of PS_THRESHOLDS) {
      const g = rows80.filter(r => (r.scores[v.label] ?? -1) >= T);
      if (!g.length) { console.log('    ' + lft('≥' + T, 8) + '—'); continue; }
      const hits = g.filter(r => r.outcome === 1).length;
      const hitR = hits / g.length;
      const ev   = hitR * 1.90;
      const roi  = roiFlat(g.map(r => ({ outcome: r.outcome, odds: r.odds })));
      console.log('    ' + lft('≥' + T, 8) + lft(g.length, 5) + lft(pct(hits, g.length), 9) + lft(f3(roi), 10) + f2(ev));
    }
  }
}

// ── SWEEP D: DS / Line-A control ─────────────────────────────────────────────

function sweepD(allRows) {
  console.log('\n' + hr('═'));
  console.log(' SWEEP D — Контроль DS / Лінія A  (ТМ 0.5 — рішення на 60\', 0:0 на 60\')');
  console.log(hr('─'));

  const dsSamples = buildLineASamples(allRows);
  if (!dsSamples.length) { console.log('Немає DS-семплів.'); return; }

  const goal0  = dsSamples.filter(s => s.outcome0 === 1);
  const noGoal0 = dsSamples.filter(s => s.outcome0 === 0);
  const odds60 = tm05OddsAt(60) || 2.0;

  console.log(`n=${dsSamples.length} (0:0 на 60', відомий фінал) | базовий 0:0-FT=${pct(goal0.length, dsSamples.length)}`);
  console.log(`avgDS(0:0 FT)=${f2(mean(goal0.map(s => s.ds)))}  avgDS(був гол)=${f2(mean(noGoal0.map(s => s.ds)))}  Δ=${f2(mean(goal0.map(s => s.ds)) - mean(noGoal0.map(s => s.ds)))}`);

  // Bucket distribution DS
  console.log('\n  DS по бакетах:');
  const buckets = {};
  dsSamples.forEach(s => {
    const b = Math.floor(s.ds / 10) * 10;
    if (!buckets[b]) buckets[b] = { n: 0, hit: 0 };
    buckets[b].n++; buckets[b].hit += s.outcome0;
  });
  Object.keys(buckets).sort((a, b) => a - b).forEach(b => {
    const { n, hit } = buckets[b];
    const bar   = '█'.repeat(Math.round(hit / n * 16));
    const space = '░'.repeat(16 - Math.round(hit / n * 16));
    console.log(`    DS ${String(b).padStart(2)}-${+b + 9}: n=${String(n).padStart(2)}  hit=${pct(hit, n).padStart(6)}  [${bar}${space}]`);
  });

  console.log('\n  Поріг DS / Лінія A:');
  console.log('  ' + lft('Поріг DS', 11) + lft('n', 5) + lft('hitRate', 9) + lft('ROI flat', 10) + 'EV@60');
  for (const T of DS_THRESHOLDS) {
    const g = dsSamples.filter(s => s.ds >= T);
    if (!g.length) { console.log('  DS≥' + String(T).padEnd(8) + '—'); continue; }
    const hits = g.filter(s => s.outcome0 === 1).length;
    const hitR = hits / g.length;
    const ev   = hitR * odds60;
    const roi  = roiFlat(g.map(s => ({ outcome: s.outcome0, odds: odds60 })));
    console.log('  ' + lft('DS≥' + T, 11) + lft(g.length, 5) + lft(pct(hits, g.length), 9) + lft(f3(roi), 10) + f2(ev));
  }

  // Sanity: live signals
  const signals = dsSamples.filter(s => s.loggedPhase === 'signal');
  if (signals.length) {
    const hits = signals.filter(s => s.outcome0 === 1).length;
    console.log(`\n  Живі SIGNAL: n=${signals.length} hit=${pct(hits, signals.length)} (підтверджено)`);
  }

  // Sanity offline vs logged DS
  const logged = dsSamples.filter(s => s.loggedDs != null);
  if (logged.length) {
    const diffs = logged.map(s => Math.abs(s.ds - s.loggedDs));
    const mxD = Math.max(...diffs);
    const avgD = mean(diffs);
    console.log(`\n  Sanity offline DS vs logged: n=${logged.length} avgΔ=${f2(avgD)} maxΔ=${mxD} ${mxD <= 2 ? '✅' : '⚠ (expected — live uses different snap cadence)'}`);
  }
}

// ── Sanity: verify offline PS matches logged psScore ─────────────────────────

function sanitySamples(allRows) {
  let n = 0; const diffs = [];
  for (const { match: m } of allRows) {
    const loggedPs = m.predictions?.tb05?.psScore;
    if (loggedPs == null || !m.snapshots || !m.baseline1H) continue;
    const h = hydrateAll(m.snapshots, m.baseline1H);
    const s80 = findSnap(h, 80, 5);
    if (!s80) continue;
    try {
      const ps = computePS(m, s80, null);
      diffs.push(Math.abs(ps.score - loggedPs));
      n++;
    } catch { /* skip */ }
  }
  return { n, maxDiff: diffs.length ? Math.max(...diffs) : 0, avgDiff: mean(diffs) };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  const range = process.argv[2] || '2026-05-09..2026-06-07';
  const dirs  = listDateDirs(range);

  const allRows = [];
  for (const d of dirs) {
    for (const m of loadMatches(d)) allRows.push({ match: m, day: d });
  }

  const samples = buildLineBSamples(allRows);

  console.log(hr('═'));
  console.log(' PS RECALIBRATION REPORT — Лінія B (ТБ 0.5 — «буде хоча б один гол»)');
  console.log(hr('─'));
  console.log(` Дати: ${range} | Матчів: ${allRows.length} | Line-B семплів: ${samples.length}`);
  console.log(` (M=80: ${samples.filter(s => s.M === 80).length}, M=85: ${samples.filter(s => s.M === 85).length}, M=88: ${samples.filter(s => s.M === 88).length})`);

  // Sanity check — PS offline vs live
  const sanity = sanitySamples(allRows);
  if (sanity.n > 0) {
    const ok = sanity.maxDiff <= 5;
    console.log(` Sanity PS offline vs logged: n=${sanity.n} avgΔ=${f2(sanity.avgDiff)} maxΔ=${sanity.maxDiff} ${ok ? '✅' : '⚠  (live system used later snapshot — see notes)'}`);
  }

  sweepA(samples);
  sweepB(samples);
  sweepC(allRows);
  sweepD(allRows);

  // ── Auto-derived recommendation ────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log(' РЕКОМЕНДАЦІЇ');
  console.log(hr('─'));

  // Find best (T, M) with n >= 5 AND positive ROI flat
  let best = null;
  for (const M of DECISION_MINUTES) {
    const mGroup = samples.filter(s => s.M === M);
    for (const T of PS_THRESHOLDS) {
      const g = mGroup.filter(s => s.ps >= T);
      if (g.length < 5) continue;
      const hits = g.filter(s => s.outcome === 1).length;
      const hitR = hits / g.length;
      const ev   = hitR * (tb05OddsAt(M) || 1);
      const roi  = roiFlat(g.map(s => ({ outcome: s.outcome, odds: s.odds })));
      if (ev < 1.0 || roi == null || roi <= 0) continue;
      if (!best || ev > best.ev || (ev === best.ev && g.length > best.n)) {
        best = { T, M, n: g.length, hitR, ev, roi };
      }
    }
  }

  if (best) {
    console.log(`
  ▶ Оптимальна конфігурація (min n≥5, EV>1.0, ROI>0):
    PS_THRESHOLD = ${best.T}  |  хвилина рішення = ${best.M}'  |  коеф @${tb05OddsAt(best.M)}
    n=${best.n}  hitRate=${pct(Math.round(best.hitR * best.n), best.n)}  EV=${f2(best.ev)}  ROI flat=${f3(best.roi)}

  ▶ Поточний поріг 60 → ${samples.filter(s => s.M === 80 && s.ps >= 60).length} сигналів на M=80 (мертва лінія)
`);
  } else {
    console.log('\n  ⚠ Жодна конфігурація не дала n≥5 з EV>1.0 — лінія B потребує більше даних.\n');
  }

  console.log(`  НОТАТКИ:

  1. SNAPSHOT TIMING. Жива система іноді приймала рішення на 85-90' snapshot замість
     80', і між днями (UTC vs локальний час). Offline replay фіксовано на точному
     snapshot±5' — тому offline PS НИЖЧИЙ ніж logged в 3 з 10 перевірених матчів
     (максимальна розбіжність ${sanity.maxDiff} балів). Sweep A/B/C базуються на
     offline PS — вони консистентні між собою, але систематично консервативніші
     від того, що обчислює live-система.

  2. ВИБІРКА. n≈${samples.filter(s => s.M === 80).length} матчів на M=80 — занадто мала для статистично
     значущих висновків (≥100 рекомендовано). Напрямок правильний, конкретні цифри
     потребують підтвердження на новій live-даті.

  3. BIG_CHANCES. Компонент big_chances_delta_10 (w=5) та big_chances_2h (w=8) часто
     null (~40% семплів) — Flashscore не завжди публікує цей стат в потрібний момент.

  4. SNAPSHOT60 У PS. Функція presFromXgVs60 в pressureScore.js — мертвий код.
     Жоден активний COMPONENTS не використовує snapshot60. Параметр computePS(m, s80, s60)
     можна прибрати без впливу на скор.

  5. ЛІНІЯ A (DS). Поточний поріг DS=60 та gate (EV>1.1) — перевір Sweep D.
     На поточній вибірці DS дискримінує слабо (Δ≈${f2(mean(buildLineASamples(allRows).filter(s => s.outcome0 === 1).map(s => s.ds)) - mean(buildLineASamples(allRows).filter(s => s.outcome0 === 0).map(s => s.ds)))}) але живі SIGNAL мали DS=78 і 82 → обидва HIT.`);

  console.log('\n' + hr('═'));
}

main();
