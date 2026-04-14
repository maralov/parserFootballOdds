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

/**
 * Коригування pGoal при червоних картках.
 * Команда з вилученим гравцем захищається → суперник тисне → більше голів.
 * Якщо фаворит грає вдесятьох — аутсайдер тисне ще сильніше.
 */
function computeRedCardAdjustment(features) {
  const rc = features.redCards;
  if (!rc || (rc.homeRedCards === 0 && rc.awayRedCards === 0)) return 0;

  const totalCards = (rc.homeRedCards || 0) + (rc.awayRedCards || 0);
  let adj = 0.04 * totalCards;

  const odds = features.odds1X2;
  if (odds && odds.home > 0 && odds.away > 0) {
    const favIsHome = odds.home < odds.away;
    if (favIsHome && rc.homeRedCards > 0) adj += 0.04;   // фаворит-хазяїн -1
    if (!favIsHome && rc.awayRedCards > 0) adj += 0.04;  // фаворит-гість -1
  }

  return Math.min(adj, 0.12);
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

/**
 * @param {object} [scoringOpts]
 * @param {Record<string, number>} [scoringOpts.windowMinuteAdj] — заміна WINDOW_MINUTE_ADJ (replay baseline)
 * @param {Record<string, number>} [scoringOpts.weights2H]
 * @param {Record<string, number>} [scoringOpts.weightsOverall]
 */
function scoreMatchWindowed(features, scoringOpts = {}) {
  const w2h = scoringOpts.weights2H || WEIGHTS_2H;
  const wOv = scoringOpts.weightsOverall || WEIGHTS_OVERALL;
  const wMinAdj = scoringOpts.windowMinuteAdj || WINDOW_MINUTE_ADJ;

  const norm = features.normalized || {};
  const gpi2H = weightedSum(norm, w2h);
  const gpiO = weightedSum(norm, wOv);
  const goalPressureIndex = Number((gpi2H * 0.7 + gpiO * 0.3).toFixed(4));

  const dryPenalty = computeDryPenalty(features);
  const trendBonus = computeTrendBonus(features);
  const imbalanceBonus = computeImbalanceBonus(features);
  const minuteAdj = wMinAdj[features.minuteBucket] || 0;
  const redCardAdj = computeRedCardAdjustment(features);

  const pGoal = Number(clamp01(
    0.45 + goalPressureIndex - dryPenalty + trendBonus + imbalanceBonus + minuteAdj + redCardAdj
  ).toFixed(3));
  const pDry = Number((1 - pGoal).toFixed(3));

  return {
    goalPressureIndex: Number(goalPressureIndex.toFixed(3)),
    dryPenalty: Number(dryPenalty.toFixed(3)),
    trendBonus, imbalanceBonus, minuteAdj, redCardAdj,
    pGoal, pDry,
    confidence: features.confidence,
    minuteBucket: features.minuteBucket,
    dataQualityScore: features.dataQualityScore,
    statsStatus: features.statsStatus,
    scoringMode: 'windowed',
  };
}

module.exports = { scoreMatch, scoreMatchWindowed, WINDOW_MINUTE_ADJ, WEIGHTS_2H, WEIGHTS_OVERALL };
