'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Directly inspect the PRIMARY_DECISION_KEYS set by requiring dispatcher internals.
// We expose it via a thin helper to avoid needing Telegram credentials at test time.
const dispatcherPath = require.resolve('../src/integrations/telegram/dispatcher');
const src = require('fs').readFileSync(dispatcherPath, 'utf8');

// Extract the PRIMARY_DECISION_KEYS set literal from source to verify its contents
// without executing side-effectful module-level requires (TG client, env, etc).
test('PRIMARY_DECISION_KEYS contains tb05_1h', () => {
  assert.ok(
    src.includes("'tb05_1h'"),
    "dispatcher.js PRIMARY_DECISION_KEYS має містити 'tb05_1h'"
  );
  assert.ok(
    src.includes("new Set(['tm05', 'tb05', 'tm05_1h', 'tb05_1h'])"),
    "PRIMARY_DECISION_KEYS має бути new Set(['tm05', 'tb05', 'tm05_1h', 'tb05_1h'])"
  );
});
