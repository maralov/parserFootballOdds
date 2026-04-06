require('dotenv').config();

const { parentPort, workerData } = require('worker_threads');
const { launchBrowser } = require('./src/browser');
const scrapeLiveMatches = require('./src/scrapeLiveMatches');
const scrapeMatchStats2H = require('./src/scrapeMatchStats2H');
const { buildFeatures } = require('./src/pipeline/featureBuilder');
const { scoreMatch } = require('./src/pipeline/modelScoring');
const { decideBet } = require('./src/pipeline/betDecision');
const { createRunContext } = require('./src/pipeline/contracts');
const { appendMatchEntry, createMatchLogEntry } = require('./src/pipeline/dailyLogger');
const { checkYesterdayResults } = require('./src/pipeline/resultChecker');
const sendTelegramMessage = require('./src/helpers/utils/sendTelegramMessage');
const { formatTelegramMessage, formatDailySummary } = require('./src/helpers/utils/formatTelegramMessage');
const { USER_AGENT, STATS_CONCURRENCY, shouldAnalyzeMatch } = require('./src/helpers/constants');

const MAX_TELEGRAM_MINUTE = 84;
const processedMatchIds = workerData?.processedMatchIds
  ? new Set(workerData.processedMatchIds)
  : new Set();

let lastResultCheckHour = -1;

async function mapWithConcurrency(items, limit, mapper) {
  const result = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      result[current] = await mapper(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => worker());
  await Promise.all(workers);
  return result;
}

(async () => {
  const runContext = createRunContext();
  const now = new Date();
  console.log(`[${now.toLocaleTimeString('uk-UA')}] Live scan started`);

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  const currentHour = now.getHours();
  if (currentHour !== lastResultCheckHour && currentHour >= 8 && currentHour <= 12) {
    try {
      const summary = await checkYesterdayResults(page);
      if (summary) {
        console.log(`Yesterday: ${summary.hits}/${summary.actionable} hits (${summary.hitRate})`);
        const msg = formatDailySummary(summary);
        if (msg) await sendTelegramMessage(msg);
      }
      lastResultCheckHour = currentHour;
    } catch (e) {
      console.log(`Result check error: ${e.message}`);
    }
  }

  const allMatches = await scrapeLiveMatches(page);
  const matches = allMatches.filter((m) => shouldAnalyzeMatch(m.league, now));
  const skippedByLeague = allMatches.length - matches.length;
  const newMatches = matches.filter((m) => !processedMatchIds.has(m.id));
  const skippedDupe = matches.length - newMatches.length;

  console.log(
    `Found: ${allMatches.length} total, ${matches.length} eligible` +
    (skippedByLeague ? `, ${skippedByLeague} league-filtered` : '') +
    (skippedDupe ? `, ${skippedDupe} already processed` : '') +
    ` → ${newMatches.length} to analyze`
  );

  const results = [];

  await mapWithConcurrency(newMatches, STATS_CONCURRENCY, async (match) => {
    const minuteTag = match.minute > MAX_TELEGRAM_MINUTE ? ' [LATE]' : '';
    console.log(`\n→ ${match.home} - ${match.away} (${match.minute}')${minuteTag} [${match.league}]`);
    const statPage = await browser.newPage();
    await statPage.setUserAgent(USER_AGENT);
    try {
      const statsResult = await scrapeMatchStats2H(statPage, match.matchDetailsUrl, match.id);
      if (!statsResult.stats2h) {
        console.log(`  ✗ No stats available`);
        return;
      }

      const features = buildFeatures(match, statsResult.stats2h);
      console.log(`  Features: quality=${features.dataQualityScore}, primary=${features.availablePrimary}, allow=${features.allowDecision}`);
      if (!features.allowDecision) {
        console.log(`  ✗ Not enough data for decision`);
        return;
      }

      const scored = scoreMatch(features);
      const decision = decideBet(scored, features);
      console.log(`  Score: pGoal=${scored.pGoal}, pDry=${scored.pDry} → ${decision.bet} (${decision.confidence})`);

      const logEntry = createMatchLogEntry(match, features, scored, decision);
      appendMatchEntry(logEntry);
      results.push({ match, decision, logEntry });
      processedMatchIds.add(match.id);

      if (decision.bet !== 'SKIP' && match.minute <= MAX_TELEGRAM_MINUTE) {
        try {
          const msg = formatTelegramMessage(match, decision);
          await sendTelegramMessage(msg);
          console.log(`  ✓ Telegram sent`);
        } catch (e) {
          console.log(`  Telegram error: ${e.message}`);
        }
      } else if (decision.bet !== 'SKIP' && match.minute > MAX_TELEGRAM_MINUTE) {
        console.log(`  ⏭ ${match.minute}' > ${MAX_TELEGRAM_MINUTE}' — logged only, no Telegram`);
      }
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
    } finally {
      await statPage.close();
    }
  });

  const actionable = results.filter((r) => r.decision.bet !== 'SKIP');
  const telegramSent = actionable.filter((r) => r.match.minute <= MAX_TELEGRAM_MINUTE);
  console.log(`\nDone: ${results.length} analyzed, ${actionable.length} actionable, ${telegramSent.length} Telegram sent`);

  await browser.close();

  parentPort.postMessage({
    runId: runContext.runId,
    matchesAnalyzed: results.length,
    signalsSent: telegramSent.length,
    processedMatchIds: Array.from(processedMatchIds),
  });
})();
