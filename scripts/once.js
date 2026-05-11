'use strict';

require('dotenv').config();
process.env.LIVE_TRACKER_ENABLED = '0';

const { runOnce } = require('../src/orchestrator/runOnce');
const { closeBrowser } = require('../src/fetcher/browserFetcher');

(async () => {
  try {
    await runOnce();
  } finally {
    await closeBrowser();
  }
})();
