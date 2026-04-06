const POSITIVE_WEIGHTS = {
  shotsOnTarget:          0.15,
  shotsInsideTheBox:      0.12,
  bigChances:             0.14,
  touchesInOppositionBox: 0.10,
  cornerKicks:            0.06,
  goalkeeperSaves:        0.08,
  expectedGoalsXg:        0.08,
  xgOnTargetXgot:         0.05,
  passesInFinalThird:     0.04,
  expectedAssistsXa:      0.03,
};

const MINUTE_BUCKET_ADJUSTMENT = {
  '70-75': 0.04,
  '76-80': 0.02,
  '81-85': -0.02,
  '86+': -0.06,
};

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function computeGoalPressureIndex(features) {
  let score = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(POSITIVE_WEIGHTS)) {
    const normVal = features.normalized?.[key];
    if (normVal === null || normVal === undefined) continue;
    score += normVal * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Number((score / totalWeight).toFixed(4));
}

function computeDryPenalties(features) {
  let penalty = 0;
  const raw = features.raw || {};
  const ratios = features.ratios || {};

  if (ratios.offTargetRatio !== null && ratios.offTargetRatio > 0.6) {
    penalty += 0.10;
  }

  if (ratios.outsideBoxRatio !== null && ratios.outsideBoxRatio > 0.5) {
    penalty += 0.08;
  }

  const totalShots = raw.totalShots || 0;
  if (totalShots > 10 && (raw.bigChances === 0 || raw.bigChances === null)) {
    penalty += 0.12;
  }

  if (raw.touchesInOppositionBox !== null && raw.touchesInOppositionBox < 12) {
    penalty += 0.08;
  }

  if (raw.goalkeeperSaves !== null && raw.goalkeeperSaves === 0 && totalShots > 5) {
    penalty += 0.06;
  }

  if (raw.shotsOnTarget !== null && raw.shotsOnTarget <= 1) {
    penalty += 0.10;
  }

  return Number(penalty.toFixed(4));
}

function scoreMatch(features) {
  const goalPressureIndex = computeGoalPressureIndex(features);
  const dryPenalty = computeDryPenalties(features);
  const minuteAdj = MINUTE_BUCKET_ADJUSTMENT[features.minuteBucket] || 0;

  const pGoal = Number(clamp01(goalPressureIndex - dryPenalty + minuteAdj + 0.35).toFixed(3));
  const pDry = Number(clamp01(1 - pGoal).toFixed(3));

  return {
    goalPressureIndex: Number(goalPressureIndex.toFixed(3)),
    dryPenalty: Number(dryPenalty.toFixed(3)),
    minuteAdj,
    pGoal,
    pDry,
    confidence: features.confidence,
    minuteBucket: features.minuteBucket,
    dataQualityScore: features.dataQualityScore,
  };
}

module.exports = { scoreMatch };
