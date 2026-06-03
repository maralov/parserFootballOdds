'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const enrichmentStore = require('../src/store/enrichmentStore');

function d(label){ return new Date(`2099-10-${label}T12:00:00.000Z`); }

test('getEnrichment returns item by matchId or null', () => {
  const date = d('01');
  enrichmentStore.saveEnrichment([{ matchId: 'x', status: 'enriched', h2h: [1] }], date);
  assert.equal(enrichmentStore.getEnrichment('x', date).h2h.length, 1);
  assert.equal(enrichmentStore.getEnrichment('nope', date), null);
});
