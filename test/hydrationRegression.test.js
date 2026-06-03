'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hydrateAll } = require('../src/tracker/snapshotHydrator');

// Hand-built fixture mirroring real shape (avoids depending on git-removed data).
const baseline1H = { shotsOnTarget: { home: 1, away: 0 } };
const raw = [
  { observedMinute: 50, cumulative: { shotsOnTarget: { home: 2, away: 1 } } },
  { observedMinute: 60, cumulative: { shotsOnTarget: { home: 4, away: 2 } } },
];
// Expected matches old subtractStats semantics.
test('hydrated since2H/delta match subtractStats semantics', () => {
  const h = hydrateAll(raw, baseline1H);
  assert.equal(h[1].since2H.shotsOnTarget.home, 3); // 4-1
  assert.equal(h[1].delta.shotsOnTarget.home, 2);   // 4-2
});
