/**
 * Аналіз ставок за день (за замовчуванням «вчора») і відправка в Telegram.
 * Використання: node scripts/sendYesterdayStakeReport.js [YYYY-MM-DD]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const dayjs = require('dayjs');
const { yesterday } = require('../src/helpers/date');
const { loadDayMatches } = require('../src/pipeline/dailyLogger');
const { analyzeStakeLegs, formatStakeAnalysisMessage } = require('../src/pipeline/stakeDayAnalysis');
const sendTelegramMessage = require('../src/helpers/utils/sendTelegramMessage');

const AVG_ODDS = Number(process.env.REPORT_AVG_ODDS || 2.5);
const STAKE_PCT = Number(process.env.REPORT_STAKE_PCT_BANK || 5);
const stakeFrac = STAKE_PCT / 100;

(async () => {
  const arg = process.argv[2];
  const dateRef = arg ? dayjs(arg) : yesterday();
  const matches = loadDayMatches(dateRef);

  const analysis = analyzeStakeLegs(matches, dateRef, { avgOdds: AVG_ODDS, stakeFrac });
  const msg = formatStakeAnalysisMessage(analysis);

  console.log(msg.replace(/\*/g, ''));
  await sendTelegramMessage(msg);
  console.log('Telegram: звіт відправлено.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
