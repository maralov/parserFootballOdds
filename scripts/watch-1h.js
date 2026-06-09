'use strict';

// 1HUNDER data-collection runner: runs ONLY the first-half ТМ 0,5 line.
//
//   • enables the 1H pipeline and 1H-only mode
//   • disables the A/B (full-match) tracker so nothing else competes for fetches
//   • settles every 1H bet at halftime (records HT outcome + replies HIT/MISS)
//
// Usage:  npm run watch-1h
//
// Env is forced HERE, before src/config/env.js is required (it snapshots
// process.env at require time), so these win over .env values.

require('dotenv').config();

process.env.LIVE_1H_ENABLED = '1';
process.env.LIVE_1H_ONLY = '1';
process.env.LIVE_TRACKER_ENABLED = '0';
// Enrichment is required to discover the favorite for 1H candidates.
if (process.env.LIVE_ENRICHMENT_ENABLED == null) {
  process.env.LIVE_ENRICHMENT_ENABLED = '1';
}

// Prevent macOS from sleeping while the collector is running.
(function preventSleep() {
  try {
    const { spawn } = require('child_process');
    const proc = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      detached: true,
      stdio:    'ignore',
    });
    proc.unref();
  } catch (_) {
    // caffeinate not available on this platform — ignore
  }
})();

const logger = require('../src/observability/logger');
logger.info('watch-1h: starting in 1HUNDER-only data-collection mode');

const { runWatch } = require('../src/orchestrator/runWatch');

runWatch().catch((err) => {
  console.error('Fatal watch-1h error:', err);
  process.exit(1);
});
