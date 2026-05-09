'use strict';

const { LIVE_TG_ENABLED, LIVE_TG_MAX_RETRIES } = require('../../config/env');
const logger = require('../../observability/logger');
const matchStore = require('../../store/matchStore');
const tgOutbox = require('../../store/tgOutbox');
const client = require('./client');
const { formatEntryMessage } = require('./formatters/entryMessage');
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

module.exports = {
  enqueueEntry,
  isPrimaryPrediction,
  buildOutboxPayload,
};
