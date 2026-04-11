require('dotenv').config();

const { parentPort, workerData } = require('worker_threads');
const { launchBrowser } = require('./src/browser');
const scrapeLiveMatches = require('./src/scrapeLiveMatches');
const { resolveDesktopUrl, scrapeDesktopStats, checkMatchResult } = require('./src/scrapeDesktopStats');
const { buildFeatures } = require('./src/pipeline/featureBuilder');
const { scoreMatchWindowed } = require('./src/pipeline/modelScoring');
const { decideWindowedLiveBet } = require('./src/pipeline/windowedLiveDecision');
const { fetchOdds1X2 } = require('./src/scrapeLiveOdds');
const { scrapeMatchIncidents } = require('./src/scrapeMatchIncidents');
const { createRunContext } = require('./src/pipeline/contracts');
const { appendMatchEntry, createMatchLogEntry, updateMatchResult } = require('./src/pipeline/dailyLogger');
const { checkYesterdayResults } = require('./src/pipeline/resultChecker');
const { wasDailyReportTelegramSent, markDailyReportTelegramSent } = require('./src/pipeline/telegramDailyReportGate');
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
        if (msg) {
          if (!wasDailyReportTelegramSent(summary.date)) {
            await sendTelegramMessage(msg);
            markDailyReportTelegramSent(summary.date);
            console.log(`  Daily report Telegram sent (date=${summary.date})`);
          } else {
            console.log(`  Daily report already sent for ${summary.date} — skip Telegram`);
          }
        }
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
      const { odds1X2 } = await fetchOdds1X2(statPage, match.matchDetailsUrl);
      if (odds1X2) {
        console.log(`  Кф 1X2: ${odds1X2.home} / ${odds1X2.draw} / ${odds1X2.away}`);
      } else {
        console.log(`  Кф 1X2: немає на сторінці огляду`);
      }

      const { desktopUrl, resolved } = await resolveDesktopUrl(statPage, match.id);
      if (!resolved || !desktopUrl) {
        console.log(`  ✗ Desktop URL resolve failed → permanent skip`);
        appendMatchEntry({ ...logCandidate, pipeline: 'resolve_failed' });
        processedMatchIds.add(match.id);
        return;
      }
      console.log(`  Desktop: ${desktopUrl}`);

      const statsResult = await scrapeDesktopStats(statPage, desktopUrl, match.id);
      const incidents = await scrapeMatchIncidents(statPage, match.id);

      const features = {
        ...buildFeatures(match, statsResult),
        odds1X2: odds1X2 || null,
        redCards: incidents,
      };
      const rcLog = incidents && (incidents.homeRedCards + incidents.awayRedCards) > 0
        ? ` | redCards=${incidents.homeRedCards}H+${incidents.awayRedCards}A` : '';
      console.log(`  Features: quality=${features.dataQualityScore}, primary=${features.availablePrimary}, status=${features.statsStatus}${rcLog}`);

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

      const prevBet = activePredictions.get(match.id)?.bet ?? null;
      const scored = scoreMatchWindowed(features);
      const decision = decideWindowedLiveBet(scored, features, prevBet);
      console.log(
        `  Score (windowed): pGoal=${scored.pGoal}, pDry=${scored.pDry} | ${decision.timeWindow} → ${decision.bet}` +
        (decision.signalEligible ? ' [TG]' : '')
      );

      const logEntry = createMatchLogEntry(match, features, scored, decision, {
        desktopUrl,
        pipeline: 'decision_made',
        feed: match.feed,
        feedUrl: match.feedUrl,
        skipReason: decision.bet === 'SKIP' ? 'windowed_wait_or_skip' : null,
      });
      appendMatchEntry(logEntry);

      let telegramSent = false;

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
        const canPush = decision.signalEligible && match.minute <= MAX_TELEGRAM_MINUTE;
        const isNewSignal = !alreadySentTg && canPush;
        const isFlipToOver = betChanged && prev?.bet === 'UNDER_0_5' && decision.bet === 'OVER_0_5';
        const isUpdate = alreadySentTg && canPush && (betChanged || confChanged);

        if (isNewSignal) {
          try {
            await sendTelegramMessage(formatTelegramMessage(match, decision, desktopUrl, { redCards: incidents }));
            sentTelegramIds.add(match.id);
            telegramSent = true;
            console.log(`  ✓ Telegram sent`);
          } catch (e) { console.log(`  Telegram err: ${e.message}`); }
        } else if (isUpdate) {
          const changeLabel = isFlipToOver
            ? 'Фліп ТМ→ТБ (оновлення сценарію)'
            : (betChanged ? `прогноз → ${decision.bet === 'OVER_0_5' ? 'ТБ' : 'ТМ'}` : `впевненість → ${decision.confidence}`);
          try {
            await sendTelegramMessage(
              `🔄 *Оновлення (${match.minute}')* — ${decision.timeWindow}\n🏆 ${match.home} - ${match.away}\n${changeLabel}\n` +
              `🎯 P(гол): ${decision.pGoal} | P(сухий): ${decision.pDry}\n📝 ${decision.reason}`
            );
            telegramSent = true;
            console.log(`  ✓ Telegram update sent (${changeLabel})`);
          } catch (e) { console.log(`  Telegram update err: ${e.message}`); }
        } else if (alreadySentTg) {
          console.log(`  ↻ Re-analysis done (no change)`);
        } else if (!decision.signalEligible) {
          console.log(`  ⏸ сигнал не пройшов (вікно ${decision.timeWindow}, впевненість: ${features.confidence}, bet: ${decision.bet})`);
        }
      }

      results.push({ match, decision, logEntry, telegramSent });
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
    } finally {
      await statPage.close();
    }
  });

  const actionable = results.filter((r) => r.decision.bet !== 'SKIP');
  const tgSent = results.filter((r) => r.telegramSent).length;
  console.log(`\nDone: ${results.length} analyzed, ${actionable.length} actionable, ${tgSent} TG sent`);

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
        const isResolved = res.finished || res.resolvedByGoal;
        if (isResolved && res.homeScore !== null) {
          const total = res.homeScore + res.awayScore;
          const actualOver = total > 0;
          const predictedOver = pred.bet === 'OVER_0_5';
          const hit = actualOver === predictedOver;
          const finalScore = { home: res.homeScore, away: res.awayScore };
          const statusLabel = res.finished ? 'FT' : `${res.homeScore}:${res.awayScore} (ще тривае, гол вирішив)`;

          console.log(`  ⚽ ${pred.home} - ${pred.away}: ${res.homeScore}:${res.awayScore} ${res.finished ? '[FT]' : '[GOAL→resolved]'} → ${hit ? '✅ HIT' : '❌ MISS'} (bet=${pred.bet})`);
          updateMatchResult(matchId, finalScore, hit);

          if (sentTelegramIds.has(matchId)) {
            const betLabel = pred.bet === 'OVER_0_5' ? 'ТБ 0,5' : 'ТМ 0,5';
            const mark = hit ? '✅ HIT' : '❌ MISS';
            const suffix = res.finished ? `🏁 Фінал: ${res.homeScore}:${res.awayScore}` : `⚽ Гол на ${res.homeScore}:${res.awayScore} — прогноз вирішено`;
            try {
              await sendTelegramMessage(`⚽ *${pred.home} - ${pred.away}*\n${suffix}\n📊 Прогноз: ${betLabel}\n${mark}`);
              console.log(`  ✓ Telegram result sent (${statusLabel})`);
            } catch (e) { console.log(`  Telegram result err: ${e.message}`); }
          }

          activePredictions.delete(matchId);
        } else if (res.finished) {
          console.log(`  ⚽ ${pred.home} - ${pred.away}: FT but score not parsed`);
        } else {
          console.log(`  ⏳ ${pred.home} - ${pred.away}: still live 0:0`);
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
    signalsSent: tgSent,
    processedMatchIds: Array.from(processedMatchIds),
    sentTelegramIds: Array.from(sentTelegramIds),
    activePredictions: Array.from(activePredictions.entries()),
    lastResultCheckHour,
  });
})();
