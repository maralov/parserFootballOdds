'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const matchStore = require('../src/store/matchStore');
function d(l){ return new Date(`2099-09-${l}T12:00:00.000Z`); }
test('upsertFromEnrichment record omits heavy static fields', () => {
  const date = d('01');
  const rec = matchStore.upsertFromEnrichment({ matchId: 'm', statistics: { '1half': { home:{}, away:{} } }, h2h: [1,2], standings: {x:1} }, date);
  assert.equal(rec.h2h, undefined);
  assert.equal(rec.statistics, undefined);
  assert.equal(rec.standings, undefined);
  assert.ok(rec.baseline1H !== undefined);
  fs.rmSync(matchStore.dayLogsAbsolute(date), { recursive: true, force: true });
});
