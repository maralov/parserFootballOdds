require('dotenv').config();
const { Worker } = require('worker_threads');
const { LIVE_POLL_INTERVAL_MS } = require('./src/helpers/constants');
const sendTelegramMessage = require('./src/helpers/utils/sendTelegramMessage');

let processedMatchIds = [];
let lastResultCheckHour = -1;
let lastHeartbeat = 0;
let lastDay = new Date().getDate();
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;

function runLiveWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./worker.js', {
      workerData: { processedMatchIds, lastResultCheckHour },
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

  const time = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const msg = `🟢 Парсер активний (${time})\nЦиклів: ${runCount} | Оброблено: ${processedMatchIds.length} матчів`;
  try {
    await sendTelegramMessage(msg);
  } catch (e) {
    console.log(`Heartbeat error: ${e.message}`);
  }
}

(async () => {
  const isContinuous = process.argv.includes('--watch');
  console.log(`🚀 Starting live scraping${isContinuous ? ' (watch mode)' : ''}...`);

  if (isContinuous) {
    lastHeartbeat = 0;
    await sendHeartbeat(0);
  }

  let runCount = 0;

  do {
    const today = new Date().getDate();
    if (today !== lastDay) {
      console.log(`📅 New day — reset processedMatchIds (was ${processedMatchIds.length})`);
      processedMatchIds = [];
      lastResultCheckHour = -1;
      lastDay = today;
    }

    try {
      runCount++;
      const result = await runLiveWorker();
      console.log(`\n🔥 RUN #${runCount}: analyzed=${result.matchesAnalyzed}, signals=${result.signalsSent}`);

      if (result.processedMatchIds) processedMatchIds = result.processedMatchIds;
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
