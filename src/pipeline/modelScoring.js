/**
 * Ваги калібровані за 7-денним аналізом (214 матчів, 2026-04-03..09).
 * Дискримінатори dry/lateGoal: xgOnTargetXgot ×4.94, bigChances ×3.46, xG ×1.92
 * cornerKicks медіана dry=5 vs lateGoal=5 — не дискримінує → мінімальна вага.
 */
const WEIGHTS_2H = {
  bigChances:             0.20,
  xgOnTargetXgot:         0.15,
  expectedGoalsXg:        0.18,
  shotsOnTarget:          0.16,
  touchesInOppositionBox: 0.10,
  shotsInsideTheBox:      0.08,
  goalkeeperSaves:        0.06,
  cornerKicks:            0.01,
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

/**
 * Під часові вікна 60–70 / 70–80 / 80+ (лайв-модель): рання фаза — сухіша, пізня — тиск на гол.
 * Калібровано за pctWithGoal: 60-70=17.3%, 70-80=15.0%, 80-90+=22.4% (30.4% у 85+).
 */
const WINDOW_MINUTE_ADJ = {
  '60-69': -0.03,
  '70-75': 0,
  '76-80': 0.03,
  '81-84': 0.05,
  '85+':   0.12,
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
  if ((raw.touchesInOppositionBox ?? 99) < 18) penalty += 0.10;
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
    0.45 + goalPressureIndex - dryPenalty + trendBonus + imbalanceBonus + minuteAdj
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

function scoreMatchWindowed(features) {
  const norm = features.normalized || {};
  const gpi2H = weightedSum(norm, WEIGHTS_2H);
  const gpiO = weightedSum(norm, WEIGHTS_OVERALL);
  const goalPressureIndex = Number((gpi2H * 0.7 + gpiO * 0.3).toFixed(4));

  const dryPenalty = computeDryPenalty(features);
  const trendBonus = computeTrendBonus(features);
  const imbalanceBonus = computeImbalanceBonus(features);
  const minuteAdj = WINDOW_MINUTE_ADJ[features.minuteBucket] || 0;

  const pGoal = Number(clamp01(
    0.45 + goalPressureIndex - dryPenalty + trendBonus + imbalanceBonus + minuteAdj
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
    scoringMode: 'windowed',
  };
}

module.exports = { scoreMatch, scoreMatchWindowed };
