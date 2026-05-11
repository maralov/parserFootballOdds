'use strict';

/**
 * tracker-resume.js
 *
 * Manual recovery: re-schedule all active matches from today's matches.json.
 * Use after an unexpected process restart to resume snapshot collection.
 *
 * Usage:
 *   npm run tracker:resume
 */

const trackingScheduler = require('../src/tracker/trackingScheduler');
const matchStore        = require('../src/store/matchStore');
const logger            = require('../src/observability/logger');
const { closeBrowser }  = require('../src/fetcher/browserFetcher');

async function main() {
  const active = matchStore.getActiveMatches();
  console.log(`\ntracker:resume — found ${active.length} active match(es)\n`);

  if (!active.length) {
    console.log('Nothing to resume. Exiting.');
    process.exit(0);
  }

  trackingScheduler.start();
  await trackingScheduler.resume();

  console.log(`\nScheduled ${trackingScheduler.activeCount()} timer(s). Tracker running.\n`);
  console.log('Press Ctrl+C to stop.\n');

  process.on('SIGINT',  async () => { trackingScheduler.stop(); await closeBrowser(); process.exit(0); });
  process.on('SIGTERM', async () => { trackingScheduler.stop(); await closeBrowser(); process.exit(0); });
}

main().catch(err => {
  logger.error('tracker-resume: fatal error', { err: err.message });
  process.exit(1);
});
