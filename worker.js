const { workerData, parentPort } = require('worker_threads');
const { launchBrowser } = require('./src/browser');

const scrapeLiveMatches = require('./src/scrapeLiveMatches');
const scrapeMatchStats2H = require('./src/scrapeMatchStats2H');
const { predictLateGoal } = require('./src/helpers/utils/predictLateGoal');
const { saveJson } = require('./src/helpers/utils');
const sendTelegramMessage = require('./src/helpers/utils/sendTelegramMessage');
const formatTelegramMessage = require('./src/helpers/utils/formatTelegramMessage');
const { USER_AGENT } = require('./src/helpers/constants');

(async () => {
  // Для лайв матчів не використовуємо league, але залишаємо для сумісності
  const league = workerData.league || { name: 'live', country: 'all' };
  console.log(`🧵 Worker started → Live matches analysis`);

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  const matches = await scrapeLiveMatches(page);
  console.log(`📌 Found ${matches.length} live matches (>=70', score 0:0)`);

  const output = [];

  for (const match of matches) {
    console.log(`\n==============================`);
    console.log(`➡️ Analyzing match: ${match.home} – ${match.away}`);
    console.log(`📊 League: ${match.league}`);
    console.log(`🔗 URL: ${match.matchDetailsUrl}`);
    console.log(`==============================`);

    if (!match.matchDetailsUrl) {
      console.log(`❌ No matchDetailsUrl → SKIP`);
      continue;
    }

    // === STATS ===
    console.log(`📊 Loading stats2h for ${match.id}...`);

    const statsResult = await scrapeMatchStats2H(page, match.matchDetailsUrl, match.id);

    if (statsResult.error || !statsResult.stats2h) {
      console.log(`❌ Stats ERROR for ${match.id} → SKIP`);
      continue;
    }

    const stats2h = statsResult.stats2h;
    console.log(
      `✅ Stats loaded: xG=${stats2h.expectedGoalsXg || 'N/A'}, sOT=${stats2h.shotsOnTarget || 'N/A'}, touches=${
        stats2h.touchesInOppositionBox || 'N/A'
      }`
    );

    // === PREDICTION ===
    console.log(`🔮 Making prediction...`);
    const prediction = predictLateGoal(stats2h);
    console.log(`📊 Zone: ${prediction.zone}, Bet: ${prediction.bet}, Confidence: ${prediction.confidence}`);

    const result = {
      ...match,
      stats2h,
      prediction,
      timestamp: new Date().toISOString(),
    };

    output.push(result);

    // === SAVE ===
    saveJson('live_predictions.json', output);
    console.log(`💾 Saved prediction. Total: ${output.length}`);

    // === TELEGRAM ===
    // Відправляємо тільки якщо це не SKIP або якщо це важливий прогноз (max/strong confidence)
    if (prediction.bet !== 'SKIP' && (prediction.confidence === 'max' || prediction.confidence === 'strong')) {
      try {
        const message = formatTelegramMessage(match, prediction);
        await sendTelegramMessage(message);
        console.log(`📱 Telegram message sent`);
      } catch (e) {
        console.log(`⚠️ Telegram error: ${e.message}`);
      }
    } else {
      console.log(`⏭ Skipping Telegram (bet: ${prediction.bet}, confidence: ${prediction.confidence})`);
    }
  }

  await browser.close();

  parentPort.postMessage({
    league,
    matchesProcessed: output.length,
  });
})();
