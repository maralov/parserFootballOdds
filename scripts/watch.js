'use strict';

require('dotenv').config();

// Prevent macOS from sleeping while watch is running.
// `caffeinate -i -w PID` exits automatically when this Node process exits.
// On non-macOS systems (Linux, Windows) caffeinate won't exist — the spawn
// will fail silently because we detach and unref it.
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

const { runWatch } = require('../src/orchestrator/runWatch');

runWatch().catch((err) => {
  console.error('Fatal watch error:', err);
  process.exit(1);
});
