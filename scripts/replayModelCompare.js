/**
 * Replay baseline vs tuned windowed model на збережених рядках логів.
 * Використання: node scripts/replayModelCompare.js [--days N] [--strict-tuned] [--no-gates] [YYYY-MM-DD ...]
 * --strict-tuned — третій стовпчик: агресивні пороги (на малій вибірці знижували hit-rate).
 * --no-gates — без liveModelGates (лише пороги моделі).
 * За замовчуванням: останні 7 днів з data/logs.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const baseline = require('../src/replay/baselineParams');
const {
  buildFeaturesFromLogRow,
  inferPrevBet,
  actualTotalGoals,
  hitForBet,
  listLogDates,
  lastResolvedDecisionRows,
} = require('../src/replay/logReplay');
const { scoreMatchWindowed } = require('../src/pipeline/modelScoring');
const { decideWindowedLiveBet, THRESHOLDS, PGOAL_MAX_FOR_UNDER_60_70_DEFAULT, TIE_BREAK_MIN_MARGIN_DEFAULT } = require('../src/pipeline/windowedLiveDecision');
const {
  LIVE_QUALITY_GATES_ENABLED,
  LIVE_BET_MIN_PRIMARY_METRICS,
  LIVE_MIN_DECISION_EDGE,
  LIVE_70_80_TIE_BREAK_MARGIN,
} = require('../src/helpers/constants');

const LOGS_ROOT = path.join(__dirname, '..', 'data', 'logs');

/** Експеримент: жорсткіші пороги + сильніший хвилинний зсув (перевірено replay — часто гірший hit-rate при n≈37). */
const STRICT_TUNED = {
  windowMinuteAdj: {
    '60-69': -0.05,
    '70-75': 0,
    '76-80': 0.03,
    '81-84': 0.05,
    '85+': 0.09,
  },
  thresholds: {
    '60-70': { minPDryUnder: 0.56, minPGoalOver: 1 },
    '70-80': { minPDryUnder: 0.56, minPGoalOver: 0.62 },
    '80-90+': { minPDryUnder: 1, minPGoalOver: 0.57 },
  },
  pGoalMaxForUnder60_70: 0.44,
  tieBreakMinMargin: 0.08,
};

function parseArgs() {
  const argv = process.argv.slice(2);
  let days = 7;
  const strictTuned = argv.includes('--strict-tuned');
  const noGates = argv.includes('--no-gates');
  const dates = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days' && argv[i + 1]) {
      days = Math.max(1, parseInt(argv[i + 1], 10) || 7);
      i++;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(argv[i])) {
      dates.push(argv[i]);
    }
  }
  return { days, dates, strictTuned, noGates };
}

function pickDates(opts) {
  if (opts.dates.length > 0) return opts.dates.sort();
  const all = listLogDates(LOGS_ROOT);
  return all.slice(-opts.days);
}

function emptyAgg() {
  return {
    withBet: 0,
    hits: 0,
    misses: 0,
    skips: 0,
    byWindow: {},
  };
}

function bump(agg, decision, totalGoals) {
  if (decision.bet === 'SKIP' || !decision.bet) {
    agg.skips++;
    return;
  }
  agg.withBet++;
  const h = hitForBet(decision.bet, totalGoals);
  if (h === true) agg.hits++;
  else if (h === false) agg.misses++;
  const tw = decision.timeWindow || '—';
  if (!agg.byWindow[tw]) agg.byWindow[tw] = { withBet: 0, hits: 0, misses: 0 };
  if (decision.bet !== 'SKIP') {
    agg.byWindow[tw].withBet++;
    if (h === true) agg.byWindow[tw].hits++;
    else if (h === false) agg.byWindow[tw].misses++;
  }
}

function rate(h, n) {
  if (!n) return '—';
  return `${((h / n) * 100).toFixed(1)}%`;
}

function printAgg(label, agg) {
  const n = agg.hits + agg.misses;
  console.log(`\n${label}`);
  console.log(`  Ставок (не SKIP): ${agg.withBet} | ✅ ${agg.hits} | ❌ ${agg.misses} | hit-rate: ${rate(agg.hits, n)}`);
  console.log(`  SKIP: ${agg.skips}`);
  const tws = Object.keys(agg.byWindow).sort();
  if (tws.length) {
    console.log('  По вікнах:');
    for (const tw of tws) {
      const w = agg.byWindow[tw];
      const nn = w.hits + w.misses;
      console.log(`    ${tw}: ставок ${w.withBet}, hit ${rate(w.hits, nn)} (${w.hits}/${nn})`);
    }
  }
}

function main() {
  const opts = parseArgs();
  const dates = pickDates(opts);
  const runStrict = opts.strictTuned;
  const skipGates = opts.noGates;
  if (dates.length === 0) {
    console.log('Немає папок дат у data/logs');
    process.exit(1);
  }

  const eligible = lastResolvedDecisionRows(LOGS_ROOT, dates);

  const baseAgg = emptyAgg();
  const tunedAgg = emptyAgg();
  const strictAgg = runStrict ? emptyAgg() : null;
  const loggedAgg = emptyAgg();
  let processed = 0;
  let skippedNoFeatures = 0;
  let disagree = 0;

  for (const row of eligible) {
    const features = buildFeaturesFromLogRow(row);
    if (!features.allowDecision) {
      skippedNoFeatures++;
      continue;
    }
    processed++;
    const prevBet = inferPrevBet(row);
    const goals = actualTotalGoals(row);

    const scoredB = scoreMatchWindowed(features, { windowMinuteAdj: baseline.WINDOW_MINUTE_ADJ });
    const decB = decideWindowedLiveBet(scoredB, features, prevBet, {
      thresholds: baseline.THRESHOLDS,
      pGoalMaxForUnder60_70: baseline.pGoalMaxForUnder60_70,
      tieBreakMinMargin: baseline.tieBreakMinMargin,
      skipQualityGates: skipGates,
    });

    const scoredN = scoreMatchWindowed(features, {});
    const decN = decideWindowedLiveBet(scoredN, features, prevBet, { skipQualityGates: skipGates });

    bump(baseAgg, decB, goals);
    bump(tunedAgg, decN, goals);

    if (runStrict) {
      const scoredS = scoreMatchWindowed(features, { windowMinuteAdj: STRICT_TUNED.windowMinuteAdj });
      const decS = decideWindowedLiveBet(scoredS, features, prevBet, {
        thresholds: STRICT_TUNED.thresholds,
        pGoalMaxForUnder60_70: STRICT_TUNED.pGoalMaxForUnder60_70,
        tieBreakMinMargin: STRICT_TUNED.tieBreakMinMargin,
        skipQualityGates: skipGates,
      });
      bump(strictAgg, decS, goals);
    }

    if (decB.bet !== decN.bet) disagree++;

    const logPred = row.prediction?.bet;
    if (logPred && logPred !== 'SKIP') {
      const fake = { bet: logPred, timeWindow: row.prediction?.timeWindow || '—' };
      bump(loggedAgg, fake, goals);
    }
  }

  console.log('=== Replay моделі на логах (останній рядок на matchId, decision_made + фінал) ===');
  console.log(`Дні: ${dates.join(', ')}`);
  console.log(`Унікальних матчів з фіналом і decision_made: ${eligible.length}`);
  console.log(`З allowDecision (replay): ${processed} (без метрик: ${skippedNoFeatures})`);
  console.log(`Розбіжність baseline vs tuned (поле bet): ${disagree} матчів`);
  console.log(
    `Гейти: ${skipGates ? 'вимкнено (--no-gates)' : `увімкнено (primary≥${LIVE_BET_MIN_PRIMARY_METRICS}, edge≥${LIVE_MIN_DECISION_EDGE}, 70–80 tie env=${LIVE_70_80_TIE_BREAK_MARGIN})`}`
  );
  if (!skipGates && !LIVE_QUALITY_GATES_ENABLED) console.log('  LIVE_QUALITY_GATES_ENABLED=0 у .env — гейти вимкнені глобально.');

  console.log('\n--- Production (зараз) — ті самі числа, що й baseline; зміни = API opts для експериментів ---');
  console.log(`  THRESHOLDS 60-70: pDry≥${THRESHOLDS['60-70'].minPDryUnder}, ТМ якщо pGoal≤${PGOAL_MAX_FOR_UNDER_60_70_DEFAULT}`);
  console.log(`  THRESHOLDS 70-80: pGoal≥${THRESHOLDS['70-80'].minPGoalOver}, pDry≥${THRESHOLDS['70-80'].minPDryUnder}, tie-break ${TIE_BREAK_MIN_MARGIN_DEFAULT || 'вимкнено (0)'}`);
  console.log(`  THRESHOLDS 80+: pGoal≥${THRESHOLDS['80-90+'].minPGoalOver} (+бонус фаворита)`);
  console.log('  Підказка: жорсткіші пороги на малій вибірці знижували hit-rate; див. baselineParams + scoringOpts у replay.');

  printAgg('Baseline (знімок до змін)', baseAgg);
  printAgg('Production (поточний код, збігається з baseline при тих самих константах)', tunedAgg);
  if (runStrict && strictAgg) {
    printAgg('Експеримент --strict-tuned (жорсткі пороги; не рекомендовано без більшої вибірки)', strictAgg);
  }
  if (loggedAgg.withBet > 0) {
    printAgg('Записано в лозі (ост. prediction, для орієнтиру)', loggedAgg);
  }
}

main();
