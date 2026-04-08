const THRESHOLDS = {
  '60-69': { overPGoal: 0.65, underPDry: 0.70 },
  '70-75': { overPGoal: 0.70, underPDry: 0.75 },
  '76-80': { overPGoal: 0.70, underPDry: 0.75 },
  '81-84': { overPGoal: 0.75, underPDry: 0.80 },
  '85+':   { overPGoal: 0.80, underPDry: 0.85 },
};

function buildReason(features, scored) {
  const raw = features.raw2H || features.rawOverall || {};
  const parts = [];
  if (raw.shotsOnTarget != null) parts.push(`${raw.shotsOnTarget} уд. в площ.`);
  if (raw.bigChances != null) parts.push(`${raw.bigChances} мом.`);
  if (raw.touchesInOppositionBox != null) parts.push(`${raw.touchesInOppositionBox} дотик.`);
  if (raw.goalkeeperSaves != null) parts.push(`${raw.goalkeeperSaves} сейвів`);
  if (raw.cornerKicks != null) parts.push(`${raw.cornerKicks} кутових`);
  if (raw.expectedGoalsXg != null) parts.push(`xG ${raw.expectedGoalsXg}`);
  const statsLine = parts.length ? parts.join(', ') : 'мало даних';
  const src = features.statsStatus === 'both' ? '(2H+O)' :
              features.statsStatus === '2h_only' ? '(2H)' : '(O)';
  return `${statsLine} ${src}`;
}

function decideBet(scored, features) {
  if (!scored || !Number.isFinite(scored.pGoal)) {
    return { bet: 'SKIP', confidence: 'none', pGoal: null, pDry: null, edge: null, reason: 'Некоректні дані' };
  }

  const bucket = scored.minuteBucket || '70-75';
  const th = THRESHOLDS[bucket] || THRESHOLDS['70-75'];
  const conf = scored.confidence || 'low';
  const reason = buildReason(features, scored);

  if (scored.pGoal >= th.overPGoal && conf !== 'low' && conf !== 'none') {
    return {
      bet: 'OVER_0_5', confidence: conf,
      pGoal: scored.pGoal, pDry: scored.pDry,
      edge: Number((scored.pGoal - 0.5).toFixed(3)),
      reason: `OVER: ${reason}`,
    };
  }

  if (scored.pDry >= th.underPDry && conf !== 'low' && conf !== 'none') {
    return {
      bet: 'UNDER_0_5', confidence: conf,
      pGoal: scored.pGoal, pDry: scored.pDry,
      edge: Number((scored.pDry - 0.5).toFixed(3)),
      reason: `UNDER: ${reason}`,
    };
  }

  return {
    bet: 'SKIP', confidence: conf,
    pGoal: scored.pGoal, pDry: scored.pDry,
    edge: null,
    reason: `SKIP: ${reason}`,
  };
}

module.exports = { decideBet };
