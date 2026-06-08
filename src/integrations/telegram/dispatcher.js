'use strict';

const { LIVE_TG_ENABLED, LIVE_TG_MAX_RETRIES } = require('../../config/env');
const logger = require('../../observability/logger');
const matchStore = require('../../store/matchStore');
const tgOutbox = require('../../store/tgOutbox');
const client = require('./client');
const { formatEntryMessage } = require('./formatters/entryMessage');
const { formatResultMessage } = require('./formatters/resultMessage');
const inFlightEntries = new Set();
const inFlightResults = new Set();

const PRIMARY_DECISION_KEYS = new Set(['tm05', 'tb05', 'tm05_1h']);

function entryKey(matchId, decisionKey) {
  return `${matchId}|${decisionKey}`;
}

function resultKey(matchId, decisionKey) {
  return `${matchId}|${decisionKey}`;
}

function isPrimaryDecision(decisionKey) {
  return PRIMARY_DECISION_KEYS.has(decisionKey);
}

function buildOutboxPayload({ match, prediction, decisionKey, minute, score }) {
  return {
    matchId: match.matchId,
    decisionKey,
    snapshot: {
      minute,
      score,
      dsScore: prediction.dsScore ?? null,
      psScore: prediction.psScore ?? null,
      pNoGoal: prediction.pNoGoal ?? null,
      pGoal: prediction.pGoal ?? null,
      confidence: prediction.confidence ?? null,
      odds: prediction.odds ?? null,
      ev: prediction.evGate?.ev ?? null,
      reasoning: prediction.reasoning || '',
      keySignals: prediction.keySignals || [],
      calibrated: prediction.calibrated ?? null,
    },
  };
}

async function enqueueEntry({ match, prediction, decisionKey, minute, score, date = new Date() }) {
  if (!LIVE_TG_ENABLED) return null;
  if (!match || !prediction) return null;
  if (!isPrimaryDecision(decisionKey)) {
    logger.info('tg.entry.dropped', { matchId: match?.matchId, decisionKey, reason: 'not_primary' });
    return null;
  }

  const matchId = match.matchId;
  const dayDir = matchStore.dayLogsAbsolute(date);
  const payload = buildOutboxPayload({ match, prediction, decisionKey, minute, score });
  const key = entryKey(matchId, decisionKey);

  try {
    const existing = tgOutbox.findByKey(dayDir, matchId, decisionKey);
    if (existing && (existing.entry?.messageId != null || existing.status !== 'queued')) {
      return existing;
    }

    const record = tgOutbox.enqueue(dayDir, payload);
    if (record.entry?.messageId != null || record.status !== 'queued') {
      return record;
    }

    if (inFlightEntries.has(key)) {
      return record;
    }
    inFlightEntries.add(key);

    try {
      const message = formatEntryMessage({ match, prediction, decisionKey, minute, score });
      if (message == null) {
        logger.warn('tg.entry.skipped', { matchId, decisionKey, reason: 'format_null' });
        return record;
      }

      const result = await client.sendMessage({ text: message });
      if (result.ok) {
        const updated = tgOutbox.markEntrySent(dayDir, matchId, decisionKey, {
          messageId: result.messageId,
          sentAt: new Date().toISOString(),
        });
        logger.info('tg.entry.sent', {
          matchId,
          decisionKey,
          messageId: result.messageId,
          attempts: result.attempts,
          dryRun: result.dryRun,
        });
        return updated;
      }

      let updated = tgOutbox.markEntryFailed(dayDir, matchId, decisionKey, {
        error: result.error,
        attempts: result.attempts,
      });
      if (result.attempts >= Math.max(1, LIVE_TG_MAX_RETRIES)) {
        updated = tgOutbox.setStatus(dayDir, matchId, decisionKey, 'failed');
      }
      logger.warn('tg.entry.failed', {
        matchId,
        decisionKey,
        error: result.error,
        attempts: result.attempts,
      });
      return updated;
    } finally {
      inFlightEntries.delete(key);
    }
  } catch (err) {
    logger.warn('tg.entry.dispatch_error', {
      matchId,
      decisionKey,
      err: err?.message || String(err),
    });
    return null;
  }
}

function pendingResultRecords(dayDir, matchId) {
  return tgOutbox
    .findByMatchId(dayDir, matchId)
    .filter((record) => (
      record?.status === 'pending_result'
      && record?.entry?.messageId != null
      && record?.result?.messageId == null
    ));
}

function resultHitForRecord(record, match) {
  if (typeof record?.result?.hit === 'boolean') return record.result.hit;
  if (record?.decisionKey === 'tm05' && typeof match?.final?.resultTM05 === 'boolean') {
    return match.final.resultTM05;
  }
  if (record?.decisionKey === 'tb05' && typeof match?.final?.resultTB05 === 'boolean') {
    return match.final.resultTB05;
  }
  if (record?.decisionKey === 'tm05_1h') {
    // 1HUNDER hits when the first half stayed dry (no goal before/at 45').
    const fgm = match?.final?.firstGoalMinute;
    if (fgm == null) return true;
    if (typeof fgm === 'number') return fgm > 45;
    return null;
  }
  return null;
}

async function dispatchResults({ match, date = new Date() }) {
  if (!LIVE_TG_ENABLED) return [];
  if (!match?.matchId || !match?.final) return [];

  const matchId = match.matchId;
  const dayDir = matchStore.dayLogsAbsolute(date);
  const records = pendingResultRecords(dayDir, matchId);
  const updates = [];

  for (const record of records) {
    try {
      const rkey = resultKey(matchId, record.decisionKey);
      if (inFlightResults.has(rkey)) {
        continue;
      }
      inFlightResults.add(rkey);

      try {
        const message = formatResultMessage({ outboxRecord: record, match });
        if (message == null) {
          logger.warn('tg.result.skipped', {
            matchId,
            decisionKey: record.decisionKey,
            reason: 'format_null',
          });
          continue;
        }

        const result = await client.sendMessage({
          text: message,
          replyToMessageId: record.entry.messageId,
        });
        if (result.ok) {
          const hit = resultHitForRecord(record, match);
          const updated = tgOutbox.markResultSent(dayDir, matchId, record.decisionKey, {
            messageId: result.messageId,
            sentAt: new Date().toISOString(),
            hit,
          });
          logger.info('tg.result.sent', {
            matchId,
            decisionKey: record.decisionKey,
            messageId: result.messageId,
            replyToMessageId: record.entry.messageId,
            hit,
            attempts: result.attempts,
            dryRun: result.dryRun,
          });
          updates.push(updated);
          continue;
        }

        let updated = tgOutbox.markResultFailed(dayDir, matchId, record.decisionKey, {
          error: result.error,
          attempts: result.attempts,
        });
        if (result.attempts >= Math.max(1, LIVE_TG_MAX_RETRIES)) {
          updated = tgOutbox.setStatus(dayDir, matchId, record.decisionKey, 'failed');
        }
        logger.warn('tg.result.failed', {
          matchId,
          decisionKey: record.decisionKey,
          error: result.error,
          attempts: result.attempts,
        });
        updates.push(updated);
      } finally {
        inFlightResults.delete(rkey);
      }
    } catch (err) {
      logger.warn('tg.result.dispatch_error', {
        matchId,
        decisionKey: record?.decisionKey,
        err: err?.message || String(err),
      });
    }
  }

  return updates;
}

async function flushPending({ date = new Date() } = {}) {
  if (!LIVE_TG_ENABLED) return { entries: [], results: [] };

  const entries = [];
  const results = [];

  try {
    const dayDir = matchStore.dayLogsAbsolute(date);
    const queued = tgOutbox.findByStatus(dayDir, 'queued');

    for (const record of queued) {
      const match = matchStore.getMatch(record.matchId, date);
      if (!match) {
        logger.warn('tg.flush.entry.skipped', {
          matchId: record.matchId,
          decisionKey: record.decisionKey,
          reason: 'match_not_found',
        });
        continue;
      }

      const updated = await enqueueEntry({
        match,
        prediction: {
          dsScore: record.snapshot?.dsScore ?? null,
          psScore: record.snapshot?.psScore ?? null,
          pNoGoal: record.snapshot?.pNoGoal ?? null,
          pGoal: record.snapshot?.pGoal ?? null,
          confidence: record.snapshot?.confidence ?? null,
          odds: record.snapshot?.odds ?? null,
          evGate: { ev: record.snapshot?.ev ?? null },
          reasoning: record.snapshot?.reasoning || '',
          keySignals: record.snapshot?.keySignals || [],
          calibrated: record.snapshot?.calibrated ?? null,
        },
        decisionKey: record.decisionKey,
        minute: record.snapshot?.minute,
        score: record.snapshot?.score,
        date,
      });
      entries.push(updated);
    }

    const pending = tgOutbox.findByStatus(dayDir, 'pending_result');
    const matchIds = [...new Set(pending.map((record) => record.matchId))];

    for (const matchId of matchIds) {
      const match = matchStore.getMatch(matchId, date);
      if (!match || !match.final || match.tracking?.status !== 'finished') {
        if (match) {
          logger.warn('tg.flush.result.skipped', { matchId, reason: 'not_finished' });
        }
        continue;
      }

      const updated = await dispatchResults({ match, date });
      results.push(...updated);
    }

    return { entries, results };
  } catch (err) {
    logger.warn('tg.flush.error', { err: err?.message || String(err) });
    return { entries, results };
  }
}

module.exports = {
  enqueueEntry,
  isPrimaryDecision,
  buildOutboxPayload,
  dispatchResults,
  flushPending,
  pendingResultRecords,
  resultHitForRecord,
};
