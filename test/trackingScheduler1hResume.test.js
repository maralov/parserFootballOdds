'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Resume must re-arm timers for active matches after a restart. We avoid real
// timers/store by stubbing env + matchStore via the module cache before require.
const Module = require('module');
const origResolve = Module._resolveFilename;

function withStubs({ enabled, active }, fn) {
  const envPath = require.resolve('../src/config/env');
  const storePath = require.resolve('../src/store/matchStore');
  const schedPath = require.resolve('../src/tracker/trackingScheduler1H');

  const realEnv = require('../src/config/env');
  const envStub = { ...realEnv, LIVE_1H_ENABLED: enabled, LIVE_1H_CONCURRENCY: 2, LIVE_TRACKER_JITTER_MS: 0 };
  const storeStub = {
    getActiveMatches: () => active,
    setNextSnapshotAt: () => {},
    getMatch: () => null,
  };

  delete require.cache[schedPath];
  require.cache[envPath] = { id: envPath, filename: envPath, loaded: true, exports: envStub };
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: storeStub };

  try {
    const sched = require('../src/tracker/trackingScheduler1H');
    return fn(sched);
  } finally {
    sched_cleanup(schedPath, envPath, storePath);
  }
}

function sched_cleanup(schedPath, envPath, storePath) {
  try { require('../src/tracker/trackingScheduler1H').stop(); } catch (_) {}
  delete require.cache[schedPath];
  delete require.cache[envPath];
  delete require.cache[storePath];
}

test('resume re-arms timers for active matches', () => {
  withStubs({
    enabled: true,
    active: [
      { matchId: 'a', homeTeam: 'H', awayTeam: 'A', tracking: { nextSnapshotAt: null } },
      { matchId: 'b', homeTeam: 'H', awayTeam: 'A', tracking: { nextSnapshotAt: null } },
    ],
  }, (sched) => {
    sched.start();
    const n = sched.resume();
    assert.equal(n, 2);
    assert.equal(sched.activeCount(), 2);
    assert.equal(sched.isTracked('a'), true);
  });
});

test('resume is a no-op when 1H disabled', () => {
  withStubs({ enabled: false, active: [{ matchId: 'a', tracking: {} }] }, (sched) => {
    const n = sched.resume();
    assert.equal(n, 0);
  });
});

test('resume does not double-schedule already-tracked matches', () => {
  withStubs({
    enabled: true,
    active: [{ matchId: 'a', homeTeam: 'H', awayTeam: 'A', tracking: { nextSnapshotAt: null } }],
  }, (sched) => {
    sched.start();
    assert.equal(sched.resume(), 1);
    assert.equal(sched.resume(), 0); // second call: already scheduled
    assert.equal(sched.activeCount(), 1);
  });
});

// keep linter happy: origResolve referenced (reserved for future deep stubbing)
void origResolve;
