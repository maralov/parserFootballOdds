'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../observability/logger');

/**
 * FSM contract:
 *
 * queued ─enqueue──┐
 *    │             │
 *    │             ▼
 *    │       (caller calls dispatcher.flushEntries → sendMessage)
 *    │             │
 *    │             ├─ ok ────► markEntrySent ──► pending_result
 *    │             │
 *    │             └─ fail ──► markEntryFailed (attempts++) ─┐
 *    │                                                       │
 *    │                                ┌──────────────────────┘
 *    │                                ▼
 *    │                         (retry next cycle, status stays 'queued')
 *    │                                │
 *    │                                └─ if attempts >= MAX ──► setStatus('failed')
 *    │
 *    ▼
 * pending_result ─finalize hook──┐
 *                                │
 *                                ├─ ok ────► markResultSent ──► resolved
 *                                │
 *                                └─ fail ──► markResultFailed (result.attempts++)
 *                                                   │
 *                                                   └─ if >= MAX ──► setStatus('failed')
 */

function outboxFilePath(dayDirAbsolute) {
  return path.join(dayDirAbsolute, 'tg-outbox.json');
}

function readOutbox(dayDirAbsolute) {
  const file = outboxFilePath(dayDirAbsolute);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    logger.warn('tgOutbox: failed to read JSON, resetting', { err: err.message, file });
    return [];
  }
}

/**
 * Atomic replace via tmp + rename. Guarantees no torn writes for readers,
 * but does NOT fsync - durability across power-loss is not guaranteed.
 * Concurrent writers from different processes may race (out of scope for v1).
 */
function writeOutbox(dayDirAbsolute, arr) {
  const file = outboxFilePath(dayDirAbsolute);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function recordKey(matchId, decisionKey) {
  return `${matchId}|${decisionKey}`;
}

function buildRecord(payload) {
  return {
    matchId: payload.matchId,
    decisionKey: payload.decisionKey,
    predictionType: payload.predictionType,
    tier: payload.tier ?? null,
    modelMode: payload.modelMode,
    createdAt: new Date().toISOString(),
    status: 'queued',
    entry: {
      messageId: null,
      sentAt: null,
      attempts: 0,
      lastError: null,
    },
    result: {
      messageId: null,
      sentAt: null,
      attempts: 0,
      lastError: null,
      hit: null,
    },
    snapshot: payload.snapshot || {},
  };
}

function enqueue(dayDirAbsolute, payload) {
  const arr = readOutbox(dayDirAbsolute);
  const key = recordKey(payload.matchId, payload.decisionKey);
  const existing = arr.find(row => recordKey(row.matchId, row.decisionKey) === key);
  if (existing) return existing;

  const rec = buildRecord(payload);
  arr.push(rec);
  writeOutbox(dayDirAbsolute, arr);
  return rec;
}

function findByStatus(dayDirAbsolute, status) {
  return readOutbox(dayDirAbsolute).filter(row => row.status === status);
}

function findByMatchId(dayDirAbsolute, matchId) {
  return readOutbox(dayDirAbsolute).filter(row => row.matchId === matchId);
}

function findByKey(dayDirAbsolute, matchId, decisionKey) {
  const key = recordKey(matchId, decisionKey);
  const row = readOutbox(dayDirAbsolute).find(rec => recordKey(rec.matchId, rec.decisionKey) === key);
  return row || null;
}

function mutateByKey(dayDirAbsolute, matchId, decisionKey, updater) {
  const arr = readOutbox(dayDirAbsolute);
  const key = recordKey(matchId, decisionKey);
  const idx = arr.findIndex(row => recordKey(row.matchId, row.decisionKey) === key);
  if (idx === -1) {
    throw new Error(`outbox record not found: ${key}`);
  }
  const next = updater(arr[idx]);
  arr[idx] = next;
  writeOutbox(dayDirAbsolute, arr);
  return next;
}

function markEntrySent(dayDirAbsolute, matchId, decisionKey, payload) {
  return mutateByKey(dayDirAbsolute, matchId, decisionKey, row => ({
    ...row,
    status: 'pending_result',
    entry: {
      ...row.entry,
      messageId: payload.messageId,
      sentAt: payload.sentAt,
      lastError: null,
    },
  }));
}

function markEntryFailed(dayDirAbsolute, matchId, decisionKey, payload) {
  return mutateByKey(dayDirAbsolute, matchId, decisionKey, row => ({
    ...row,
    entry: {
      ...row.entry,
      attempts: payload.attempts,
      lastError: payload.error,
    },
  }));
}

function markResultSent(dayDirAbsolute, matchId, decisionKey, payload) {
  return mutateByKey(dayDirAbsolute, matchId, decisionKey, row => ({
    ...row,
    status: 'resolved',
    result: {
      ...row.result,
      messageId: payload.messageId,
      sentAt: payload.sentAt,
      hit: payload.hit,
      lastError: null,
    },
  }));
}

function markResultFailed(dayDirAbsolute, matchId, decisionKey, payload) {
  return mutateByKey(dayDirAbsolute, matchId, decisionKey, row => ({
    ...row,
    result: {
      ...row.result,
      attempts: payload.attempts,
      lastError: payload.error,
    },
  }));
}

function setStatus(dayDirAbsolute, matchId, decisionKey, status) {
  return mutateByKey(dayDirAbsolute, matchId, decisionKey, row => ({
    ...row,
    status,
  }));
}

module.exports = {
  outboxFilePath,
  readOutbox,
  writeOutbox,
  recordKey,
  enqueue,
  findByStatus,
  findByMatchId,
  findByKey,
  markEntrySent,
  markEntryFailed,
  markResultSent,
  markResultFailed,
  setStatus,
};
