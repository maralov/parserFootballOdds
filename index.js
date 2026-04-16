require('dotenv').config();
if (process.argv.includes('--ignore-hours')) {
  process.env.LIVE_IGNORE_HOURS = '1';
}
const { Worker } = require('worker_threads');
const { LIVE_POLL_INTERVAL_MS } = require('./src/helpers/constants');
const { getTelegramMarkdownPrefix } = require('./src/helpers/telegramModelTag');
const { dateKeyLocal, timeHHmm } = require('./src/helpers/date');
const sendTelegramMessage = require('./src/helpers/utils/sendTelegramMessage');

let processedMatchIds = [];
let sentTelegramIds = [];
let activePredictions = [];
let lastResultCheckHour = -1;
let lastHeartbeat = Date.now();
let lastDayKey = dateKeyLocal();
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;

function runLiveWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./worker.js', {
      workerData: { processedMatchIds, sentTelegramIds, activePredictions, lastResultCheckHour },
    });

    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}

async function sendHeartbeat(runCount) {
  const now = Date.now();
  if (now - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeat = now;

  const time = timeHHmm();
  const msg = `${getTelegramMarkdownPrefix()}🟢 Парсер активний (${time})\nЦиклів: ${runCount} | Skipped: ${processedMatchIds.length} | TG: ${sentTelegramIds.length} | Active: ${activePredictions.length}`;
  try {
    await sendTelegramMessage(msg);
  } catch (e) {
    console.log(`Heartbeat error: ${e.message}`);
  }
}

(async () => {
  const isContinuous = process.argv.includes('--watch');
  console.log(`🚀 Starting live scraping${isContinuous ? ' (watch mode)' : ''}...`);

  let runCount = 0;

  do {
    const todayKey = dateKeyLocal();
    if (todayKey !== lastDayKey) {
      console.log(`📅 New day — reset (skipped=${processedMatchIds.length}, tgSent=${sentTelegramIds.length}, active=${activePredictions.length})`);
      processedMatchIds = [];
      sentTelegramIds = [];
      activePredictions = [];
      lastResultCheckHour = -1;
      lastDayKey = todayKey;
    }

    try {
      runCount++;
      const result = await runLiveWorker();
      console.log(`\n🔥 RUN #${runCount}: analyzed=${result.matchesAnalyzed}, signals=${result.signalsSent}`);

      if (result.processedMatchIds) processedMatchIds = result.processedMatchIds;
      if (result.sentTelegramIds) sentTelegramIds = result.sentTelegramIds;
      if (result.activePredictions) activePredictions = result.activePredictions;
      if (result.lastResultCheckHour != null) lastResultCheckHour = result.lastResultCheckHour;
    } catch (e) {
      console.log(`\n❌ RUN #${runCount} FAILED: ${e.message}`);
    }

    if (!isContinuous) break;

    await sendHeartbeat(runCount);

    const waitMin = Math.round(LIVE_POLL_INTERVAL_MS / 60000);
    console.log(`⏳ Next scan in ${waitMin}m...`);
    await new Promise((resolve) => setTimeout(resolve, LIVE_POLL_INTERVAL_MS));
  } while (true);
})();
