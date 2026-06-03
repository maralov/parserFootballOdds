'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const matchStore = require('../src/store/matchStore');

function d(label){ return new Date(`2099-11-${label}T12:00:00.000Z`); }

test('getHydratedSnapshots fills since2H/delta from raw cumulative', () => {
  const date = d('01');
  matchStore.writeStore({ m: {
    matchId: 'm',
    baseline1H: { expectedGoalsXg: { home: 0.1, away: 0.0 } },
    snapshots: [
      { observedMinute: 50, cumulative: { expectedGoalsXg: { home: 0.2, away: 0.1 } } },
      { observedMinute: 60, cumulative: { expectedGoalsXg: { home: 0.5, away: 0.2 } } },
    ],
  }}, date);

  const h = matchStore.getHydratedSnapshots('m', date);
  assert.equal(h[0].delta, null);
  assert.ok(Math.abs(h[1].delta.expectedGoalsXg.home - 0.3) < 1e-9);
  assert.ok(Math.abs(h[1].since2H.expectedGoalsXg.home - 0.4) < 1e-9);
  fs.rmSync(matchStore.dayLogsAbsolute(date), { recursive: true, force: true });
});
