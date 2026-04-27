require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('../src/browser');
const { collectFinishedMatches } = require('../src/providers/flashscoreMobileUa/historicalSource');
const { parseMatchDetail, checkStatsAvailability, analyzeGoalTimeline, computeImpliedProbabilities } = require('../src/providers/flashscoreMobileUa/matchDetailSource');
const { resolveDesktopUrl, scrapeDesktopStats } = require('../src/scrapeDesktopStats');
const { buildFeatures } = require('../src/pipeline/featureBuilder');
const { evaluateLiveModelV3 } = require('../src/pipeline/liveModelV3');
const { scrapeMatchFormAndH2h } = require('../src/scrapeMatchFormAndH2h');
const { classifyStats } = require('../src/historical/statsClassifier');
const { exportToExcel } = require('../src/historical/excelExporter');
const {
  USER_AGENT,
  LIVE_DECISION_WINDOW_START_MINUTE,
  LIVE_WINDOW_END_60_70,
  LIVE_WINDOW_END_70_80,
} = require('../src/helpers/constants');
const { dayjs, dateKeyLocal } = require('../src/helpers/date');

/** Хвилини симуляції — середини вікон 60-70 і 70-80. */
const SIM_MINUTES = [
  Math.round((LIVE_DECISION_WINDOW_START_MINUTE + LIVE_WINDOW_END_60_70) / 2),
  Math.round((LIVE_WINDOW_END_60_70 + LIVE_WINDOW_END_70_80) / 2),
];

/** Ключі stats що масштабуємо для синтетичних знімків. */
const SCALABLE_KEYS = [
  'shotsOnTarget', 'expectedGoalsXg', 'touchesInOppositionBox', 'bigChances',
  'cornerKicks', 'goalkeeperSaves', 'shotsInsideTheBox', 'xgOnTargetXgot',
  'passesInFinalThird', 'expectedAssistsXa', 'totalShots', 'crosses',
  'fouls', 'freeKicks', 'shotsOffTarget', 'shotsOutsideTheBox',
];

/**
 * Лінійно масштабує final 2H stats на момент simMinute.
 * 2H триває 45 хв (45-90'); ratio = (simMinute-45)/45.
 * Масштабуємо sum/home/away для кожного ключа.
 */
function scaleStatsBlockForRatio(statsBlock, ratio) {
  if (!statsBlock) return null;
  const r = Math.max(0.05, Math.min(1, ratio));
  const out = { ...statsBlock };
  for (const k of SCALABLE_KEYS) {
    const orig = statsBlock[k];
    if (!orig || typeof orig !== 'object') continue;
    const scaleNum = (n) => (n == null ? null : Number((Number(n) * r).toFixed(3)));
    const sum = scaleNum(orig.sum);
    const home = scaleNum(orig.home);
    const away = scaleNum(orig.away);
    out[k] = { ...orig, sum, home, away };
  }
  return out;
}

/**
 * Будує синтетичну історію з 2 знімків (за simMinute-5 і simMinute),
 * лінійно масштабуючи final 2H raw на пропорції 2H-часу.
 */
function buildSynthSnapshots(rawFinal2H, simMinute) {
  if (!rawFinal2H) return [];
  const ratioCur = Math.max(0.05, Math.min(1, (simMinute - 45) / 45));
  const ratioPrev = Math.max(0.05, Math.min(1, (simMinute - 5 - 45) / 45));
  const scaleRaw = (raw, r) => {
    const o = {};
    for (const k of SCALABLE_KEYS) {
      const v = raw[k];
      if (v == null) { o[k] = null; continue; }
      const n = Number(v);
      o[k] = Number.isFinite(n) ? Number((n * r).toFixed(4)) : null;
    }
    return o;
  };
  return [
    {
      matchMinute: simMinute - 5,
      score: { home: '0', away: '0' },
      raw2H: scaleRaw(rawFinal2H, ratioPrev),
      homeRedCards: 0,
      awayRedCards: 0,
    },
    {
      matchMinute: simMinute,
      score: { home: '0', away: '0' },
      raw2H: scaleRaw(rawFinal2H, ratioCur),
      homeRedCards: 0,
      awayRedCards: 0,
    },
  ];
}

function computeTrajectoryFromSnaps(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return { deltas: null, deltaMatchMinutes: null, snapshotCount: snapshots.length, prevMinute: null };
  }
  const prev = snapshots[snapshots.length - 2];
  const cur = snapshots[snapshots.length - 1];
  const deltas = {};
  for (const k of SCALABLE_KEYS) {
    const a = prev.raw2H?.[k];
    const b = cur.raw2H?.[k];
    deltas[k] = (a != null && b != null && Number.isFinite(a) && Number.isFinite(b))
      ? Number((b - a).toFixed(4)) : null;
  }
  return {
    deltas,
    deltaMatchMinutes: Math.max(0, cur.matchMinute - prev.matchMinute),
    snapshotCount: snapshots.length,
    prevMinute: prev.matchMinute,
  };
}

/**
 * Симуляція v3-моделі на конкретній хвилині simMinute (припускаючи 0:0).
 * statsResult — final stats (overall + secondHalf від scrapeDesktopStats).
 */
function simulateV3AtMinute({ simMinute, m, statsResult, odds1X2, preMatchContext }) {
  const ratio2H = Math.max(0.05, Math.min(1, (simMinute - 45) / 45));
  const scaledSecondHalf = scaleStatsBlockForRatio(statsResult.secondHalf, ratio2H);
  const scaledStatsResult = { ...statsResult, secondHalf: scaledSecondHalf };

  const simMatch = {
    id: m.id,
    league: m.league,
    home: m.home,
    away: m.away,
    minute: simMinute,
    score: { home: '0', away: '0' },
    matchDetailsUrl: m.matchDetailsUrl,
  };

  const featuresFull = buildFeatures({ ...simMatch, minute: 90 }, statsResult);
  const featuresScaled = buildFeatures(simMatch, scaledStatsResult);

  const synthHistory = buildSynthSnapshots(featuresFull.raw2H, simMinute);
  const liveTrajectory = computeTrajectoryFromSnaps(synthHistory);
  featuresScaled.liveTrajectory = liveTrajectory;
  featuresScaled.odds1X2 = odds1X2 || null;
  featuresScaled.redCards = { homeRedCards: 0, awayRedCards: 0 };

  const { modelV2, decision, scoredSummary } = evaluateLiveModelV3({
    match: simMatch,
    features: featuresScaled,
    odds1X2: odds1X2 || null,
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    history: synthHistory,
    secondHalfSides: scaledSecondHalf || {},
    previousState: null,
    prevBet: null,
    liveTrajectory,
    preMatchContext: preMatchContext || null,
    dryAlertActive: false,
  });

  return {
    simMinute,
    timeWindow: decision.timeWindow,
    bet: decision.bet,
    confidence: decision.confidence,
    pGoal: decision.pGoal,
    pDry: decision.pDry,
    edge: decision.edge,
    signalQuality: decision.signalQuality,
    signalEligible: decision.signalEligible,
    currentState: modelV2.currentState,
    snapshotsUsed: synthHistory.length,
    reason: decision.reason,
    filtersApplied: decision.filtersApplied,
    kellyStakePct: decision.kellyStakePct,
    assumedOdds: decision.assumedOdds,
  };
}

const DATA_BASE = path.join(__dirname, '..', 'data', 'historical');
const DIRS = { raw: 'raw', filtered: 'filtered', analyzed: 'analyzed', reports: 'reports' };

/** Критерії відбору для historical-аналізу (узгоджено з планом). */
const SELECTION_CRITERIA = {
  finalScoresAllowed: ['0:0', '1:0', '0:1', '1:1', '2:0', '0:2'],
  noGoalBeforeMinute: 60,
  goalMinutesHow:
    'Хвилини голів зчитуються з мобільної сторінки матчу m.flashscore.ua/match/{id}/ (події/інциденти). Це потрібно, щоб перевірити: не було голу до 60-ї хв.',
  statsHow:
    'Спочатку перевірка наявності статистики на мобільній (?t=stats), далі повний збір overall + 2-й тайм на десктопі — як у live-скрапері.',
  modelHow:
    'Прогноз v3: evaluateLiveModelV3 на середині кожного вікна (60-70 і 70-80) з рахунком 0:0. Синтетичні 2 знімки з лінійним масштабуванням final 2H stats. preMatchContext (form/H2H) — лише з прапором --with-form.',
};

function ensureDir(sub) {
  const dir = path.join(DATA_BASE, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveJSON(sub, filename, data) {
  const dir = ensureDir(sub);
  const fp = path.join(dir, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
  return fp;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let days = 7;
  let fromDay = null;
  let toDay = null;
  let withForm = false;
  let sample = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) days = parseInt(args[i + 1], 10);
    if (args[i] === '--from-day' && args[i + 1]) fromDay = parseInt(args[i + 1], 10);
    if (args[i] === '--to-day' && args[i + 1]) toDay = parseInt(args[i + 1], 10);
    if (args[i] === '--with-form') withForm = true;
    if (args[i] === '--sample' && args[i + 1]) sample = parseInt(args[i + 1], 10);
  }
  if (fromDay != null || toDay != null) {
    const f = Number.isFinite(fromDay) ? fromDay : 1;
    const t = Number.isFinite(toDay) ? toDay : f;
    const lo = Math.max(1, Math.min(Math.min(f, t), 30));
    const hi = Math.max(1, Math.min(Math.max(f, t), 30));
    return { dayStart: lo, dayEnd: hi, withForm, sample };
  }
  const n = Math.max(1, Math.min(days, 14));
  return { dayStart: 1, dayEnd: n, withForm, sample };
}

function toFilteredRow(entry) {
  return {
    matchId: entry.matchId,
    date: entry.date,
    country: entry.country,
    leagueName: entry.leagueName,
    league: entry.league,
    home: entry.home,
    away: entry.away,
    finalScore: {
      home: entry.finalScore.home,
      away: entry.finalScore.away,
      goalMinutes: entry.finalScore.goalMinutes,
      goalEvents: entry.finalScore.goalEvents,
    },
    firstGoalMinute: entry.firstGoalMinute,
    wasZeroZeroAt60: entry.wasZeroZeroAt60,
    hasLateGoal: entry.hasLateGoal,
    goalMinutesReliable: entry.goalMinutesReliable,
    odds1X2: entry.odds1X2,
  };
}

async function processDay(browser, dayOffset, dateStr, opts = {}) {
  const { withForm = false, sample = null } = opts;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Day ${dayOffset} (${dateStr})`);
  console.log('='.repeat(60));

  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  let allMatches = [];
  let filteredByScore = [];

  try {
    const { allMatches: raw, filtered, stats } = await collectFinishedMatches(page, dayOffset);
    allMatches = raw;
    filteredByScore = filtered;
    console.log(`  Total: ${stats.total} | Score filter: ${stats.afterScoreFilter} | Scores: ${JSON.stringify(stats.byScore)}`);
  } catch (e) {
    console.log(`  ERROR fetching day ${dayOffset}: ${e.message}`);
    await page.close();
    return {
      analyzed: [],
      skippedEarly: 0,
      skippedGoalMinutes: 0,
      skippedNoStatsMobile: 0,
      skippedResolve: 0,
      skippedNoStatsDesktop: 0,
      errors: 0,
    };
  }

  saveJSON(DIRS.raw, `${dateStr}.json`, allMatches);

  if (Number.isFinite(sample) && sample > 0 && filteredByScore.length > sample) {
    const shuffled = [...filteredByScore];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    filteredByScore = shuffled.slice(0, sample);
    console.log(`  Sample: case=${sample} → working with ${filteredByScore.length}`);
  }

  const analyzed = [];
  let skippedEarly = 0;
  let skippedGoalMinutes = 0;
  let skippedNoStatsMobile = 0;
  let skippedResolve = 0;
  let skippedNoStatsDesktop = 0;
  let errors = 0;

  for (let i = 0; i < filteredByScore.length; i++) {
    const m = filteredByScore[i];
    const tag = `[${i + 1}/${filteredByScore.length}] ${m.home} - ${m.away} (${m.scoreKey})`;
    process.stdout.write(`  ${tag} ... `);

    try {
      const detail = await parseMatchDetail(page, m.matchDetailsUrl, m.finalScore);
      const goals = detail.goals || [];
      const timeline = analyzeGoalTimeline(goals, m.finalScore);

      if (timeline.hasEarlyGoal) {
        skippedEarly++;
        console.log(`SKIP (гол до 60': перший на ${timeline.firstGoalMinute}')`);
        continue;
      }
      if (timeline.timelineIncomplete && (m.finalScore.home + m.finalScore.away) > 0) {
        skippedGoalMinutes++;
        console.log('SKIP (немає надійних хвилин голів — не можемо підтвердити «без голу до 60»)');
        continue;
      }

      const hasStats = await checkStatsAvailability(page, m.matchDetailsUrl);
      if (!hasStats) {
        skippedNoStatsMobile++;
        console.log('SKIP (немає статистики на мобільній)');
        continue;
      }

      const statPage = await browser.newPage();
      await statPage.setUserAgent(USER_AGENT);

      try {
        const { desktopUrl, resolved } = await resolveDesktopUrl(statPage, m.id);
        if (!resolved || !desktopUrl) {
          skippedResolve++;
          console.log('SKIP (не вдалося відкрити десктопний URL матчу)');
          continue;
        }

        const statsResult = await scrapeDesktopStats(statPage, desktopUrl, m.id);

        if (statsResult.statsStatus === 'unavailable') {
          skippedNoStatsDesktop++;
          console.log('SKIP (немає статистики на десктопі)');
          continue;
        }

        const totalGoals = m.finalScore.home + m.finalScore.away;
        const firstGoalMin = timeline.firstGoalMinute;

        let preMatchContext = null;
        if (withForm) {
          try {
            preMatchContext = await scrapeMatchFormAndH2h(statPage, m.id, {
              home: m.home,
              away: m.away,
            });
          } catch (e) {
            preMatchContext = null;
          }
        }

        const simulations = [];
        for (const simMinute of SIM_MINUTES) {
          if (firstGoalMin != null && firstGoalMin <= simMinute) continue;
          const sim = simulateV3AtMinute({
            simMinute,
            m,
            statsResult,
            odds1X2: detail.odds1X2,
            preMatchContext,
          });
          let hit = null;
          if (sim.bet === 'OVER_0_5') hit = totalGoals > 0;
          else if (sim.bet === 'UNDER_0_5') hit = totalGoals === 0;
          simulations.push({
            ...sim,
            hit,
            label: hit === true ? 'HIT' : hit === false ? 'MISS' : 'SKIP',
          });
        }

        const primarySim = simulations.find((s) => s.bet !== 'SKIP') || simulations[0] || null;

        const entry = {
          matchId: m.id,
          date: dateStr,
          country: m.country,
          leagueName: m.leagueName,
          league: m.league,
          home: m.home,
          away: m.away,
          finalScore: {
            home: m.finalScore.home,
            away: m.finalScore.away,
            goalMinutes: timeline.goalMinutes,
            goalEvents: goals.map((g) => ({
              minute: g.minute,
              team: g.team,
              type: g.type,
              scoreAfter: g.score,
            })),
          },
          scoreCategory: m.scoreKey,
          mobileUrl: m.matchDetailsUrl,
          desktopUrl,
          kickoffTime: m.kickoffTime,
          firstGoalMinute: firstGoalMin,
          hasEarlyGoal: timeline.hasEarlyGoal,
          hasLateGoal: timeline.hasLateGoal,
          wasZeroZeroAt60: timeline.wasZeroZeroAt60,
          goalMinutesReliable: !timeline.timelineIncomplete,
          odds1X2: detail.odds1X2,
          impliedProb: computeImpliedProbabilities(detail.odds1X2),
          stats: {
            overall: statsResult.overall,
            secondHalf: statsResult.secondHalf,
            statsStatus: statsResult.statsStatus,
          },
          statsClassification: classifyStats(statsResult),
          modelPrediction: primarySim
            ? {
                pGoal: primarySim.pGoal,
                pDry: primarySim.pDry,
                bet: primarySim.bet,
                confidence: primarySim.confidence,
                edge: primarySim.edge,
                reason: primarySim.reason,
                signalQuality: primarySim.signalQuality,
                currentState: primarySim.currentState,
                simulation: {
                  modelVersion: 'v3',
                  primaryMinute: primarySim.simMinute,
                  formH2hUsed: Boolean(preMatchContext),
                  note:
                    'v3-симуляція: evaluateLiveModelV3 на середині кожного вікна (60-70 і 70-80). Рахунок 0:0 (матчі відібрано без голу до 60). 2 синтетичних знімка з лінійним масштабуванням final 2H stats. liveTrajectory обчислено з дельт. preMatchContext — лише якщо запущено з --with-form. HIT/MISS — фактичний підсумок матчу (total goals).',
                },
              }
            : null,
          v3Simulations: simulations,
          result: {
            totalGoals,
            goalsAfter60: timeline.goalsAfter60,
            primaryBet: primarySim?.bet ?? 'SKIP',
            primaryHit: primarySim?.hit ?? null,
            primaryLabel: primarySim?.label ?? 'SKIP',
          },
          pipeline: 'analyzed',
        };

        const summaryLine = simulations
          .map((s) => `${s.simMinute}'→${s.bet}${s.label !== 'SKIP' ? `(${s.label})` : ''}`)
          .join(' | ');
        console.log(summaryLine || 'no sims');
        analyzed.push(entry);
      } finally {
        await statPage.close();
      }
    } catch (e) {
      errors++;
      console.log(`ERROR: ${e.message}`);
    }
  }

  await page.close();

  saveJSON(DIRS.filtered, `${dateStr}.json`, {
    meta: { date: dateStr, selectionCriteria: SELECTION_CRITERIA },
    matches: analyzed.map(toFilteredRow),
  });
  saveJSON(DIRS.analyzed, `${dateStr}.json`, {
    meta: { date: dateStr, selectionCriteria: SELECTION_CRITERIA },
    matches: analyzed,
  });

  const allSims = analyzed.flatMap((r) => r.v3Simulations || []);
  const byWindow = {};
  for (const s of allSims) {
    if (s.bet === 'SKIP') continue;
    const w = s.timeWindow || 'unknown';
    if (!byWindow[w]) byWindow[w] = { hits: 0, misses: 0 };
    if (s.label === 'HIT') byWindow[w].hits++;
    else if (s.label === 'MISS') byWindow[w].misses++;
  }
  const winLine = Object.entries(byWindow)
    .map(([w, v]) => `${w}: ${v.hits}H/${v.misses}M`)
    .join(' | ') || 'no signals';

  console.log(
    `\n  Summary ${dateStr}: analyzed=${analyzed.length} | пропуски: гол_до_60=${skippedEarly} немає_хвилин_голів=${skippedGoalMinutes} немає_стати_моб=${skippedNoStatsMobile} resolve=${skippedResolve} немає_стати_деск=${skippedNoStatsDesktop} помилки=${errors} | ${winLine}`
  );

  return {
    analyzed,
    skippedEarly,
    skippedGoalMinutes,
    skippedNoStatsMobile,
    skippedResolve,
    skippedNoStatsDesktop,
    errors,
  };
}

(async () => {
  const { dayStart, dayEnd, withForm, sample } = parseArgs();
  const dayCount = dayEnd - dayStart + 1;
  console.log(
    `Historical scraper (v3): зсуви -${dayStart} … -${dayEnd} (${dayCount} дн.)`
  );
  console.log(`Output: ${DATA_BASE}`);
  console.log(`Sim minutes: ${SIM_MINUTES.join(', ')}'`);
  console.log(`Form/H2H: ${withForm ? 'enabled' : 'disabled (use --with-form to enable)'}`);
  console.log(`Sample per day: ${Number.isFinite(sample) && sample > 0 ? sample : 'none (all matches)'}`);

  const browser = await launchBrowser();
  const allAnalyzed = [];
  const dateRange = { from: null, to: null };

  try {
    for (let d = dayStart; d <= dayEnd; d++) {
      const dateStr = dateKeyLocal(dayjs().subtract(d, 'day'));
      if (!dateRange.from || dateStr < dateRange.from) dateRange.from = dateStr;
      if (!dateRange.to || dateStr > dateRange.to) dateRange.to = dateStr;

      const { analyzed } = await processDay(browser, -d, dateStr, { withForm, sample });
      allAnalyzed.push(...analyzed);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('GRAND TOTAL (v3)');
  console.log('='.repeat(60));

  const allSims = allAnalyzed.flatMap((r) => r.v3Simulations || []);
  const byWindowBet = {};
  for (const s of allSims) {
    if (s.bet === 'SKIP') continue;
    const key = `${s.timeWindow}|${s.bet}`;
    if (!byWindowBet[key]) byWindowBet[key] = { hits: 0, misses: 0, total: 0 };
    byWindowBet[key].total++;
    if (s.label === 'HIT') byWindowBet[key].hits++;
    else if (s.label === 'MISS') byWindowBet[key].misses++;
  }

  console.log(`Days: -${dayStart} … -${dayEnd} (${dayCount})`);
  console.log(`Matches analyzed: ${allAnalyzed.length}`);
  console.log(`Total signals: ${allSims.filter((s) => s.bet !== 'SKIP').length}`);
  console.log(`\nBy window × bet:`);
  for (const [key, v] of Object.entries(byWindowBet)) {
    const hr = v.total > 0 ? ((v.hits / v.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${key}: ${v.hits}H/${v.misses}M (HR ${hr}%, n=${v.total})`);
  }

  if (allAnalyzed.length > 0) {
    const excelPath = path.join(ensureDir(DIRS.reports), `report_${dateRange.from}_${dateRange.to}.xlsx`);
    await exportToExcel(allAnalyzed, excelPath);
    console.log(`\nExcel: ${excelPath}`);
  }

  console.log('\nDone.');
})();
