require('dotenv').config();

const { parentPort, workerData } = require('worker_threads');
const { launchBrowser } = require('./src/browser');
const scrapeLiveMatches = require('./src/scrapeLiveMatches');
const { resolveDesktopUrl, scrapeDesktopStats, checkMatchResult } = require('./src/scrapeDesktopStats');
const { buildFeatures } = require('./src/pipeline/featureBuilder');
const { scoreMatch } = require('./src/pipeline/modelScoring');
const { decideBet } = require('./src/pipeline/betDecision');
const { createRunContext } = require('./src/pipeline/contracts');
const { appendMatchEntry, createMatchLogEntry, updateMatchResult } = require('./src/pipeline/dailyLogger');
const { checkYesterdayResults } = require('./src/pipeline/resultChecker');
const sendTelegramMessage = require('./src/helpers/utils/sendTelegramMessage');
const { formatTelegramMessage, formatDailySummary } = require('./src/helpers/utils/formatTelegramMessage');
const { USER_AGENT, STATS_CONCURRENCY, MAX_TELEGRAM_MINUTE, isWithinWorkingHours } = require('./src/helpers/constants');
const { dayjs } = require('./src/helpers/date');

const processedMatchIds = workerData?.processedMatchIds
  ? new Set(workerData.processedMatchIds)
  : new Set();

const sentTelegramIds = workerData?.sentTelegramIds
  ? new Set(workerData.sentTelegramIds)
  : new Set();

const activePredictions = workerData?.activePredictions
  ? new Map(workerData.activePredictions)
  : new Map();

let lastResultCheckHour = workerData?.lastResultCheckHour ?? -1;

async function mapWithConcurrency(items, limit, fn) {
  const result = [];
  let idx = 0;
  async function w() { while (idx < items.length) { const i = idx++; result[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => w()));
  return result;
}

(async () => {
  const runCtx = createRunContext();
  const now = dayjs();
  console.log(`[${now.format('HH:mm:ss')}] Live scan`);

  const hr = now.hour();
  const isFirstRun = lastResultCheckHour === -1;
  const needResultCheck = (hr === 10 && lastResultCheckHour !== 10) || isFirstRun;

  if (needResultCheck) {
    console.log(`  ${isFirstRun ? 'First run' : '10:00'} — checking yesterday results`);
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    try {
      const summary = await checkYesterdayResults(page);
      if (summary) {
        const r = summary.resolved ?? (summary.hits + summary.misses);
        console.log(`  Yesterday: ${summary.hits}/${r} hits (${summary.actionable} з прогнозом)`);
        const msg = formatDailySummary(summary);
        if (msg) await sendTelegramMessage(msg);
      }
      lastResultCheckHour = hr;
    } catch (e) { console.log(`  Result check err: ${e.message}`); }
    await browser.close();
  }

  if (!isWithinWorkingHours()) {
    console.log(`  Outside working hours → skip`);
    parentPort.postMessage({ runId: runCtx.runId, matchesAnalyzed: 0, signalsSent: 0, processedMatchIds: Array.from(processedMatchIds), sentTelegramIds: Array.from(sentTelegramIds), activePredictions: Array.from(activePredictions.entries()), lastResultCheckHour, skipped: 'outside_hours' });
    return;
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  const allMatches = await scrapeLiveMatches(page);
  const newMatches = allMatches.filter((m) => !processedMatchIds.has(m.id));

  console.log(`  Found: ${allMatches.length} candidates, ${newMatches.length} new, ${processedMatchIds.size} permanently skipped`);

  const results = [];

  await mapWithConcurrency(newMatches, STATS_CONCURRENCY, async (match) => {
    const tag = `${match.home} - ${match.away} (${match.minute}')`;
    console.log(`\n→ ${tag} [${match.league}]`);

    const logCandidate = createMatchLogEntry(match, null, null, null, {
      pipeline: 'candidate_found',
      feed: match.feed,
      feedUrl: match.feedUrl,
    });
    appendMatchEntry(logCandidate);

    const statPage = await browser.newPage();
    await statPage.setUserAgent(USER_AGENT);

    try {
      const { desktopUrl, resolved } = await resolveDesktopUrl(statPage, match.id);
      if (!resolved || !desktopUrl) {
        console.log(`  ✗ Desktop URL resolve failed → permanent skip`);
        appendMatchEntry({ ...logCandidate, pipeline: 'resolve_failed' });
        processedMatchIds.add(match.id);
        return;
      }
      console.log(`  Desktop: ${desktopUrl}`);

      const statsResult = await scrapeDesktopStats(statPage, desktopUrl, match.id);

      const features = buildFeatures(match, statsResult);
      console.log(`  Features: quality=${features.dataQualityScore}, primary=${features.availablePrimary}, status=${features.statsStatus}`);

      if (!features.allowDecision) {
        const isNoStats = features.statsStatus === 'unavailable';
        const skipReason = isNoStats ? 'no_stats' : 'insufficient_metrics';
        appendMatchEntry(createMatchLogEntry(match, features, null, null, {
          desktopUrl,
          pipeline: 'no_decision_data',
          feed: match.feed,
          feedUrl: match.feedUrl,
          skipReason,
        }));
        if (isNoStats) {
          processedMatchIds.add(match.id);
          console.log(`  ✗ No stats at all → permanent skip`);
        } else {
          console.log(`  ✗ Insufficient metrics (primary=${features.availablePrimary}) — will retry`);
        }
        return;
      }

      const scored = scoreMatch(features);
      const decision = decideBet(scored, features);
      console.log(`  Score: pGoal=${scored.pGoal}, pDry=${scored.pDry} → ${decision.bet} (${decision.confidence})`);

      const logEntry = createMatchLogEntry(match, features, scored, decision, {
        desktopUrl,
        pipeline: 'decision_made',
        feed: match.feed,
        feedUrl: match.feedUrl,
        skipReason: decision.bet === 'SKIP' ? 'model_skip' : null,
      });
      appendMatchEntry(logEntry);
      results.push({ match, decision, logEntry });

      if (decision.bet !== 'SKIP') {
        const prev = activePredictions.get(match.id);
        const confChanged = prev && prev.confidence !== decision.confidence;
        const betChanged = prev && prev.bet !== decision.bet;

        activePredictions.set(match.id, {
          bet: decision.bet,
          confidence: decision.confidence,
          desktopUrl,
          home: match.home,
          away: match.away,
          league: match.league,
        });

        const alreadySentTg = sentTelegramIds.has(match.id);
        const isNewSignal = !alreadySentTg && decision.confidence === 'high' && match.minute <= MAX_TELEGRAM_MINUTE;
        const isUpdate = alreadySentTg && (confChanged || betChanged);

        if (isNewSignal) {
          try {
            await sendTelegramMessage(formatTelegramMessage(match, decision, desktopUrl));
            sentTelegramIds.add(match.id);
            console.log(`  ✓ Telegram sent`);
          } catch (e) { console.log(`  Telegram err: ${e.message}`); }
        } else if (isUpdate) {
          const changeLabel = betChanged ? `прогноз → ${decision.bet === 'OVER_0_5' ? 'ТБ' : 'ТМ'}` : `впевненість → ${decision.confidence}`;
          try {
            await sendTelegramMessage(`🔄 *Оновлення (${match.minute}')*\n🏆 ${match.home} - ${match.away}\n${changeLabel}\n🎯 P(гол): ${decision.pGoal} | P(сухий): ${decision.pDry}`);
            console.log(`  ✓ Telegram update sent (${changeLabel})`);
          } catch (e) { console.log(`  Telegram update err: ${e.message}`); }
        } else if (alreadySentTg) {
          console.log(`  ↻ Re-analysis done (no change)`);
        } else if (decision.confidence !== 'high') {
          console.log(`  ⏸ ${decision.confidence} confidence — logged only`);
        }
      }
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
    } finally {
      await statPage.close();
    }
  });

  const actionable = results.filter((r) => r.decision.bet !== 'SKIP');
  const tgSent = actionable.filter((r) => r.match.minute <= MAX_TELEGRAM_MINUTE);
  console.log(`\nDone: ${results.length} analyzed, ${actionable.length} actionable, ${tgSent.length} TG sent`);

  // --- Check finished matches ---
  const currentCandidateIds = new Set(allMatches.map((m) => m.id));
  const maybeFinished = [...activePredictions.entries()].filter(([id]) => !currentCandidateIds.has(id));

  if (maybeFinished.length > 0) {
    console.log(`\n🔍 Checking ${maybeFinished.length} possibly finished match(es)...`);
    for (const [matchId, pred] of maybeFinished) {
      const rPage = await browser.newPage();
      await rPage.setUserAgent(USER_AGENT);
      try {
        const res = await checkMatchResult(rPage, matchId);
        if (res.finished && res.homeScore !== null) {
          const total = res.homeScore + res.awayScore;
          const actualOver = total > 0;
          const predictedOver = pred.bet === 'OVER_0_5';
          const hit = actualOver === predictedOver;
          const finalScore = { home: res.homeScore, away: res.awayScore };

          console.log(`  ⚽ ${pred.home} - ${pred.away}: ${res.homeScore}:${res.awayScore} → ${hit ? '✅ HIT' : '❌ MISS'} (bet=${pred.bet})`);
          updateMatchResult(matchId, finalScore, hit);

          if (sentTelegramIds.has(matchId)) {
            const betLabel = pred.bet === 'OVER_0_5' ? 'ТБ 0,5' : 'ТМ 0,5';
            const mark = hit ? '✅ HIT' : '❌ MISS';
            try {
              await sendTelegramMessage(`⚽ *${pred.home} - ${pred.away}*\n🏁 Фінал: ${res.homeScore}:${res.awayScore}\n📊 Прогноз: ${betLabel}\n${mark}`);
              console.log(`  ✓ Telegram FT result sent`);
            } catch (e) { console.log(`  Telegram FT err: ${e.message}`); }
          }

          activePredictions.delete(matchId);
        } else if (res.finished) {
          console.log(`  ⚽ ${pred.home} - ${pred.away}: FT but score not parsed (${res.title})`);
        } else {
          console.log(`  ⏳ ${pred.home} - ${pred.away}: still live`);
        }
      } catch (e) {
        console.log(`  ✗ Result check ${matchId}: ${e.message}`);
      } finally {
        await rPage.close();
      }
    }
  }

  if (activePredictions.size > 0) {
    console.log(`📌 Tracking ${activePredictions.size} active prediction(s)`);
  }

  await browser.close();

  parentPort.postMessage({
    runId: runCtx.runId,
    matchesAnalyzed: results.length,
    signalsSent: tgSent.length,
    processedMatchIds: Array.from(processedMatchIds),
    sentTelegramIds: Array.from(sentTelegramIds),
    activePredictions: Array.from(activePredictions.entries()),
    lastResultCheckHour,
  });
})();
