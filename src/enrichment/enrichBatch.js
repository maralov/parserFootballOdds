'use strict';

const pLimit = require('p-limit');
const { enrichOne } = require('./enrichOne');
const env = require('../config/env');
const logger = require('../observability/logger');

/**
 * Enrich a batch of candidates with controlled concurrency.
 * Returns an array of enrichment results in the same order as input.
 *
 * @param {Array<{ matchId, homeTeam, awayTeam, currentStatus }>} candidates
 * @param {number} [cycleId]
 * @returns {Promise<Array<Object>>}
 */
async function enrichBatch(candidates, cycleId) {
  if (!candidates || !candidates.length) return [];

  const concurrency = env.LIVE_ENRICHMENT_CONCURRENCY;
  const limit = pLimit(concurrency);

  process.stdout.write(`\nEnriching ${candidates.length} candidate(s):\n`);

  const tasks = candidates.map(c =>
    limit(() => enrichOne(c))
  );

  const results = await Promise.all(tasks);

  const enriched = results.filter(r => r.status === 'enriched').length;
  const skipped  = results.filter(r => r.status === 'skip:no_stats').length;
  const failed   = results.filter(r => r.status === 'failed').length;

  logger.debug('Enrichment done', { enriched, skipped, failed, cycleId });

  return results;
}

module.exports = { enrichBatch };
