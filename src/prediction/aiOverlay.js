'use strict';

// Map AI scenario → numerical "0:0 likelihood" score
const SCENARIO_SCORE = {
  dead: 100,
  low_activity: 90,
  balanced: 55,
  pressure_building: 30,
  high_pressure: 15,
  chaotic: 10,
};

// Map favorite_pressure → pressure quality score (high = sterile/no pressure)
const PRESSURE_QUALITY_SCORE = {
  none: 100,
  weak: 80,
  moderate: 45,
  strong: 15,
};

// Map tempo_state → late-risk score (high = low risk)
const TEMPO_LATE_RISK_SCORE = {
  falling: 100,
  flat: 75,
  growing: 35,
  explosive: 15,
};

// AI agreement adjustment based on recommendation.action vs rule predictionType
const AGREEMENT_MAP = {
  // rule → primary FT TM05_FROM_60_75 (under_candidate)
  primary: { under_candidate: 8, lean_under: 4, no_bet: 0, lean_goal: -8, goal_candidate: -15 },
  // rule → LEAN_FT_TM05_FROM_60_75
  lean: { under_candidate: 6, lean_under: 5, no_bet: 0, lean_goal: -6, goal_candidate: -12 },
  // rule → FT_TM05_RISK
  risk: { under_candidate: 4, lean_under: 3, no_bet: 0, lean_goal: -4, goal_candidate: -8 },
  // rule → NO_BET
  no_bet: { under_candidate: 0, lean_under: 0, no_bet: 0, lean_goal: 0, goal_candidate: 0 },
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function ruleClassFromType(predictionType) {
  if (!predictionType) return 'no_bet';
  if (predictionType === 'FT_TM05_FROM_60_75') return 'primary';
  if (predictionType === 'LEAN_FT_TM05_FROM_60_75') return 'lean';
  if (predictionType === 'FT_TM05_RISK') return 'risk';
  return 'no_bet';
}

function computeAiScenarioScore(aiOutput) {
  if (!aiOutput) return null;
  const ms = SCENARIO_SCORE[aiOutput.match_state] ?? 50;
  const pq = PRESSURE_QUALITY_SCORE[aiOutput.favorite_pressure] ?? 50;
  const tr = TEMPO_LATE_RISK_SCORE[aiOutput.tempo_state] ?? 50;
  return clamp(ms * 0.45 + pq * 0.35 + tr * 0.20, 0, 100);
}

function computeAgreementAdjustment(aiOutput, predictionType) {
  if (!aiOutput?.recommendation?.action) return 0;
  const klass = ruleClassFromType(predictionType);
  const map = AGREEMENT_MAP[klass];
  const raw = map?.[aiOutput.recommendation.action] ?? 0;
  return clamp(raw, -10, 10);
}

function computeAiWeight(aiConfidence) {
  if (!Number.isFinite(aiConfidence)) return 0.10;
  if (aiConfidence >= 0.75) return 0.20;
  if (aiConfidence >= 0.65) return 0.15;
  return 0.10;
}

function applyAiOverlay({ ruleScore, aiOutput, aiConfidence, predictionType }) {
  if (!aiOutput) {
    return { applied: false, finalScore: ruleScore, aiScenarioScore: null, aiWeight: 0, agreementAdjustment: 0 };
  }
  const aiScenarioScore = computeAiScenarioScore(aiOutput);
  const aiWeight = computeAiWeight(aiConfidence);
  const agreementAdjustment = computeAgreementAdjustment(aiOutput, predictionType);
  const blended = ruleScore * (1 - aiWeight) + aiScenarioScore * aiWeight;
  const finalScore = clamp(blended + agreementAdjustment, 0, 100);
  return { applied: true, finalScore, aiScenarioScore, aiWeight, agreementAdjustment };
}

function isPremiumAiSignal({ finalScore, ruleScore, aiOutput, aiConfidence, riskFlags }) {
  if (!aiOutput) return false;
  if (finalScore < 82) return false;
  if (ruleScore < 76) return false;
  if (!Number.isFinite(aiConfidence) || aiConfidence < 0.65) return false;
  const goodScenarios = ['dead', 'low_activity'];
  if (!goodScenarios.includes(aiOutput.match_state)) return false;
  const goodPressure = ['none', 'weak'];
  if (!goodPressure.includes(aiOutput.favorite_pressure)) return false;
  if (aiOutput.tempo_state === 'explosive' || aiOutput.tempo_state === 'growing') return false;
  if (riskFlags?.includes('red_card')) return false;
  if (riskFlags?.includes('late_activation_signs')) return false;
  return true;
}

module.exports = {
  applyAiOverlay,
  isPremiumAiSignal,
  computeAiScenarioScore,
  computeAgreementAdjustment,
  computeAiWeight,
  SCENARIO_SCORE,
  PRESSURE_QUALITY_SCORE,
  TEMPO_LATE_RISK_SCORE,
};
