'use strict';

function regularGoals(goals = []) {
  return goals.filter((g) => !g?.isExtraTime);
}

function totalGoalsCanonical(match) {
  const g = match?.final?.goals;
  if (Array.isArray(g)) return regularGoals(g).length;
  if (match?.final && typeof match.final.totalGoals === 'number') {
    return match.final.totalGoals;
  }
  return null;
}

/**
 * Після finalize(): для decision60 очікуємо повний матч без голів у regular time для FT ТМ0.5-сигналу,
 * який був прийнятий у вікні 60–75.
 *
 * TB80: гол після 80'.
 *
 * @param {*} match mutated in-place
 */
function applyPredictionHits(match) {
  const preds = match?.predictions || {};
  const tg = totalGoalsCanonical(match);
  const hasFinal = Boolean(match?.final);

  const goals = regularGoals(match?.final?.goals || []);
  const hitTbAfter80Plus = goals.some(g => typeof g.minute === 'number' && g.minute > 80);

  if (preds.decision60?.predictionAudit) {
    preds.decision60.predictionAudit.finalResult = preds.decision60.predictionType ?? null;
    const hitFtNilNil =
      hasFinal &&
      tg != null &&
      tg === 0;
    preds.decision60.predictionAudit.hit = hasFinal ? hitFtNilNil : null;
  }

  if (preds.decision80?.predictionAudit) {
    preds.decision80.predictionAudit.finalResult = preds.decision80.predictionType ?? null;
    preds.decision80.predictionAudit.hit = hasFinal ? hitTbAfter80Plus : null;
  }
}

module.exports = { applyPredictionHits, regularGoals, totalGoalsCanonical };
