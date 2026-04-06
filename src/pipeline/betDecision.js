function generateReason(features, scored) {
  const raw = features.raw || {};
  const parts = [];

  if (raw.shotsOnTarget !== null && raw.shotsOnTarget !== undefined) {
    parts.push(`${raw.shotsOnTarget} уд. в площину`);
  }
  if (raw.bigChances !== null && raw.bigChances !== undefined) {
    parts.push(`${raw.bigChances} мом.`);
  }
  if (raw.touchesInOppositionBox !== null && raw.touchesInOppositionBox !== undefined) {
    parts.push(`${raw.touchesInOppositionBox} дотик. в штр.`);
  }
  if (raw.goalkeeperSaves !== null && raw.goalkeeperSaves !== undefined) {
    parts.push(`${raw.goalkeeperSaves} сейвів`);
  }
  if (raw.cornerKicks !== null && raw.cornerKicks !== undefined) {
    parts.push(`${raw.cornerKicks} кутових`);
  }
  if (raw.expectedGoalsXg !== null && raw.expectedGoalsXg !== undefined) {
    parts.push(`xG ${raw.expectedGoalsXg}`);
  }

  const statsLine = parts.length > 0 ? parts.join(', ') : 'мало даних';

  if (scored.pGoal >= 0.65) {
    return `Високий тиск: ${statsLine}`;
  }
  if (scored.pDry >= 0.75) {
    return `Низька якість атак: ${statsLine}`;
  }
  return `Невизначений сигнал: ${statsLine}`;
}

function decideBet(scored, features) {
  if (!scored || !Number.isFinite(scored.pGoal)) {
    return {
      bet: 'SKIP',
      confidence: 'low',
      pGoal: null,
      pDry: null,
      edge: null,
      reason: 'Некоректні дані для скорингу',
    };
  }

  const confidence = scored.confidence || 'low';
  const reason = generateReason(features, scored);

  if (scored.pGoal >= 0.65 && confidence !== 'low') {
    return {
      bet: 'OVER_0_5',
      confidence,
      pGoal: scored.pGoal,
      pDry: scored.pDry,
      edge: Number((scored.pGoal - 0.5).toFixed(3)),
      reason,
    };
  }

  if (scored.pDry >= 0.75 && confidence !== 'low') {
    return {
      bet: 'UNDER_0_5',
      confidence,
      pGoal: scored.pGoal,
      pDry: scored.pDry,
      edge: Number((scored.pDry - 0.5).toFixed(3)),
      reason,
    };
  }

  return {
    bet: 'SKIP',
    confidence,
    pGoal: scored.pGoal,
    pDry: scored.pDry,
    edge: null,
    reason,
  };
}

module.exports = { decideBet };
