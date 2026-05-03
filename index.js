require('dotenv').config();
if (process.argv.includes('--ignore-hours')) {
  process.env.LIVE_IGNORE_HOURS = '1';
}
const { Worker } = require('worker_threads');
const { LIVE_POLL_INTERVAL_MS, LIVE_MIN_CANDIDATE_MINUTE, LINE1_ENABLED, LINE1_MIN_CANDIDATE_MINUTE } = require('./src/helpers/constants');
const EFFECTIVE_MIN_CANDIDATE_MINUTE = LINE1_ENABLED
  ? Math.min(LINE1_MIN_CANDIDATE_MINUTE, LIVE_MIN_CANDIDATE_MINUTE)
  : LIVE_MIN_CANDIDATE_MINUTE;
const { getTelegramMarkdownPrefix } = require('./src/helpers/telegramModelTag');
const { dateKeyLocal, timeHHmm } = require('./src/helpers/date');
const sendTelegramMessage = require('./src/helpers/utils/sendTelegramMessage');

/**
 * Динамічно обчислює паузу до наступного скану.
 * - Є кандидати (≥60') або warmup (52-59') → штатний інтервал (3 хв)
 * - Є активні прогнози → max 5 хв (не пропустити FT)
 * - Немає матчів взагалі → 15 хв
 * - Найближчий матч на N' → чекаємо поки він досягне LIVE_MIN_CANDIDATE_MINUTE (52')
 */
function computeNextWaitMs({ liveDecisionCount, liveWarmupCount, nearestSkippedMinute, hasActivePredictions, defaultMs }) {
  const DECISION_POLL_MS = 2  * 60_000;   // активні кандидати ≥60' — частіше
  const ACTIVE_CAP_MS    = 5  * 60_000;   // якщо є active predictions — не спати довше 5 хв
  const NO_MATCH_MS      = 15 * 60_000;   // взагалі немає матчів live
  const MAX_SLEEP_MS     = 30 * 60_000;   // абсолютний максимум

  // активні (не permanent-skip) кандидати ≥60' — найвищий пріоритет
  if (liveDecisionCount > 0) return DECISION_POLL_MS;
  // warmup матчі (52-59') потребують опитування для накопичення знімків
  if (liveWarmupCount > 0) return defaultMs;

  let waitMs;
  if (nearestSkippedMinute == null) {
    waitMs = NO_MATCH_MS;
  } else {
    // Прийти коли матч досягне порогу кандидата — перший знімок
    const minUntil = Math.max(1, EFFECTIVE_MIN_CANDIDATE_MINUTE - nearestSkippedMinute);
    waitMs = minUntil * 60_000;
  }

  waitMs = Math.min(waitMs, MAX_SLEEP_MS);
  if (hasActivePredictions) waitMs = Math.min(waitMs, ACTIVE_CAP_MS);
  return waitMs;
}

let processedMatchIds = [];
let sentTelegramIds = [];
let activePredictions = [];
let noStatsAttempts = [];
let lastResultCheckHour = -1;
let lastHeartbeat = Date.now();
let lastDayKey = dateKeyLocal();
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;

function runLiveWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./worker.js', {
      workerData: { processedMatchIds, sentTelegramIds, activePredictions, noStatsAttempts, lastResultCheckHour },
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
      noStatsAttempts = [];
      lastResultCheckHour = -1;
      lastDayKey = todayKey;
    }

    let result = null;
    try {
      runCount++;
      result = await runLiveWorker();
      console.log(`\n🔥 RUN #${runCount}: analyzed=${result.matchesAnalyzed}, signals=${result.signalsSent}`);

      if (result.processedMatchIds) processedMatchIds = result.processedMatchIds;
      if (result.sentTelegramIds) sentTelegramIds = result.sentTelegramIds;
      if (result.activePredictions) activePredictions = result.activePredictions;
      if (result.noStatsAttempts) noStatsAttempts = result.noStatsAttempts;
      if (result.lastResultCheckHour != null) lastResultCheckHour = result.lastResultCheckHour;
    } catch (e) {
      console.log(`\n❌ RUN #${runCount} FAILED: ${e.message}`);
      // Вбиваємо зомбі Chrome процеси після краша воркера
      try {
        const { execSync } = require('child_process');
        execSync('pkill -9 -f puppeteer_dev_profile 2>/dev/null || true', { stdio: 'ignore' });
      } catch {}
    }

    if (!isContinuous) break;

    await sendHeartbeat(runCount);

    const waitMs = computeNextWaitMs({
      liveDecisionCount:     result?.liveDecisionCount ?? 0,
      liveWarmupCount:       result?.liveWarmupCount ?? 0,
      nearestSkippedMinute:  result?.nearestSkippedMinute ?? null,
      hasActivePredictions:  (result?.activeCount ?? activePredictions.length) > 0,
      defaultMs:             LIVE_POLL_INTERVAL_MS,
    });
    const waitMin = Math.round(waitMs / 60000);
    console.log(`⏳ Next scan in ${waitMin}m...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } while (true);
})();
