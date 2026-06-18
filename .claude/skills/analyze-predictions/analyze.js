'use strict';

// Deterministic daily evaluator for the 1H ТМ/ТБ lines.
//
// Reads the persisted OUTPUT of a slate (tg-outbox + matches) and reports, per
// line: HIT/MISS, hit-rate, net units, ROI, break-even, p-calibration, the
// first-goal-minute distribution, selectivity (candidates → bets → EV rejects),
// AI-signal-vs-direction contradictions, and pattern flags. Engine-agnostic — it
// never inspects HOW a prediction was made, only the stored direction / p /
// odds / keySignals / htOutcome — so DS-based and AI (oneH) predictions score alike.
//
// Odds caveat: the pipeline records a HARDCODED odds table (ТМ 2.6/2.2, ТБ 2.1),
// which does NOT match the live market (observed ТМ 1.45–1.97, ТБ ~1.8 @26').
// Drop a data/logs/<date>/real-odds.json ({ "<matchId>": <odds>, ... }) to score
// on real market odds; without it the report labels ROI as a fictional UPPER BOUND.
//
// Usage:
//   node .claude/skills/analyze-predictions/analyze.js            # today
//   node .claude/skills/analyze-predictions/analyze.js 2026-06-16 # a specific day
//   node .claude/skills/analyze-predictions/analyze.js 2026-06-16 --json
//
// Stake model: flat 1 unit per signal. Profit on HIT = odds-1, on MISS = -1.

const fs = require('fs');
const path = require('path');
const { evaluateConsensus } = require('../../../src/prediction/signalConsensus');

const LINES = {
  tm05_1h: { label: 'ТМ (1H 0:0)', dir: 'under' },
  tb05_1h: { label: 'ТБ (гол у 1H)', dir: 'over' },
};

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveLogDir(date) {
  // Allow running from anywhere: locate the repo's data/logs relative to this file.
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  return path.join(repoRoot, 'data', 'logs', date);
}

// HIT is taken from the dispatched result when present (source of truth); else
// derived from htOutcome + direction (under wins iff dry; over wins iff !dry).
function resolveHit(entry, pred) {
  if (entry.result && typeof entry.result.hit === 'boolean') return entry.result.hit;
  const ht = pred && pred.htOutcome;
  if (!ht || typeof ht.dry !== 'boolean') return null;
  const dir = pred.direction || LINES[entry.decisionKey]?.dir;
  return dir === 'under' ? ht.dry : !ht.dry;
}

// Thin adapter over the canonical src/prediction/signalConsensus module.
// Preserves the {contradiction, why} return shape used by the rest of analyze.js.
function classifyContradiction(pred) {
  const v = evaluateConsensus({ direction: pred.direction, keySignals: pred.keySignals || [] });
  return { contradiction: v.verdict !== 'ok', why: v.reason };
}

function round(n, d = 1) {
  if (n == null || !Number.isFinite(n)) return null;
  return Number(n.toFixed(d));
}

function pct(n) {
  return n == null ? 'н/д' : `${round(n * 100, 1)}%`;
}

function analyze(date) {
  const dir = resolveLogDir(date);
  const outbox = loadJson(path.join(dir, 'tg-outbox.json'));
  const matches = loadJson(path.join(dir, 'matches.json'));
  const realOdds = loadJson(path.join(dir, 'real-odds.json')); // optional override
  if (!outbox) throw new Error(`Немає tg-outbox.json для ${date} (${dir})`);
  if (!matches) throw new Error(`Немає matches.json для ${date} (${dir})`);
  const oddsSource = realOdds ? 'real' : 'hardcoded';

  const bets = [];
  for (const e of outbox) {
    const m = matches[e.matchId] || {};
    const pred = (m.predictions && m.predictions[e.decisionKey]) || {};
    const snap = e.snapshot || {};
    const systemOdds = Number(snap.odds ?? pred.odds);
    const odds = realOdds && realOdds[e.matchId] != null ? Number(realOdds[e.matchId])
      : (Number.isFinite(systemOdds) ? systemOdds : null);
    const hit = resolveHit(e, pred);
    const ht = pred.htOutcome || {};
    const contra = classifyContradiction(pred);
    bets.push({
      id: e.matchId,
      key: e.decisionKey,
      line: LINES[e.decisionKey]?.label || e.decisionKey,
      dir: pred.direction || LINES[e.decisionKey]?.dir || null,
      league: [m.country, m.league].filter(Boolean).join('/'),
      teams: [m.homeTeam, m.awayTeam].filter(Boolean).join(' – '),
      minute: snap.minute ?? pred.requestedAtMinute ?? null,
      p: pred.p ?? snap.pNoGoal ?? snap.pGoal ?? null,
      confidence: pred.confidence ?? snap.confidence ?? null,
      data: pred.dataAvailability ?? null,
      odds: Number.isFinite(odds) ? odds : null,
      systemOdds: Number.isFinite(systemOdds) ? systemOdds : null,
      ev: pred.evGate?.ev ?? snap.ev ?? null,
      pAdj: pred.evGate?.pAdj ?? null,
      htScore: ht.score ?? null,
      dry: typeof ht.dry === 'boolean' ? ht.dry : null,
      firstGoalMinute: ht.firstGoalMinute ?? null,
      contradiction: contra.contradiction,
      contradictionWhy: contra.why,
      hit,
    });
  }

  // Per-line + overall aggregates.
  const groups = { __all__: [] };
  for (const b of bets) {
    (groups[b.key] = groups[b.key] || []).push(b);
    groups.__all__.push(b);
  }
  const agg = {};
  for (const [key, list] of Object.entries(groups)) {
    const settled = list.filter((b) => b.hit != null && b.odds != null);
    const hits = settled.filter((b) => b.hit);
    const stake = settled.length;
    const returns = hits.reduce((s, b) => s + b.odds, 0);
    const net = returns - stake;
    const avgOdds = stake ? settled.reduce((s, b) => s + b.odds, 0) / stake : null;
    agg[key] = {
      label: key === '__all__' ? 'УСЬОГО' : (LINES[key]?.label || key),
      n: list.length,
      settled: settled.length,
      hits: hits.length,
      misses: settled.length - hits.length,
      hr: stake ? hits.length / stake : null,
      net: round(net, 2),
      roi: stake ? net / stake : null,
      avgOdds: round(avgOdds, 2),
      breakEven: avgOdds ? 1 / avgOdds : null,
      pending: list.length - settled.length,
    };
  }

  // p-calibration buckets (predicted p vs realised hit-rate).
  const buckets = {};
  for (const b of bets) {
    if (b.p == null || b.hit == null) continue;
    const key = b.p.toFixed(2);
    (buckets[key] = buckets[key] || []).push(b.hit);
  }
  const calibration = Object.entries(buckets)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([p, hits]) => ({
      p: Number(p),
      n: hits.length,
      hr: hits.filter(Boolean).length / hits.length,
    }));

  // Contradiction scoreboard: did betting against the signals predict losses?
  const contra = bets.filter((b) => b.contradiction && b.hit != null);
  const consistent = bets.filter((b) => !b.contradiction && b.hit != null);
  const contraBoard = {
    contraN: contra.length,
    contraWon: contra.filter((b) => b.hit).length,
    consistentN: consistent.length,
    consistentWon: consistent.filter((b) => b.hit).length,
    cases: contra.map((b) => ({ id: b.id, teams: b.teams, line: b.line, hit: b.hit, why: b.contradictionWhy })),
  };

  // Selectivity: candidates tracked vs bet, classified by drop reason (priority).
  const betIds = new Set(bets.map((b) => b.id));
  let tracked = 0; let evRejected = 0; let goalBeforeDecision = 0; let otherSkip = 0;
  for (const id of Object.keys(matches)) {
    const m = matches[id];
    tracked += 1;
    if (betIds.has(id)) continue;
    const preds = m.predictions || {};
    const lines = [preds.tm05_1h, preds.tb05_1h].filter(Boolean);
    const phases = lines.map((p) => p.phase);
    if (lines.some((p) => p.evGate && p.evGate.pass === false)) evRejected += 1;
    else if (phases.includes('goal_during_decision') || m.tracking?.discardReason === 'goal_before_halftime') goalBeforeDecision += 1;
    else otherSkip += 1;
  }

  const fgm = bets.filter((b) => b.firstGoalMinute != null).map((b) => b.firstGoalMinute).sort((a, b) => a - b);

  // Pattern flags worth human attention.
  const flags = [];
  if (oddsSource === 'hardcoded') {
    flags.push("Коефіцієнти — захардкоджена таблиця системи (не ринкові). ROI — фіктивна ВЕРХНЯ МЕЖА; додай real-odds.json для реальної оцінки.");
  }
  const subHalf = bets.filter((b) => b.p != null && b.p < 0.5);
  if (subHalf.length > 3) {
    const won = subHalf.filter((b) => b.hit).length;
    flags.push(`Ставки проти власної ймовірності (p<0.5): ${subHalf.length} шт, виграло ${won} — модель системно ставить на суб-монетку, тримаючись лише на (фіктивному) кефі`);
  } else {
    for (const b of subHalf) {
      flags.push(`Ставка проти власної ймовірності: ${b.teams} (${b.line}) p=${b.p}${b.hit === false ? ' → програла' : b.hit ? ' → виграла' : ''}`);
    }
  }
  if (contraBoard.contraN) {
    const cw = contraBoard.contraWon; const cn = contraBoard.contraN;
    flags.push(`AI-сигнали ↔ напрям ставки: ${cn} ставок суперечили власним сигналам, виграло ${cw}/${cn}; узгоджені — ${contraBoard.consistentWon}/${contraBoard.consistentN}. Напрям не гейтиться консенсусом сигналів.`);
  }
  const lateMisses = bets.filter((b) => b.hit === false && b.dir === 'under' && b.firstGoalMinute != null && b.firstGoalMinute >= 43);
  if (lateMisses.length) {
    flags.push(`Пізні голи (≥43') вбили ${lateMisses.length} ТМ-сигнал(ів) — майже нефорекастимо: ${lateMisses.map((b) => `${b.teams}@${b.firstGoalMinute}'`).join(', ')}`);
  }
  for (const [key, a] of Object.entries(agg)) {
    if (key === '__all__') continue;
    if (a.hr != null && a.breakEven != null && a.settled >= 3 && a.hr < a.breakEven) {
      flags.push(`${a.label}: HR ${pct(a.hr)} нижче беззбитковості ${pct(a.breakEven)} — лінія в мінусі (ROI ${pct(a.roi)})`);
    }
  }
  const richBets = bets.filter((b) => b.data === 'rich');
  if (richBets.length && richBets.every((b) => b.hit === false)) {
    flags.push(`Усі сигнали на 'rich' даних програли (${richBets.length}) — перевірити, чи багаті дані не оманливі`);
  }
  for (let i = 1; i < calibration.length; i += 1) {
    const lo = calibration[i - 1]; const hi = calibration[i];
    if (hi.hr < lo.hr && lo.n >= 2 && hi.n >= 2) {
      flags.push(`Калібрування p під питанням: p=${hi.p} (HR ${pct(hi.hr)}) гірше за p=${lo.p} (HR ${pct(lo.hr)})`);
    }
  }

  return {
    date, oddsSource, bets, agg, calibration, contraBoard,
    selectivity: { tracked, bet: bets.length, evRejected, goalBeforeDecision, otherSkip },
    fgm, flags,
  };
}

function renderText(r) {
  const L = [];
  L.push(`\n═══ Оцінка прогнозів за ${r.date} ═══`);
  L.push(`коефіцієнти: ${r.oddsSource === 'real' ? 'РЕАЛЬНІ (real-odds.json)' : 'система (захардкоджені — ROI верхня межа)'}\n`);

  L.push('Per-bet:');
  L.push('ID       | лінія         | dir   | хв | p    | дані    | кеф  | HT   | гол | ⚠ | результат');
  for (const b of r.bets) {
    L.push([
      b.id.padEnd(8),
      (b.line || '').padEnd(13),
      (b.dir || '').padEnd(5),
      String(b.minute ?? '').padStart(2),
      String(b.p ?? '').padEnd(4),
      (b.data || '').padEnd(7),
      String(b.odds ?? '').padEnd(4),
      (b.htScore || '').padEnd(4),
      String(b.firstGoalMinute ?? '—').padStart(3),
      b.contradiction ? '✗' : ' ',
      b.hit == null ? 'PENDING' : b.hit ? '✅ HIT' : '❌ MISS',
    ].join(' | '));
  }

  L.push('\nПідсумок по лініях:');
  L.push('лінія        | n | HIT/MISS | HR     | сер.кеф | беззбитк | net u  | ROI');
  const order = [...Object.keys(r.agg).filter((k) => k !== '__all__'), '__all__'];
  for (const k of order) {
    const a = r.agg[k];
    if (!a || a.settled === 0) continue;
    L.push([
      a.label.padEnd(12),
      String(a.n).padStart(1),
      `${a.hits}/${a.misses}`.padEnd(8),
      pct(a.hr).padEnd(6),
      String(a.avgOdds ?? '').padEnd(7),
      pct(a.breakEven).padEnd(8),
      String(a.net ?? '').padStart(6),
      pct(a.roi),
    ].join(' | '));
  }

  if (r.calibration.length) {
    L.push('\nКалібрування (p → фактичний HR):');
    for (const c of r.calibration) L.push(`  p=${c.p}  n=${c.n}  HR=${pct(c.hr)}`);
  }

  const cb = r.contraBoard;
  if (cb.contraN || cb.consistentN) {
    L.push('\nAI-сигнали ↔ напрям ставки:');
    L.push(`  суперечать сигналам: ${cb.contraWon}/${cb.contraN} виграно | узгоджені: ${cb.consistentWon}/${cb.consistentN} виграно`);
    for (const c of cb.cases) L.push(`  ✗ ${c.teams} (${c.line}) ${c.hit ? 'виграла' : 'програла'} — ${c.why}`);
  }

  L.push('\nСелективність:');
  const s = r.selectivity;
  L.push(`  кандидатів відстежено: ${s.tracked} → ставок: ${s.bet}`);
  L.push(`  відсіяно EV-гейтом: ${s.evRejected}; гол до моменту рішення: ${s.goalBeforeDecision}; інше: ${s.otherSkip}`);

  if (r.fgm.length) L.push(`\nХвилини перших голів (до HT): ${r.fgm.join(', ')}`);

  if (r.flags.length) {
    L.push('\n⚠️  Прапорці для уваги:');
    for (const f of r.flags) L.push(`  • ${f}`);
  } else {
    L.push('\n✅ Аномалій не виявлено.');
  }
  L.push('');
  return L.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const date = dateArg || new Date().toISOString().slice(0, 10);
  try {
    const result = analyze(date);
    process.stdout.write(asJson ? `${JSON.stringify(result, null, 2)}\n` : renderText(result));
  } catch (err) {
    process.stderr.write(`Помилка: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { analyze, renderText, classifyContradiction };
