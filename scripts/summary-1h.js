'use strict';

// Send the end-of-day 1HUNDER summary to Telegram (signals, HIT/MISS, dry-rate,
// ROI@2.0) built from the day's tg-outbox.
//
// Usage:
//   node scripts/summary-1h.js            # today
//   node scripts/summary-1h.js 2026-06-13 # a specific day (YYYY-MM-DD)
//
// Schedule it (cron/launchd) just after the slate ends, or run manually.

require('dotenv').config();

const tgDispatcher = require('../src/integrations/telegram/dispatcher');
const logger = require('../src/observability/logger');

(async () => {
  const arg = process.argv[2];
  const date = arg ? new Date(`${arg}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) {
    console.error(`Invalid date: ${arg} (expected YYYY-MM-DD)`);
    process.exit(1);
  }

  try {
    const result = await tgDispatcher.dispatchDaySummary({ date });
    if (!result) {
      console.log('No 1HUNDER signals for that day — nothing sent.');
    } else if (result.ok) {
      console.log('Day summary sent.');
    } else {
      console.error('Send failed:', result.error);
      process.exit(1);
    }
  } catch (err) {
    logger.warn('summary-1h: error', { err: err?.message || String(err) });
    console.error('Fatal:', err);
    process.exit(1);
  }
})();
