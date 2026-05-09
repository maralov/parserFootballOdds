'use strict';

const { LIVE_TG_ENABLED, LIVE_TG_MAX_RETRIES } = require('../../config/env');
const logger = require('../../observability/logger');
const matchStore = require('../../store/matchStore');
const tgOutbox = require('../../store/tgOutbox');
const client = require('./client');
const { formatEntryMessage } = require('./formatters/entryMessage');
const { formatResultMessage } = require('./formatters/resultMessage');
const { PRED_TYPES_60, PRED_TYPES_80 } = require('../../prediction/constants');
const inFlightEntries = new Set();

function entryKey(matchId, decisionKey) {
  return `${matchId}|${decisionKey}`;
}

function isPrimaryPrediction(predictionType) {
  return predictionType === PRED_TYPES_60.FT_TM05_FROM_60_75
    || predictionType === PRED_TYPES_80.TB05_80_PLUS;
}

function buildOutboxPayload({ match, prediction, decisionKey, minute, score }) {
  return {
    matchId: match.matchId,
    decisionKey,
    predictionType: prediction.predictionType,
    tier: prediction.tier || null,
    modelMode: prediction.modelMode || prediction.mode || 'unknown',
    snapshot: {
      minute,
      score,
      confidence: prediction.confidence ?? null,
      components: prediction.components || {},
      riskFlags: prediction.riskFlags || [],
      reasons: prediction.reasons || [],
      aiVerdict: prediction.aiOverlay?.scenario
        || prediction.aiScenario
        || prediction.components?.aiScenario
        || null,
    },
  };
}

async function enqueueEntry({ match, prediction, decisionKey, minute, score, date = new Date() }) {
  if (!LIVE_TG_ENABLED) return null;
  if (!match || !prediction) return null;
  if (!isPrimaryPrediction(prediction.predictionType)) return null;

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
  const auditHit = match?.predictions?.[record?.decisionKey]?.predictionAudit?.hit;
  if (typeof auditHit === 'boolean') return auditHit;
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
          predictionType: record.predictionType,
          tier: record.tier,
          modelMode: record.modelMode,
          confidence: record.snapshot?.confidence ?? null,
          components: record.snapshot?.components || {},
          riskFlags: record.snapshot?.riskFlags || [],
          reasons: record.snapshot?.reasons || [],
          aiOverlay: record.snapshot?.aiVerdict
            ? { scenario: record.snapshot.aiVerdict }
            : undefined,
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
  isPrimaryPrediction,
  buildOutboxPayload,
  dispatchResults,
  flushPending,
  pendingResultRecords,
  resultHitForRecord,
};
