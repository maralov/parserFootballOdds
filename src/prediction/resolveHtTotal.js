'use strict';

const matchStore = require('../store/matchStore');
const logger = require('../observability/logger');

/**
 * Resolve the htTotal prediction once the final match result is known.
 * Called after matchStore.finalize() has written match.final.
 *
 * Reads predictions.htTotal (phase='predicted'), computes:
 *   total = match.final.totalGoals (or scoreHome + scoreAway)
 *   over15Hit = total >= 2
 *   over25Hit = total >= 3
 *
 * Writes predictions.htTotal.outcome and sets phase='resolved'.
 *
 * @param {string} matchId
 * @param {Date}   [date]
 * @param {Object} [deps]
 * @returns {Object|null}  The outcome object or null if skipped
 */
function resolveHtTotal(matchId, date = new Date(), deps = {}) {
  const store = deps.matchStore || matchStore;

  const match = store.getMatch(matchId, date);
  if (!match) {
    logger.warn('resolveHtTotal: match not found', { matchId });
    return null;
  }

  const htTotal = match.predictions?.htTotal;
  if (!htTotal || htTotal.phase !== 'predicted') {
    // Nothing to resolve (not in scope, already resolved, or still pending)
    return null;
  }

  // Get total goals from final result
  const final = match.final;
  if (!final) {
    logger.warn('resolveHtTotal: no final result on match', { matchId });
    return null;
  }

  const total = final.totalGoals ?? (final.scoreHome + final.scoreAway);
  const over15Hit = total >= 2;
  const over25Hit = total >= 3;

  const outcome = {
    total,
    over15Hit,
    over25Hit,
    resolvedAt: new Date().toISOString(),
  };

  store.setHtTotalDecision(matchId, {
    phase: 'resolved',
    outcome,
  }, date);

  logger.info('resolveHtTotal: resolved', {
    matchId, total, over15Hit, over25Hit,
  });

  return outcome;
}

module.exports = { resolveHtTotal };
