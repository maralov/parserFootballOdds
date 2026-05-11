'use strict';

const fs = require('fs');
const path = require('path');
const { SIGNAL_CODE } = require('../prediction/constants');
const logger = require('../observability/logger');

function signalFilePath(dayDirAbsolute) {
  return path.join(dayDirAbsolute, 'prediction-signals.json');
}

function readSignalsArray(dayDirAbsolute) {
  const file = signalFilePath(dayDirAbsolute);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    logger.warn('predictionSignals: failed to read JSON, resetting', {
      err: err.message,
      file,
    });
    return [];
  }
}

function writeSignals(dayDirAbsolute, arr) {
  const file = signalFilePath(dayDirAbsolute);
  fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
}

/**
 * Append actionable records with idempotent key (matchId + checkpoint + signal).
 *
 * @param {string} dayDirAbsolute  absolute logs day dir
 * @param {object} predictionRow shape per Plan 2 RFC
 */
function appendPredictionSignals(dayDirAbsolute, predictionRow) {
  const arr = readSignalsArray(dayDirAbsolute);

  const key = `${predictionRow.matchId}|${predictionRow.checkpoint}|${predictionRow.signal}`;
  const exists = arr.some(
    row => `${row.matchId}|${row.checkpoint}|${row.signal}` === key,
  );
  if (exists) return;

  arr.push(predictionRow);
  writeSignals(dayDirAbsolute, arr);
}

function deriveSignal(predictionObject) {
  return SIGNAL_CODE[predictionObject.predictionType] || predictionObject.predictionType;
}

function finalScoreText(match) {
  if (typeof match?.final?.score === 'string' && match.final.score.length > 0) {
    return match.final.score;
  }
  if (
    typeof match?.final?.scoreHome === 'number'
    && typeof match?.final?.scoreAway === 'number'
  ) {
    return `${match.final.scoreHome}:${match.final.scoreAway}`;
  }
  return null;
}

/**
 * Enrich already-written prediction signals with final match result and prediction outcome.
 * Outcome values: HIT | MISS | null.
 *
 * @param {string} dayDirAbsolute absolute logs day dir
 * @param {object} match finalized match object with predictions/final
 */
function attachFinalResult(dayDirAbsolute, match) {
  if (!match?.matchId || !match?.final) return;
  const arr = readSignalsArray(dayDirAbsolute);
  if (!arr.length) return;

  const finalScore = finalScoreText(match);
  const next = arr.map((row) => {
    if (row?.matchId !== match.matchId) return row;
    const audit = match?.predictions?.[row.checkpoint]?.predictionAudit;
    const hit = typeof audit?.hit === 'boolean' ? audit.hit : null;
    const predictionOutcome = hit === true ? 'HIT' : hit === false ? 'MISS' : null;
    return {
      ...row,
      finalScore,
      predictionHit: hit,
      predictionOutcome,
    };
  });

  writeSignals(dayDirAbsolute, next);
}

module.exports = {
  appendPredictionSignals,
  readSignalsArray,
  deriveSignal,
  attachFinalResult,
  signalFilePath,
};
