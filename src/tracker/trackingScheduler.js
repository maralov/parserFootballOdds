'use strict';

const pLimit      = require('p-limit');
const matchStore  = require('../store/matchStore');
const { collectSnapshot } = require('./snapshotCollector');
const env         = require('../config/env');
const logger      = require('../observability/logger');

// ─── State ────────────────────────────────────────────────────────────────────

/** Map<matchId, NodeJS.Timeout> — active timers */
const timers = new Map();

/** Concurrency limiter shared across all snapshot fetches */
let limit = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jitterMs() {
  const j = env.LIVE_TRACKER_JITTER_MS || 15_000;
  return Math.floor(Math.random() * j);
}

function clampDelay(ms) {
  return Math.max(0, ms);
}

// ─── Core scheduler ──────────────────────────────────────────────────────────

/**
 * Schedule a snapshot for matchId after `delayMs` (with ±jitter).
 * Cancels any existing timer for this matchId first.
 *
 * @param {string} matchId
 * @param {number} delayMs
 */
function _schedule(matchId, delayMs) {
  _cancel(matchId);
  const actualDelay = clampDelay(delayMs + jitterMs());
  const scheduledAt = new Date(Date.now() + actualDelay).toISOString();

  matchStore.setNextSnapshotAt(matchId, scheduledAt);

  const timer = setTimeout(async () => {
    timers.delete(matchId);
    matchStore.setNextSnapshotAt(matchId, null);
    if (!limit) return;

    try {
      await limit(() => collectSnapshot(matchId, _schedule));
    } catch (err) {
      logger.error('trackingScheduler: unhandled error in collectSnapshot', {
        matchId, err: err.message,
      });
    }
  }, actualDelay);

  timers.set(matchId, timer);
  logger.debug('trackingScheduler: scheduled', {
    matchId, delayMs: actualDelay, at: scheduledAt,
  });

  return scheduledAt;
}

function _cancel(matchId) {
  const existing = timers.get(matchId);
  if (existing) {
    clearTimeout(existing);
    timers.delete(matchId);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the scheduler. Must be called once before register().
 */
function start() {
  const concurrency = env.LIVE_TRACKER_CONCURRENCY || 2;
  limit = pLimit(concurrency);
  logger.info('trackingScheduler: started', { concurrency });
}

/**
 * Stop all active timers. Called on graceful shutdown.
 */
function stop() {
  for (const [matchId, timer] of timers) {
    clearTimeout(timer);
    logger.debug('trackingScheduler: cancelled on stop', { matchId });
  }
  timers.clear();
  logger.info('trackingScheduler: stopped');
}

/**
 * Register a newly enriched candidate for tracking.
 * Creates the match record in matchStore and schedules the first snapshot.
 *
 * @param {Object} enrichedItem  enrichment record (status === 'enriched')
 * @param {Date}   [date]
 */
function register(enrichedItem, date = new Date()) {
  if (!env.LIVE_TRACKER_ENABLED) return;
  if (!limit) {
    logger.warn('trackingScheduler: register called before start(), skipping scheduling', {
      matchId: enrichedItem?.matchId,
    });
    return;
  }

  const { matchId } = enrichedItem;

  // Persist record
  const record = matchStore.upsertFromEnrichment(enrichedItem, date);

  if (record.tracking.status !== 'active') {
    logger.debug('trackingScheduler: match already finished/discarded, skipping', {
      matchId, status: record.tracking.status,
    });
    return;
  }

  // If already has a timer (e.g. duplicate call) — don't re-register
  if (timers.has(matchId)) return;

  const nextAt = record.tracking.nextSnapshotAt
    ? new Date(record.tracking.nextSnapshotAt).getTime()
    : Date.now();
  const delayMs = Math.max(0, nextAt - Date.now());
  const scheduledAt = _schedule(matchId, delayMs);

  logger.info('trackingScheduler: registered', {
    matchId,
    homeTeam: enrichedItem.homeTeam,
    awayTeam: enrichedItem.awayTeam,
    firstSnapshotAt: scheduledAt,
  });
}

/**
 * Re-schedule all active matches from today's matches.json.
 * Restart-safe: called on process start to resume interrupted tracking.
 *
 * @param {Date} [date]
 */
async function resume(date = new Date()) {
  if (!env.LIVE_TRACKER_ENABLED) return;
  if (!limit) start();

  const activeMatches = matchStore.getActiveMatches(date);
  if (!activeMatches.length) return;

  logger.info('trackingScheduler: resuming active matches', { count: activeMatches.length });

  for (const match of activeMatches) {
    const { matchId } = match;

    if (timers.has(matchId)) continue; // already scheduled

    // Use nextSnapshotAt if available, else schedule immediately (catch-up)
    const nextAt = match.tracking.nextSnapshotAt
      ? new Date(match.tracking.nextSnapshotAt).getTime()
      : Date.now();

    const delayMs = Math.max(0, nextAt - Date.now());
    _schedule(matchId, delayMs);

    logger.info('trackingScheduler: resumed', {
      matchId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      delayMs,
    });
  }
}

/**
 * Cancel tracking for a specific match (e.g. after discard).
 * @param {string} matchId
 */
function cancel(matchId) {
  _cancel(matchId);
}

/**
 * Number of currently active timers (for observability).
 * @returns {number}
 */
function activeCount() {
  return timers.size;
}

module.exports = { start, stop, register, resume, cancel, activeCount };
