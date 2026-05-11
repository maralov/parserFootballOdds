'use strict';

require('dotenv').config();

const { readStore } = require('../src/store/datasetStore');
const { readEnrichmentStore, getPendingMatchIds, saveEnrichment } = require('../src/store/enrichmentStore');
const { enrichBatch } = require('../src/enrichment/enrichBatch');
const { closeBrowser } = require('../src/fetcher/browserFetcher');
const logger = require('../src/observability/logger');

(async () => {
  const pendingIds = getPendingMatchIds();

  if (!pendingIds.length) {
    console.log('No failed/pending enrichments for today.');
    process.exit(0);
  }

  logger.info('Enrich retry', { count: pendingIds.length, ids: pendingIds });

  // Read raw candidates from today's dataset to get team names
  const raw = readStore();
  const candidatesList = raw.candidates || [];
  const byId = Object.fromEntries(candidatesList.map(c => [c.matchId, c]));
  const candidates = pendingIds.map(id => byId[id]).filter(Boolean);

  if (!candidates.length) {
    console.log('Candidates not found in today\'s dataset.');
    process.exit(1);
  }

  try {
    const results = await enrichBatch(candidates);
    const saveResult = saveEnrichment(results);
    console.log(`Retry done: ${saveResult.written} written, ${saveResult.skipped} skipped`);
  } finally {
    await closeBrowser();
  }
})();
