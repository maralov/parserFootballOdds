require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('../src/browser');
const { collectFinishedMatches } = require('../src/providers/flashscoreMobileUa/historicalSource');
const { parseMatchDetail, checkStatsAvailability, analyzeGoalTimeline, computeImpliedProbabilities } = require('../src/providers/flashscoreMobileUa/matchDetailSource');
const { resolveDesktopUrl, scrapeDesktopStats } = require('../src/scrapeDesktopStats');
const { buildFeatures } = require('../src/pipeline/featureBuilder');
const { scoreMatch } = require('../src/pipeline/modelScoring');
const { decideBet } = require('../src/pipeline/betDecision');
const { classifyStats } = require('../src/historical/statsClassifier');
const { exportToExcel } = require('../src/historical/excelExporter');
const { USER_AGENT, LIVE_MIN_CANDIDATE_MINUTE } = require('../src/helpers/constants');
const { dayjs, dateKeyLocal } = require('../src/helpers/date');

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
    'Прогноз: той самий ланцюжок buildFeatures → scoreMatch → decideBet, з хвилиною LIVE_MIN_CANDIDATE_MINUTE і рахунком 0:0 для порівняння з поточною моделлю.',
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
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) days = parseInt(args[i + 1], 10);
    if (args[i] === '--from-day' && args[i + 1]) fromDay = parseInt(args[i + 1], 10);
    if (args[i] === '--to-day' && args[i + 1]) toDay = parseInt(args[i + 1], 10);
  }
  if (fromDay != null || toDay != null) {
    const f = Number.isFinite(fromDay) ? fromDay : 1;
    const t = Number.isFinite(toDay) ? toDay : f;
    const lo = Math.max(1, Math.min(Math.min(f, t), 30));
    const hi = Math.max(1, Math.min(Math.max(f, t), 30));
    return { dayStart: lo, dayEnd: hi };
  }
  const n = Math.max(1, Math.min(days, 14));
  return { dayStart: 1, dayEnd: n };
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

async function processDay(browser, dayOffset, dateStr) {
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

        const simMinute = LIVE_MIN_CANDIDATE_MINUTE;
        const simMatch = {
          id: m.id,
          league: m.league,
          home: m.home,
          away: m.away,
          minute: simMinute,
          score: { home: '0', away: '0' },
          matchDetailsUrl: m.matchDetailsUrl,
        };

        const features = buildFeatures(simMatch, statsResult);
        const scored = scoreMatch(features);
        const decision = decideBet(scored, features);

        const totalGoals = m.finalScore.home + m.finalScore.away;
        let hit = null;
        if (decision.bet === 'OVER_0_5') hit = totalGoals > 0;
        else if (decision.bet === 'UNDER_0_5') hit = totalGoals === 0;

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
          firstGoalMinute: timeline.firstGoalMinute,
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
          modelPrediction: {
            pGoal: decision.pGoal,
            pDry: decision.pDry,
            bet: decision.bet,
            confidence: decision.confidence,
            edge: decision.edge,
            reason: decision.reason,
            indices: {
              goalPressureIndex: scored.goalPressureIndex,
              dryPenalty: scored.dryPenalty,
              trendBonus: scored.trendBonus,
              imbalanceBonus: scored.imbalanceBonus,
            },
            simulation: {
              minute: simMinute,
              score: { home: '0', away: '0' },
              liveAligned: true,
              note:
                'Той самий пайплайн, що в worker.js: buildFeatures → scoreMatch → decideBet. Синтетичний матч: хвилина = LIVE_MIN_CANDIDATE_MINUTE з .env/constants (як мінімальна хвилина кандидата в лайві), рахунок 0:0. Матчі відібрані без голу до 60\', тобто на цій хвилині рахунок міг лишатися 0:0. Порівняння HIT/MISS — фактичний підсумок матчу (total goals) проти прогнозу ТБ/ТМ 0,5.',
            },
          },
          result: {
            totalGoals,
            goalsAfter60: timeline.goalsAfter60,
            goalsAfter60Note:
              timeline.goalsAfter60 === null
                ? 'Невизначено (не повинно траплятися в збережених записах).'
                : 'Скільки голів забито на 60-й хвилині або пізніше — за масивом finalScore.goalMinutes. Для 0:0 завжди 0. Для матчів у вибірці без голу до 60 при наявності голів усі вони після 60 — тут буде >0.',
            hit,
            label: hit === true ? 'HIT' : hit === false ? 'MISS' : 'SKIP',
          },
          pipeline: 'analyzed',
        };

        const mark = hit === true ? 'HIT' : hit === false ? 'MISS' : '?';
        console.log(`${decision.bet} (${decision.confidence}) pGoal=${decision.pGoal} → ${mark}`);
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

  const withPred = analyzed.filter((r) => r.modelPrediction?.bet && r.modelPrediction.bet !== 'SKIP');
  const hits = withPred.filter((r) => r.result?.label === 'HIT').length;
  const misses = withPred.filter((r) => r.result?.label === 'MISS').length;

  console.log(
    `\n  Summary ${dateStr}: analyzed=${analyzed.length} | пропуски: гол_до_60=${skippedEarly} немає_хвилин_голів=${skippedGoalMinutes} немає_стати_моб=${skippedNoStatsMobile} resolve=${skippedResolve} немає_стати_деск=${skippedNoStatsDesktop} помилки=${errors} | ${hits} HIT / ${misses} MISS`
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
  const { dayStart, dayEnd } = parseArgs();
  const dayCount = dayEnd - dayStart + 1;
  console.log(
    `Historical scraper: зсуви -${dayStart} … -${dayEnd} (${dayCount} дн.)`
  );
  console.log(`Output: ${DATA_BASE}`);
  console.log(`LIVE_MIN_CANDIDATE_MINUTE (симуляція як у лайві): ${LIVE_MIN_CANDIDATE_MINUTE}`);

  const browser = await launchBrowser();
  const allAnalyzed = [];
  const dateRange = { from: null, to: null };

  try {
    for (let d = dayStart; d <= dayEnd; d++) {
      const dateStr = dateKeyLocal(dayjs().subtract(d, 'day'));
      if (!dateRange.from || dateStr < dateRange.from) dateRange.from = dateStr;
      if (!dateRange.to || dateStr > dateRange.to) dateRange.to = dateStr;

      const { analyzed } = await processDay(browser, -d, dateStr);
      allAnalyzed.push(...analyzed);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('GRAND TOTAL');
  console.log('='.repeat(60));

  const withPred = allAnalyzed.filter((r) => r.modelPrediction?.bet && r.modelPrediction.bet !== 'SKIP');
  const hits = withPred.filter((r) => r.result?.label === 'HIT').length;
  const misses = withPred.filter((r) => r.result?.label === 'MISS').length;

  console.log(`Days: -${dayStart} … -${dayEnd} (${dayCount})`);
  console.log(`Analyzed (saved): ${allAnalyzed.length}`);
  console.log(`With prediction: ${withPred.length}`);
  console.log(`HITs: ${hits} | MISSes: ${misses}`);
  console.log(`Hit rate: ${withPred.length > 0 ? (hits / withPred.length) * 100 : 0}%`);

  if (allAnalyzed.length > 0) {
    const excelPath = path.join(ensureDir(DIRS.reports), `report_${dateRange.from}_${dateRange.to}.xlsx`);
    await exportToExcel(allAnalyzed, excelPath);
    console.log(`\nExcel: ${excelPath}`);
  }

  console.log('\nDone.');
})();
