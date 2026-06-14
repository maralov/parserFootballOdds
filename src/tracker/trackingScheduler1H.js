'use strict';

const pLimit     = require('p-limit');
const matchStore = require('../store/matchStore');
const { collectSnapshot1H } = require('./snapshotCollector1H');
const { SNAPSHOT_START_MINUTE_1H } = require('./snapshotCadence1H');
const env        = require('../config/env');
const logger     = require('../observability/logger');

// ─── State ────────────────────────────────────────────────────────────────────
const timers = new Map();  // matchId → Timeout
const dates  = new Map();   // matchId → Date (the match's opening day; pins the store dir)
const seen = new Set();     // matchIds already considered this process (avoid re-enrich)
let limit = null;

function jitterMs() {
  return Math.floor(Math.random() * (env.LIVE_TRACKER_JITTER_MS || 15_000));
}

function _cancel(matchId) {
  const t = timers.get(matchId);
  if (t) { clearTimeout(t); timers.delete(matchId); }
  dates.delete(matchId);
}

function _schedule(matchId, delayMs) {
  // Pin the store directory to the match's opening day so timers that fire
  // after midnight don't look the match up in the (empty) next-day store.
  // Read it before _cancel (which clears the dates entry).
  const date = dates.get(matchId);
  _cancel(matchId);
  if (date) dates.set(matchId, date);
  const actualDelay = Math.max(0, delayMs + jitterMs());
  matchStore.setNextSnapshotAt(matchId, new Date(Date.now() + actualDelay).toISOString(), date);

  const timer = setTimeout(async () => {
    timers.delete(matchId);
    matchStore.setNextSnapshotAt(matchId, null, date);
    if (!limit) return;
    try {
      const status = await limit(() => collectSnapshot1H(matchId, _schedule, date));
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
  dates.clear();
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
  dates.set(matchId, date);

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
    dates.delete(matchId);
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

/**
 * Restart-safe: re-arm snapshot timers for every still-active match from today's
 * store. Without this, a process restart orphans in-flight 1H matches (their
 * in-memory timers are lost) and they never settle at halftime.
 *
 * @param {Date} [date]
 * @returns {number} how many matches were re-scheduled
 */
function resume(date = new Date()) {
  if (!env.LIVE_1H_ENABLED) return 0;
  if (!limit) start();

  const active = matchStore.getActiveMatches(date);
  let resumed = 0;
  for (const match of active) {
    const { matchId } = match;
    if (timers.has(matchId)) continue; // already scheduled
    seen.add(matchId);

    const nextAt = match.tracking?.nextSnapshotAt
      ? new Date(match.tracking.nextSnapshotAt).getTime()
      : Date.now();
    _schedule(matchId, Math.max(0, nextAt - Date.now()));
    resumed += 1;
    logger.info('trackingScheduler1H: resumed', {
      matchId, homeTeam: match.homeTeam, awayTeam: match.awayTeam,
    });
  }
  if (resumed) logger.info('trackingScheduler1H: resume complete', { resumed });
  return resumed;
}

module.exports = {
  start, stop, register, resume, cancel, activeCount,
  hasSeen, markSeen, isTracked,
  SNAPSHOT_START_MINUTE_1H,
};
