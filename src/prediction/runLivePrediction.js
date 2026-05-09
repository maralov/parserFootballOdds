'use strict';

const { updateComputed } = require('../computed/updateComputed');
const { evaluateDecision60 } = require('./evaluateDecision60');
const { evaluateDecision80 } = require('./evaluateDecision80');
const { PRED_TYPES_60, PRED_TYPES_80 } = require('./constants');
const matchStore = require('../store/matchStore');
const predictionSignals = require('../store/predictionSignals');
const tgDispatcher = require('../integrations/telegram/dispatcher');
const logger = require('../observability/logger');

function minuteFrom(header) {
  const m = header?.observedMinute ?? header?.minute;
  const n = Number(m);
  return Number.isFinite(n) ? n : null;
}

/**
 * Persist computed slices + checkpoints for one snapshot tick (rule-based only).
 *
 * @param {{ matchId: string, observedMinute?: number, minute?: number, scoreHome: number, scoreAway: number }} header
 */
function maybeRunPredictionPipeline(matchId, header, date = new Date()) {
  let match = matchStore.getMatch(matchId, date);
  if (!match || match.tracking?.status !== 'active') return null;

  const computed = updateComputed(match);
  matchStore.setComputed(matchId, computed, date);
  match = matchStore.getMatch(matchId, date);

  maybeDecision60(match, header, computed, date);
  match = matchStore.getMatch(matchId, date);

  maybeDecision80(match, header, computed, date);
}

function maybeDecision60(matchIn, header, computed, date) {
  let match = matchIn;
  const minute = minuteFrom(header);
  if (minute == null) return;

  const sh = Number(header.scoreHome);
  const sa = Number(header.scoreAway);
  if (sh !== 0 || sa !== 0 || !match.tracking?.validForPrediction) return;
  if (!(minute >= 60 && minute <= 75)) return;

  matchStore.ensurePredictionShell(match.matchId, date);

  match = matchStore.getMatch(match.matchId, date);
  const frozen = match.predictions?.decision60?.predictionType === PRED_TYPES_60.FT_TM05_FROM_60_75;
  if (frozen) return;

  let evaluated = evaluateDecision60(match, computed);
  evaluated = finalizeEnvelope(evaluated);
  matchStore.setPrediction(match.matchId, 'decision60', evaluated, date);

  if (evaluated.actionablePrimary && evaluated.predictionType === PRED_TYPES_60.FT_TM05_FROM_60_75) {
    matchStore.ensurePredictionLocks(match.matchId, date, true);
  }

  appendSignalsIfEligible(match.matchId, evaluated, header, minute, date);
}

function maybeDecision80(matchIn, header, computed, date) {
  let match = matchIn;
  const minute = minuteFrom(header);
  if (minute == null) return;

  const sh = Number(header.scoreHome);
  const sa = Number(header.scoreAway);
  if (sh !== 0 || sa !== 0) return;

  matchStore.ensurePredictionShell(match.matchId, date);
  match = matchStore.getMatch(match.matchId, date);
  const frozenTb = match.predictions?.decision80?.predictionType === PRED_TYPES_80.TB05_80_PLUS;
  if (frozenTb) return;
  if (!(minute >= 80 && minute <= 90)) return;

  let evaluated = evaluateDecision80(match, computed);
  evaluated = finalizeEnvelope(evaluated);
  matchStore.setPrediction(match.matchId, 'decision80', evaluated, date);

  appendSignalsIfEligible(match.matchId, evaluated, header, minute, date);
}

function finalizeEnvelope(evaluated) {
  evaluated.predictionAudit.components = { ...evaluated.components };
  evaluated.createdAt = new Date().toISOString();
  return evaluated;
}

function appendSignalsIfEligible(matchId, evaluated, header, minute, date) {
  if (
    evaluated.predictionType === PRED_TYPES_60.NO_BET
    || evaluated.predictionType === PRED_TYPES_80.NO_BET
  ) {
    return;
  }

  const actionable = evaluated.actionable === true ||
    evaluated.predictionType === PRED_TYPES_80.PROTECT_UNDER;
  if (!actionable) return;

  const score = `${Number(header.scoreHome)}:${Number(header.scoreAway)}`;
  const dayDir = matchStore.dayLogsAbsolute(date);
  predictionSignals.appendPredictionSignals(dayDir, {
    matchId,
    recordedAt: new Date().toISOString(),
    checkpoint: evaluated.checkpoint,
    signal: predictionSignals.deriveSignal(evaluated),
    minute,
    score,
    predictionType: evaluated.predictionType,
    confidence: evaluated.confidence,
    modelMode: evaluated.modelMode,
    components: evaluated.components,
    reasons: evaluated.reasons,
    riskFlags: evaluated.riskFlags,
  });

  const decisionKey = evaluated.checkpoint
    || (evaluated.predictionType === PRED_TYPES_60.FT_TM05_FROM_60_75 ? 'decision60' : null)
    || (evaluated.predictionType === PRED_TYPES_80.TB05_80_PLUS ? 'decision80' : null);
  if (!decisionKey) return;

  const match = matchStore.getMatch(matchId, date);
  if (!match) return;

  setImmediate(() => {
    tgDispatcher.enqueueEntry({
      match,
      prediction: evaluated,
      decisionKey,
      minute,
      score,
      date,
    }).catch((err) => {
      logger.warn('tg.entry.enqueue_unhandled', {
        matchId,
        decisionKey,
        err: err?.message || String(err),
      });
    });
  });
}

module.exports = {
  maybeRunPredictionPipeline,
  minuteFrom,
};
