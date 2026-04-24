/**
 * Перезапуск перевірки результатів за конкретний день.
 * Скидає resultChecked для всіх матчів і перевіряє заново.
 * Використання: node scripts/recheckDay.js [YYYY-MM-DD]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { checkDayResults } = require('../src/pipeline/resultChecker');
const { loadDayMatches, saveDayMatches } = require('../src/pipeline/dailyLogger');
const { launchBrowser } = require('../src/browser');
const { formatDailySummaryTelegram } = require('../src/helpers/utils/formatDailySummary');
const sendTelegramMessage = require('../src/helpers/utils/sendTelegramMessage');
const dayjs = require('dayjs');

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

(async () => {
  const arg = process.argv[2];
  const dateRef = arg || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  console.log(`Recheck: ${dateRef}`);

  // Скинути resultChecked для всіх матчів
  const matches = loadDayMatches(dateRef);
  let reset = 0;
  for (const m of matches) {
    if (m.resultChecked) {
      m.resultChecked = false;
      m.hit = null;
      m.hitLegs = undefined;
      m.hadExtraTime = undefined;
      m.regularTimeGoals = undefined;
      m.actualResult = null;
      m.resultTimestamp = undefined;
      reset++;
    }
  }
  saveDayMatches(dateRef, matches);
  console.log(`Скинуто resultChecked для ${reset} матчів`);

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  try {
    const summary = await checkDayResults(page, dateRef);
    if (summary) {
      const r = summary.resolved ?? (summary.hits + summary.misses);
      console.log(`\nРезультат: ${summary.hits}/${r} (${summary.actionable} з прогнозом)`);

      if (summary.actionable > 0) {
        const msg = formatDailySummaryTelegram(dateRef);
        if (msg) {
          await sendTelegramMessage(msg);
          console.log('Telegram: підсумок відправлено');
        }
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
