'use strict';

const { runOnce } = require('./runOnce');
const { closeBrowser } = require('../fetcher/browserFetcher');
const { hour } = require('../helpers/date');
const { printWatchHeader, printOutsideHours, printShutdown } = require('../observability/display');
const trackingScheduler = require('../tracker/trackingScheduler');
const logger = require('../observability/logger');
const env = require('../config/env');
const dayjs = require('dayjs');

function isWithinWorkingHours() {
  if (env.LIVE_IGNORE_HOURS) return true;
  const h = hour();
  return h >= env.LIVE_WORKING_HOURS_START && h < env.LIVE_WORKING_HOURS_END;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWatch() {
  let running = true;

  async function shutdown() {
    printShutdown();
    running = false;
    trackingScheduler.stop();
    await closeBrowser();
    process.exit(0);
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // Stage 3: start tracker and resume any active matches from today's matches.json
  if (env.LIVE_TRACKER_ENABLED) {
    trackingScheduler.start();
    await trackingScheduler.resume();
  }

  if (env.LIVE_TG_ENABLED) {
    try {
      const tgDispatcher = require('../integrations/telegram/dispatcher');
      const flushResult = await tgDispatcher.flushPending({ date: new Date() });
      logger.info('tg.flush.startup', {
        entries: flushResult.entries.length,
        results: flushResult.results.length,
      });
    } catch (err) {
      logger.warn('tg.flush.startup_error', { err: err.message });
    }
  }

  const workingHours = env.LIVE_IGNORE_HOURS
    ? '24/7'
    : `${env.LIVE_WORKING_HOURS_START}:00 – ${env.LIVE_WORKING_HOURS_END}:00`;

  printWatchHeader(env.LIVE_BASE_URL, workingHours);

  while (running) {
    if (!isWithinWorkingHours()) {
      const nextCheckAt = dayjs().add(5, 'minute').format('HH:mm');
      printOutsideHours(nextCheckAt);
      await sleep(5 * 60_000);
      continue;
    }

    const result = await runOnce();
    if (!running) break;
    await sleep(result.sleepMs);
  }
}

module.exports = { runWatch };
