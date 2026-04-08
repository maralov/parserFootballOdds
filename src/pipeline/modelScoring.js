const WEIGHTS_2H = {
  shotsOnTarget:          0.18,
  bigChances:             0.16,
  expectedGoalsXg:        0.14,
  touchesInOppositionBox: 0.10,
  shotsInsideTheBox:      0.08,
  goalkeeperSaves:        0.06,
  cornerKicks:            0.03,
  xgOnTargetXgot:         0.03,
  errorsLeadingToShot:    0.02,
};

const WEIGHTS_OVERALL = {
  shotsOnTarget:          0.05,
  bigChances:             0.04,
  expectedGoalsXg:        0.04,
  touchesInOppositionBox: 0.03,
  shotsInsideTheBox:      0.02,
  goalkeeperSaves:        0.02,
};

const MINUTE_ADJ = {
  '60-69': 0.04,
  '70-75': 0.02,
  '76-80': 0,
  '81-84': -0.03,
  '85+': -0.08,
};

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function weightedSum(normalized, weights) {
  let score = 0, totalW = 0;
  for (const [key, w] of Object.entries(weights)) {
    const v = normalized[key];
    if (v === null || v === undefined) continue;
    score += v * w;
    totalW += w;
  }
  return totalW > 0 ? score / totalW : 0;
}

function computeDryPenalty(features) {
  let penalty = 0;
  const raw = features.raw2H || features.rawOverall || {};
  const ratios = features.ratios || {};

  if ((raw.shotsOnTarget ?? 99) <= 1) penalty += 0.12;
  if (raw.bigChances === 0 || raw.bigChances === null) {
    if ((raw.totalShots ?? 0) > 5) penalty += 0.15;
  }
  if ((raw.touchesInOppositionBox ?? 99) < 10) penalty += 0.10;
  if (raw.shotsOutsideTheBox !== null && raw.shotsInsideTheBox !== null &&
      raw.shotsOutsideTheBox > raw.shotsInsideTheBox) penalty += 0.08;
  if ((raw.clearances ?? 0) + (raw.interceptions ?? 0) > 15) penalty += 0.05;
  if ((raw.goalkeeperSaves ?? 99) === 0 && (raw.totalShots ?? 0) > 5) penalty += 0.08;

  return Number(Math.min(penalty, 0.50).toFixed(4));
}

function computeTrendBonus(features) {
  const { trendSOT, trendXG } = features.trend || {};
  if (trendSOT === null || trendXG === null) return 0;
  if (trendSOT > 2 && trendXG > 0.3) return 0.06;
  if (trendSOT > 0 && trendXG > 0) return 0.03;
  if (trendSOT < -2 && trendXG < -0.3) return -0.06;
  return 0;
}

function computeImbalanceBonus(features) {
  const dr = features.dominanceRatio || 0.5;
  if (dr > 0.75) return 0.04;
  if (dr < 0.55) return -0.02;
  return 0;
}

function scoreMatch(features) {
  const norm = features.normalized || {};
  const gpi2H = weightedSum(norm, WEIGHTS_2H);
  const gpiO = weightedSum(norm, WEIGHTS_OVERALL);
  const goalPressureIndex = Number((gpi2H * 0.7 + gpiO * 0.3).toFixed(4));

  const dryPenalty = computeDryPenalty(features);
  const trendBonus = computeTrendBonus(features);
  const imbalanceBonus = computeImbalanceBonus(features);
  const minuteAdj = MINUTE_ADJ[features.minuteBucket] || 0;

  const pGoal = Number(clamp01(
    0.30 + goalPressureIndex - dryPenalty + trendBonus + imbalanceBonus + minuteAdj
  ).toFixed(3));
  const pDry = Number((1 - pGoal).toFixed(3));

  return {
    goalPressureIndex: Number(goalPressureIndex.toFixed(3)),
    dryPenalty: Number(dryPenalty.toFixed(3)),
    trendBonus, imbalanceBonus, minuteAdj,
    pGoal, pDry,
    confidence: features.confidence,
    minuteBucket: features.minuteBucket,
    dataQualityScore: features.dataQualityScore,
    statsStatus: features.statsStatus,
  };
}

module.exports = { scoreMatch };
