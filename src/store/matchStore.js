'use strict';

const fs   = require('fs');
const path = require('path');
const { dateKeyLocal, toISO } = require('../helpers/date');
const { computeDerived } = require('../tracker/derivedFields');
const { CUMULATIVE_STAT_FIELDS } = require('../tracker/deltaCalculator');
const { applyPredictionHits } = require('./predictionAuditResolver');
const predictionSignals = require('./predictionSignals');
const logger = require('../observability/logger');

const DATA_ROOT = path.resolve(__dirname, '../../data/logs');

function round(value, digits = 6) {
  return Math.round(value * (10 ** digits)) / (10 ** digits);
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function dayDir(date) {
  const key = dateKeyLocal(date);
  const dir = path.join(DATA_ROOT, key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function matchesFile(date) {
  return path.join(dayDir(date), 'matches.json');
}

/** Absolute folder for dated logs (`data/logs/YYYY-MM-DD`). */
function dayLogsAbsolute(date = new Date()) {
  return dayDir(date);
}

// ─── Read / Write ─────────────────────────────────────────────────────────────

/**
 * Read today's match store. Returns empty object if file missing.
 * @param {Date} [date]
 * @returns {{ [matchId: string]: Object }}
 */
function readStore(date = new Date()) {
  const file = matchesFile(date);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    logger.warn('matchStore: failed to parse, starting fresh', { file, err: e.message });
    return {};
  }
}

function writeStore(store, date = new Date()) {
  try {
    fs.writeFileSync(matchesFile(date), JSON.stringify(store, null, 2), 'utf8');
    return true;
  } catch (e) {
    logger.warn('matchStore: write failed', { err: e.message });
    return false;
  }
}

// ─── baseline1H builder ───────────────────────────────────────────────────────

/**
 * Extract baseline1H from enrichment statistics.
 * Converts flat `{home, away}` per-field objects into `{ field: { home, away } }` map.
 *
 * @param {Object} statistics  enrichment.statistics
 * @returns {Object|null}
 */
function buildBaseline1H(statistics) {
  if (!statistics || !statistics['1half']) return null;
  const { home = {}, away = {} } = statistics['1half'];

  const result = {};
  for (const f of CUMULATIVE_STAT_FIELDS) {
    result[f] = {
      home: home[f] != null ? home[f] : null,
      away: away[f] != null ? away[f] : null,
    };
  }
  if (home.ballPossession != null || away.ballPossession != null) {
    result.ballPossession = {
      home: home.ballPossession != null ? home.ballPossession : null,
      away: away.ballPossession != null ? away.ballPossession : null,
    };
  }
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create (or skip if already exists) a match record from enrichment data.
 * Called by trackingScheduler.register().
 *
 * @param {Object} enrichedItem  enrichment record with status === 'enriched'
 * @param {Date}   [date]
 */
function upsertFromEnrichment(enrichedItem, date = new Date()) {
  const store = readStore(date);

  if (store[enrichedItem.matchId]) {
    const existing = store[enrichedItem.matchId];
    if (!existing.derived) {
      existing.derived = computeDerived(existing);
      writeStore(store, date);
    }
    // Already registered — don't overwrite existing tracking state
    return existing;
  }

  const baseline1H = buildBaseline1H(enrichedItem.statistics);

  if (!baseline1H) {
    logger.info('matchStore: match discarded — missing baseline1H', { matchId: enrichedItem.matchId });
  }

  const record = {
    matchId:      enrichedItem.matchId,
    country:      enrichedItem.country      || null,
    league:       enrichedItem.league       || null,
    homeTeam:     enrichedItem.homeTeam     || null,
    awayTeam:     enrichedItem.awayTeam     || null,
    matchUrl:     enrichedItem.matchUrl     || null,
    discoveredAt: enrichedItem.discoveredAt || null,
    enrichedAt:   enrichedItem.enrichedAt   || toISO(),

    odds:       enrichedItem.odds      || null,
    statsLevel: enrichedItem.statsLevel || null,

    statistics:      enrichedItem.statistics || null,
    enrichmentTabs: enrichedItem.tabs       || null,

    baseline1H,

    standings: enrichedItem.standings || null,
    h2h:       enrichedItem.h2h       || null,

    tracking: {
      status:             baseline1H ? 'active' : 'discarded',
      discardReason:      baseline1H ? null : 'missing_baseline_1h',
      validForPrediction: false,
      firstGoalMinute:    null,
      nextSnapshotAt:     null,
      snapshotCount:      0,
      failureCount:       0,
    },

    snapshots: [],
    final: null,
    derived: null,
    aiAnalysis: null,
    computed: null,
    predictions: null,
    predictionLocks: null,
  };

  record.derived = computeDerived(record);

  store[enrichedItem.matchId] = record;
  writeStore(store, date);
  return record;
}

/**
 * Append one snapshot to a match record.
 * Updates nextSnapshotAt and snapshotCount. Tracks firstGoalMinute.
 *
 * @param {string} matchId
 * @param {Object} snapshot  Snapshot record (minute, scoreHome, scoreAway, cumulative, since2H, delta, ...)
 * @param {string} [nextSnapshotAt]  ISO timestamp for the next scheduled snapshot
 * @param {Date}   [date]
 */
function appendSnapshot(matchId, snapshot, nextSnapshotAt = null, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) {
    logger.warn('matchStore.appendSnapshot: match not found', { matchId });
    return null;
  }

  // Track first goal minute from score change
  if (
    match.tracking.firstGoalMinute === null &&
    (snapshot.scoreHome + snapshot.scoreAway) > 0
  ) {
    match.tracking.firstGoalMinute = snapshot.observedMinute ?? snapshot.minute;
  }

  // validForPrediction: once we reach 60' with 0:0
  if (
    snapshot.minute >= 60 &&
    snapshot.scoreHome === 0 &&
    snapshot.scoreAway === 0 &&
    !match.tracking.validForPrediction
  ) {
    match.tracking.validForPrediction = true;
  }

  match.snapshots.push(snapshot);
  match.tracking.snapshotCount = match.snapshots.length;
  match.tracking.nextSnapshotAt = nextSnapshotAt;
  match.tracking.failureCount = 0;

  writeStore(store, date);
  return match;
}

function setNextSnapshotAt(matchId, nextSnapshotAt, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) {
    logger.warn('matchStore.setNextSnapshotAt: match not found', { matchId, nextSnapshotAt });
    return null;
  }

  match.tracking.nextSnapshotAt = nextSnapshotAt;
  writeStore(store, date);
  return match.tracking.nextSnapshotAt;
}

/**
 * Mark a match as discarded (goal before discard minute threshold).
 * @param {string} matchId
 * @param {string} [reason]
 * @param {Date}   [date]
 */
function markDiscarded(matchId, reason = 'goal_before_60', date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) return;

  match.tracking.status        = 'discarded';
  match.tracking.discardReason = reason;
  match.tracking.nextSnapshotAt = null;

  writeStore(store, date);
  logger.info('matchStore: discarded', { matchId, reason });
}

/**
 * Mark a match as validForPrediction (0:0 reached the 60' threshold).
 * @param {string} matchId
 * @param {Date}   [date]
 */
function markValid(matchId, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) return;
  if (match.tracking.validForPrediction) return;

  match.tracking.validForPrediction = true;
  writeStore(store, date);
}

/**
 * Increment failure counter; mark stale if max reached.
 * @param {string} matchId
 * @param {number} maxFailures
 * @param {Date}   [date]
 */
function recordFailure(matchId, maxFailures = 3, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) return;

  match.tracking.failureCount = (match.tracking.failureCount || 0) + 1;

  if (match.tracking.failureCount >= maxFailures) {
    match.tracking.status = 'stale';
    match.tracking.nextSnapshotAt = null;
    logger.warn('matchStore: too many failures, marking stale', { matchId });
  }

  writeStore(store, date);
}

/**
 * Mark a match as stale (hard timeout or unexpected state).
 * @param {string} matchId
 * @param {string} [reason]
 * @param {Date}   [date]
 */
function markStale(matchId, reason = 'timeout', date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) return;

  match.tracking.status = 'stale';
  match.tracking.discardReason = reason;
  match.tracking.nextSnapshotAt = null;

  writeStore(store, date);
  logger.warn('matchStore: stale', { matchId, reason });
}

/**
 * Finalize a match with final result + derived fields.
 * Sets tracking.status = 'finished'.
 *
 * @param {string} matchId
 * @param {Object} final    Final record (scoreHome, scoreAway, goals[], ...)
 * @param {Object} derived  Derived computed fields
 * @param {Date}   [date]
 */
function finalize(matchId, final, derived, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) {
    logger.warn('matchStore.finalize: match not found', { matchId });
    return null;
  }

  match.final   = final;
  match.derived = derived;
  applyPredictionHits(match);
  predictionSignals.attachFinalResult(dayDir(date), match);
  match.tracking.status         = 'finished';
  match.tracking.nextSnapshotAt = null;

  if (final.firstGoalMinute != null && match.tracking.firstGoalMinute === null) {
    match.tracking.firstGoalMinute = final.firstGoalMinute;
  }

  const persisted = writeStore(store, date);

  if (persisted) {
    setImmediate(() => {
      try {
        const tgDispatcher = require('../integrations/telegram/dispatcher');
        tgDispatcher.dispatchResults({ match, date }).catch((err) => {
          logger.warn('tg.result.enqueue_unhandled', {
            matchId,
            err: err?.message || String(err),
          });
        });
      } catch (err) {
        logger.warn('tg.result.enqueue_unhandled', {
          matchId,
          err: err?.message || String(err),
        });
      }
    });
  }

  return match;
}

/**
 * Get a single match record.
 * @param {string} matchId
 * @param {Date}   [date]
 */
function getMatch(matchId, date = new Date()) {
  const store = readStore(date);
  return store[matchId] || null;
}

/**
 * Return all matches with tracking.status === 'active'.
 * @param {Date} [date]
 * @returns {Object[]}
 */
function getActiveMatches(date = new Date()) {
  const store = readStore(date);
  return Object.values(store).filter(m => m.tracking?.status === 'active');
}

/**
 * Return the last snapshot for a match (or null if none yet).
 * @param {string} matchId
 * @param {Date}   [date]
 */
function getLastSnapshot(matchId, date = new Date()) {
  const match = getMatch(matchId, date);
  if (!match || !match.snapshots.length) return null;
  return match.snapshots[match.snapshots.length - 1];
}

function setAiAnalysis(matchId, checkpoint, data, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) {
    logger.warn('matchStore.setAiAnalysis: match not found', { matchId, checkpoint });
    return null;
  }

  if (!match.aiAnalysis) {
    match.aiAnalysis = {
      halftime: undefined,
      decision60: undefined,
      decision80: undefined,
      totalCostUsd: 0,
      requestCount: 0,
    };
  }

  const previous = match.aiAnalysis[checkpoint];
  match.aiAnalysis[checkpoint] = data;

  if (data?.costUsd != null) {
    const previousCost = previous?.costUsd || 0;
    match.aiAnalysis.totalCostUsd = round(
      (match.aiAnalysis.totalCostUsd || 0) - previousCost + data.costUsd,
    );
  }

  if (!previous && data && !data.pending) {
    match.aiAnalysis.requestCount = (match.aiAnalysis.requestCount || 0) + 1;
  } else if (previous?.pending && !data?.pending) {
    match.aiAnalysis.requestCount = (match.aiAnalysis.requestCount || 0) || 1;
  } else if (data?.pending && !previous) {
    match.aiAnalysis.requestCount = (match.aiAnalysis.requestCount || 0) + 1;
  }

  writeStore(store, date);
  return match.aiAnalysis;
}

function hasAiCheckpoint(matchId, checkpoint, date = new Date()) {
  const match = getMatch(matchId, date);
  return Boolean(match?.aiAnalysis && Object.prototype.hasOwnProperty.call(match.aiAnalysis, checkpoint)
    && match.aiAnalysis[checkpoint] !== undefined);
}

function ensurePredictionShell(matchId, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) return;
  match.predictions = match.predictions || {
    decision60: null,
    decision80: null,
  };
  if (!Object.prototype.hasOwnProperty.call(match, 'predictionLocks')) {
    match.predictionLocks = null;
  }
  if (!Object.prototype.hasOwnProperty.call(match, 'computed')) {
    match.computed = null;
  }
  writeStore(store, date);
}

/** @param {'decision60'|'decision80'} checkpoint */
function setPrediction(matchId, checkpoint, payload, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) {
    logger.warn('matchStore.setPrediction: match missing', { matchId, checkpoint });
    return null;
  }
  ensurePredictionShell(matchId, date);
  if (!match.predictions) match.predictions = { decision60: null, decision80: null };
  match.predictions[checkpoint] = payload;
  writeStore(store, date);
  return payload;
}

function setComputed(matchId, computedSnapshot, date = new Date()) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) return null;
  match.computed = computedSnapshot;
  writeStore(store, date);
  return computedSnapshot;
}

function ensurePredictionLocks(matchId, date = new Date(), blockTb = true) {
  const store = readStore(date);
  const match = store[matchId];
  if (!match) return;
  if (!blockTb) return;
  match.predictionLocks = match.predictionLocks || {};
  match.predictionLocks.blockTb80Plus = true;
  match.predictionLocks.reason = match.predictionLocks.reason || 'ft_tm05_from_6075_signal_was_issued';
  match.predictionLocks.createdAt = match.predictionLocks.createdAt || new Date().toISOString();
  writeStore(store, date);
}

module.exports = {
  readStore,
  writeStore,
  upsertFromEnrichment,
  appendSnapshot,
  markDiscarded,
  markValid,
  recordFailure,
  markStale,
  finalize,
  getMatch,
  getActiveMatches,
  getLastSnapshot,
  setNextSnapshotAt,
  setAiAnalysis,
  hasAiCheckpoint,
  dayLogsAbsolute,
  setPrediction,
  setComputed,
  ensurePredictionShell,
  ensurePredictionLocks,
};
