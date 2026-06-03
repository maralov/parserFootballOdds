'use strict';

const fs   = require('fs');
const path = require('path');
const { dateKeyLocal, toISO } = require('../helpers/date');
const { CUMULATIVE_STAT_FIELDS } = require('../tracker/deltaCalculator');
const { hydrateAll } = require('../tracker/snapshotHydrator');
const logger = require('../observability/logger');

const DATA_ROOT = path.resolve(__dirname, '../../data/logs');

const DEBOUNCE_MS = Math.max(0, Number(process.env.MATCHSTORE_DEBOUNCE_MS) || 2500);

const cache = new Map();    // dateKey → store object
const dirty = new Set();    // dateKey for entries pending flush
const timers = new Map();   // dateKey → setTimeout handle

function dateKey(date) {
  return dateKeyLocal(date);
}

function pathForDateKey(key) {
  return path.join(DATA_ROOT, key, 'matches.json');
}

function writeStoreToDisk(store, key) {
  const dir = path.join(DATA_ROOT, key);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'matches.json');
  const tmp = target + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    logger.warn('matchStore: write failed', { err: e.message });
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    return false;
  }
}

function loadFromDisk(key) {
  const file = pathForDateKey(key);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    logger.warn('matchStore: failed to parse, starting fresh', { file, err: e.message });
    return {};
  }
}

function flushSync(date = new Date()) {
  const key = dateKey(date);
  const t = timers.get(key);
  if (t) { clearTimeout(t); timers.delete(key); }
  // Not dirty = already persisted (or nothing ever written); treat as success.
  if (!dirty.has(key)) return cache.has(key) ? true : false;
  const store = cache.get(key);
  if (!store) { dirty.delete(key); return false; }
  const ok = writeStoreToDisk(store, key);
  if (ok) dirty.delete(key);
  return ok;
}

function flushAll() {
  for (const key of Array.from(dirty)) {
    const t = timers.get(key);
    if (t) { clearTimeout(t); timers.delete(key); }
    const store = cache.get(key);
    if (store) writeStoreToDisk(store, key);
    dirty.delete(key);
  }
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
  const key = dateKey(date);
  let store = cache.get(key);
  if (!store) {
    store = loadFromDisk(key);
    cache.set(key, store);
  }
  return store;
}

function writeStore(store, date = new Date()) {
  const key = dateKey(date);
  cache.set(key, store);
  dirty.add(key);

  if (DEBOUNCE_MS <= 0) {
    return flushSync(date);
  }

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(key);
    flushSync(date);
  }, DEBOUNCE_MS);
  if (typeof t.unref === 'function') t.unref();
  timers.set(key, t);
  return true;
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
    // Already registered — don't overwrite existing tracking state
    return store[enrichedItem.matchId];
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

    baseline1H,

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
    predictions: { tm05: null, tb05: null },
  };

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
  match.tracking.status         = 'finished';
  match.tracking.nextSnapshotAt = null;

  if (final.firstGoalMinute != null && match.tracking.firstGoalMinute === null) {
    match.tracking.firstGoalMinute = final.firstGoalMinute;
  }

  writeStore(store, date);
  const persisted = flushSync(date);

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


function setTrackDecision(matchId, track, payload, date = new Date()) {
  if (track !== 'tm05' && track !== 'tb05') {
    logger.warn('matchStore.setTrackDecision: invalid track', { matchId, track });
    return null;
  }
  const store = readStore(date);
  const match = store[matchId];
  if (!match) {
    logger.warn('matchStore.setTrackDecision: match not found', { matchId, track });
    return null;
  }
  if (!match.predictions) match.predictions = { tm05: null, tb05: null };
  // Merge so intermediate phases (e.g. ds_computed) are preserved alongside later updates
  match.predictions[track] = { ...(match.predictions[track] || {}), ...payload };
  writeStore(store, date);
  return match.predictions[track];
}

function setTm05Decision(matchId, payload, date = new Date()) {
  return setTrackDecision(matchId, 'tm05', payload, date);
}

function setTb05Decision(matchId, payload, date = new Date()) {
  return setTrackDecision(matchId, 'tb05', payload, date);
}

function getTrackDecision(matchId, track, date = new Date()) {
  const match = getMatch(matchId, date);
  return match?.predictions?.[track] || null;
}

function getHydratedSnapshots(matchId, date = new Date()) {
  const match = getMatch(matchId, date);
  if (!match) return [];
  return hydrateAll(match.snapshots || [], match.baseline1H);
}

function getLastHydratedSnapshot(matchId, date = new Date()) {
  const h = getHydratedSnapshots(matchId, date);
  return h.length ? h[h.length - 1] : null;
}

if (!global.__matchStoreExitHandlerRegistered) {
  global.__matchStoreExitHandlerRegistered = true;
  process.on('exit', () => {
    try { flushAll(); } catch (_) { /* exit-handler best-effort */ }
  });
}

module.exports = {
  readStore,
  writeStore,
  flushSync,
  flushAll,
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
  dayLogsAbsolute,
  setTm05Decision,
  setTb05Decision,
  getTrackDecision,
  getHydratedSnapshots,
  getLastHydratedSnapshot,
};
