'use strict';

const pLimit     = require('p-limit');
const matchStore = require('../store/matchStore');
const { collectSnapshot1H } = require('./snapshotCollector1H');
const { SNAPSHOT_START_MINUTE_1H } = require('./snapshotCadence1H');
const env        = require('../config/env');
const logger     = require('../observability/logger');

// ─── State ────────────────────────────────────────────────────────────────────
const timers = new Map();  // matchId → Timeout
const seen = new Set();     // matchIds already considered this process (avoid re-enrich)
let limit = null;

function jitterMs() {
  return Math.floor(Math.random() * (env.LIVE_TRACKER_JITTER_MS || 15_000));
}

function _cancel(matchId) {
  const t = timers.get(matchId);
  if (t) { clearTimeout(t); timers.delete(matchId); }
}

function _schedule(matchId, delayMs) {
  _cancel(matchId);
  const actualDelay = Math.max(0, delayMs + jitterMs());
  matchStore.setNextSnapshotAt(matchId, new Date(Date.now() + actualDelay).toISOString());

  const timer = setTimeout(async () => {
    timers.delete(matchId);
    matchStore.setNextSnapshotAt(matchId, null);
    if (!limit) return;
    try {
      const status = await limit(() => collectSnapshot1H(matchId, _schedule));
      if (status === 'handoff_2h') {
        logger.info('trackingScheduler1H: match handed off to 2H track', { matchId });
      }
    } catch (err) {
      logger.error('trackingScheduler1H: unhandled error in collectSnapshot1H', { matchId, err: err.message });
    }
  }, actualDelay);

  if (typeof timer.unref === 'function') timer.unref();
  timers.set(matchId, timer);
  return new Date(Date.now() + actualDelay).toISOString();
}

// ─── Public API ───────────────────────────────────────────────────────────────
function start() {
  const concurrency = env.LIVE_1H_CONCURRENCY || 2;
  limit = pLimit(concurrency);
  logger.info('trackingScheduler1H: started', { concurrency });
}

function stop() {
  for (const [, timer] of timers) clearTimeout(timer);
  timers.clear();
  logger.info('trackingScheduler1H: stopped');
}

/** True if this match was already considered (enriched/attempted) this process. */
function hasSeen(matchId) { return seen.has(matchId); }
function markSeen(matchId) { seen.add(matchId); }
function isTracked(matchId) { return timers.has(matchId); }

/**
 * Register a first-half candidate (enriched, has a favorite) for 1H tracking.
 * @param {Object} enrichedItem  enrichment record (status === 'enriched')
 * @param {Date}   [date]
 */
function register(enrichedItem, date = new Date()) {
  if (!env.LIVE_1H_ENABLED) return;
  if (!limit) start();

  const { matchId } = enrichedItem;
  seen.add(matchId);

  const record = matchStore.upsertFromEnrichment(enrichedItem, date);
  // A 1H candidate at ~15' has no clean baseline1H yet; that's expected. Keep it
  // active for the 1H worker (force active even if upsert marked it discarded for
  // missing baseline1H — baseline1H is backfilled later at halftime).
  if (record.tracking.status === 'discarded'
      && record.tracking.discardReason === 'missing_baseline_1h') {
    record.tracking.status = 'active';
    record.tracking.discardReason = null;
    matchStore.writeStore(matchStore.readStore(date), date);
  } else if (record.tracking.status !== 'active') {
    return;
  }

  if (timers.has(matchId)) return;
  // First snapshot at the 20' bucket (record carries observed minute via discovery).
  const firstDelayMs = typeof enrichedItem.firstDelayMs === 'number'
    ? enrichedItem.firstDelayMs
    : 0;
  const at = _schedule(matchId, firstDelayMs);
  logger.info('trackingScheduler1H: registered', {
    matchId, homeTeam: enrichedItem.homeTeam, awayTeam: enrichedItem.awayTeam, firstSnapshotAt: at,
  });
}

function cancel(matchId) { _cancel(matchId); }
function activeCount() { return timers.size; }

module.exports = {
  start, stop, register, cancel, activeCount,
  hasSeen, markSeen, isTracked,
  SNAPSHOT_START_MINUTE_1H,
};
