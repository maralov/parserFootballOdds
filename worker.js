require('dotenv').config();

const { parentPort, workerData } = require('worker_threads');
const { launchBrowser } = require('./src/browser');
const scrapeLiveMatches = require('./src/scrapeLiveMatches');
const { resolveDesktopUrl, scrapeDesktopStats } = require('./src/scrapeDesktopStats');
const { buildFeatures } = require('./src/pipeline/featureBuilder');
const { scoreMatch } = require('./src/pipeline/modelScoring');
const { decideBet } = require('./src/pipeline/betDecision');
const { createRunContext } = require('./src/pipeline/contracts');
const { appendMatchEntry, createMatchLogEntry } = require('./src/pipeline/dailyLogger');
const { checkYesterdayResults } = require('./src/pipeline/resultChecker');
const sendTelegramMessage = require('./src/helpers/utils/sendTelegramMessage');
const { formatTelegramMessage, formatDailySummary } = require('./src/helpers/utils/formatTelegramMessage');
const { USER_AGENT, STATS_CONCURRENCY, MAX_TELEGRAM_MINUTE, isWithinWorkingHours } = require('./src/helpers/constants');

const processedMatchIds = workerData?.processedMatchIds
  ? new Set(workerData.processedMatchIds)
  : new Set();

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
  const now = new Date();
  console.log(`[${now.toLocaleTimeString('uk-UA')}] Live scan`);

  const hr = now.getHours();
  const needResultCheck = hr === 10 && lastResultCheckHour !== 10;

  if (needResultCheck) {
    console.log(`  10:00 — checking yesterday results`);
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    try {
      const summary = await checkYesterdayResults(page);
      if (summary) {
        console.log(`  Yesterday: ${summary.hits}/${summary.actionable} hits`);
        const msg = formatDailySummary(summary);
        if (msg) await sendTelegramMessage(msg);
      }
      lastResultCheckHour = 10;
    } catch (e) { console.log(`  Result check err: ${e.message}`); }
    await browser.close();
  }

  if (!isWithinWorkingHours(now)) {
    console.log(`  Outside working hours → skip`);
    parentPort.postMessage({ runId: runCtx.runId, matchesAnalyzed: 0, signalsSent: 0, processedMatchIds: Array.from(processedMatchIds), lastResultCheckHour, skipped: 'outside_hours' });
    return;
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  const allMatches = await scrapeLiveMatches(page);
  const newMatches = allMatches.filter((m) => !processedMatchIds.has(m.id));

  console.log(`  Found: ${allMatches.length} candidates, ${newMatches.length} new`);

  const results = [];

  await mapWithConcurrency(newMatches, STATS_CONCURRENCY, async (match) => {
    const tag = `${match.home} - ${match.away} (${match.minute}')`;
    console.log(`\n→ ${tag} [${match.league}]`);

    const logCandidate = createMatchLogEntry(match, null, null, null, { pipeline: 'candidate_found' });
    appendMatchEntry(logCandidate);

    const statPage = await browser.newPage();
    await statPage.setUserAgent(USER_AGENT);

    try {
      const { desktopUrl, resolved } = await resolveDesktopUrl(statPage, match.id);
      if (!resolved || !desktopUrl) {
        console.log(`  ✗ Desktop URL resolve failed`);
        appendMatchEntry({ ...logCandidate, pipeline: 'resolve_failed' });
        return;
      }
      console.log(`  Desktop: ${desktopUrl}`);

      const statsResult = await scrapeDesktopStats(statPage, desktopUrl, match.id);

      const features = buildFeatures(match, statsResult);
      console.log(`  Features: quality=${features.dataQualityScore}, primary=${features.availablePrimary}, status=${features.statsStatus}`);

      if (!features.allowDecision) {
        appendMatchEntry(createMatchLogEntry(match, features, null, null, { desktopUrl, pipeline: 'no_decision_data' }));
        console.log(`  ✗ Not enough data`);
        return;
      }

      const scored = scoreMatch(features);
      const decision = decideBet(scored, features);
      console.log(`  Score: pGoal=${scored.pGoal}, pDry=${scored.pDry} → ${decision.bet} (${decision.confidence})`);

      const logEntry = createMatchLogEntry(match, features, scored, decision, { desktopUrl, pipeline: 'decision_made' });
      appendMatchEntry(logEntry);
      results.push({ match, decision, logEntry });
      processedMatchIds.add(match.id);

      if (decision.bet !== 'SKIP' && match.minute <= MAX_TELEGRAM_MINUTE) {
        try {
          await sendTelegramMessage(formatTelegramMessage(match, decision));
          console.log(`  ✓ Telegram sent`);
        } catch (e) { console.log(`  Telegram err: ${e.message}`); }
      } else if (decision.bet !== 'SKIP') {
        console.log(`  ⏭ ${match.minute}' > ${MAX_TELEGRAM_MINUTE}' — logged only`);
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

  await browser.close();

  parentPort.postMessage({
    runId: runCtx.runId,
    matchesAnalyzed: results.length,
    signalsSent: tgSent.length,
    processedMatchIds: Array.from(processedMatchIds),
    lastResultCheckHour,
  });
})();
