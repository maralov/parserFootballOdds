'use strict';

const { CHECKPOINTS, TARGET_MARKET, PRED_TYPES_80 } = require('./constants');
const { buildConfidence, dataQualityTier } = require('./confidence');
const { computeAiWeight, computeAiScenarioScore } = require('./aiOverlay');

function totalsFrom(win) {
  return win?.totals ?? null;
}

function passesBasicTbGates7080(w7080Totals) {
  const t = w7080Totals;
  if (!t) return false;
  return (
    (t.totalShots ?? 0) >= 3 &&
    (t.shotsOnTarget ?? 0) >= 1 &&
    (t.corners ?? 0) >= 1
  );
}

function passesDetailedTbAdvantage7080(w7080Totals) {
  const t = w7080Totals;
  if (!t) return false;
  const xg = t.xg;
  const xgot = Number(t.xgot ?? 0);
  return (
    (xg != null && xg >= 0.15) ||
    xgot > 0 ||
    (t.bigChances ?? 0) >= 1 ||
    (t.shotsOnTarget ?? 0) >= 1
  );
}

function evaluateDecision80(match, computed) {
  const reasons = [];
  const riskFlags = [];

  if (match.predictionLocks?.blockTb80Plus) {
    riskFlags.push('locked_after_tm60_signal');
    const modelMode = match.statsLevel === 'detailed' ? 'detailed' : 'basic';
    const confidence = 0.35;
    const predictionType = PRED_TYPES_80.NO_BET;
    const actionablePrimary = false;
    return {
      checkpoint: CHECKPOINTS.DECISION_80,
      target: TARGET_MARKET.decision80,
      predictionType,
      actionable: false,
      actionablePrimary,
      finalScore: 0,
      confidence,
      modelMode,
      mode: modelMode,
      useInTelegram: actionablePrimary || (predictionType !== PRED_TYPES_80.NO_BET && confidence >= 0.70),
      useInBacktest: false,
      components: {
        lateGoalScore80: 0,
        realPressureScore: 0,
        fakePressureScore: 0,
        finalScore: 0,
      },
      reasons: ['blocked_by_prediction_lock_tm60'],
      riskFlags,
      aiApplied: false,
      aiScenarioScore: null,
      predictionAudit: {
        matchId: match.matchId,
        checkpoint: CHECKPOINTS.DECISION_80,
        predictionType: PRED_TYPES_80.NO_BET,
        score: 0,
        confidence: 0.35,
        components: {},
        featuresSnapshot: { predictionLocks: match.predictionLocks, aiOutput: null },
        finalResult: null,
        hit: null,
      },
    };
  }

  const w7080 = totalsFrom(computed?.windows?.window70_80);
  const mr = computed.modelScoresRaw || {};
  const late = mr.lateGoalScore80 ?? 0;
  const real80 = mr.realPressureScore80 ?? 0;
  const fake80 = mr.fakePressureScore80 ?? 0;

  const ai80 = match.aiAnalysis?.decision80;
  const aiOutput80 = ai80?.output ?? null;
  const aiConfidence80 = typeof ai80?.confidence === 'number' ? ai80.confidence : null;
  const aiUseInModel = ai80?.useInModel === true;

  const statsLevel = match.statsLevel || 'basic';
  const snapN = computed.snapshotCount ?? 0;
  if (snapN < 3) riskFlags.push('low_snapshot_count');

  const redWarn = Boolean(computed.pressure?.redCards?.anyRed);
  if (redWarn) riskFlags.push('red_card');

  if (w7080 && w7080.xg == null) riskFlags.push('missing_xg');
  if (statsLevel === 'detailed' && w7080?.xgot == null) riskFlags.push('missing_xgot');
  if (fake80 >= 55 && fake80 > real80 + 8) riskFlags.push('fake_pressure');
  if (computed.modelSignals?.tempoTrend70_80 === 'unknown') riskFlags.push('sparse_snapshots');

  if (statsLevel === 'basic') {
    reasons.push('model_uses_basic_stats');
    riskFlags.push('basic_stats_only');
  }

  const qualityOkDetailedOrBasic =
    statsLevel === 'basic'
      ? passesBasicTbGates7080(w7080)
      : (passesDetailedTbAdvantage7080(w7080) || passesBasicTbGates7080(w7080));

  let predictionType = PRED_TYPES_80.NO_BET;

  const tbActionableCandidate =
    !redWarn &&
    late >= 72 &&
    real80 >= 60 &&
    fake80 < 55 &&
    qualityOkDetailedOrBasic;

  const tbLeanCandidate =
    !redWarn &&
    late >= 60 &&
    late < 72 &&
    real80 >= 52 &&
    fake80 < 65 &&
    qualityOkDetailedOrBasic;

  const fakeShield = fake80 >= 62 || (fake80 >= 55 && real80 < 48 && late < 68);

  if (tbActionableCandidate) {
    predictionType = PRED_TYPES_80.TB05_80_PLUS;
    reasons.push(`tb_actionable_core late=${late} real=${real80} fake=${fake80}`);
  } else if (tbLeanCandidate) {
    predictionType = PRED_TYPES_80.LEAN_TB05_80_PLUS;
    reasons.push(`lean_tb late=${late} real=${real80} fake=${fake80}`);
  } else if (!redWarn && fakeShield) {
    predictionType = PRED_TYPES_80.PROTECT_UNDER;
    reasons.push(`fake_pressure_shield TB unlikely fake=${fake80} real=${real80}`);
  }

  let effectiveLate = late;
  let aiApplied = false;
  let aiScenarioScore80 = null;

  if (aiUseInModel && aiOutput80) {
    // For TB0.5: invert the aiScenarioScore (which is TM-oriented: high=nil-nil)
    // TB wants low nil-nil likelihood → we want "1 - nilNilScore" as TB signal
    const rawAiScore = computeAiScenarioScore(aiOutput80);
    // TB signal: high when AI sees pressure/goals likely
    const tbAiScore = rawAiScore != null ? 100 - rawAiScore : null;
    if (tbAiScore != null) {
      const aiWeight = computeAiWeight(aiConfidence80);
      const blendedLate = late * (1 - aiWeight) + tbAiScore * aiWeight;
      const clampedLate = Math.max(0, Math.min(100, blendedLate));
      effectiveLate = clampedLate;
      aiApplied = true;
      aiScenarioScore80 = tbAiScore;

      // AI upgrade: LEAN → PRIMARY if AI shows strong pressure signal
      const isAiHighPressure = ['high_pressure', 'pressure_building'].includes(aiOutput80?.match_state);
      const isAiFavoritePressureStrong = aiOutput80?.favorite_pressure === 'strong';
      if (
        predictionType === PRED_TYPES_80.LEAN_TB05_80_PLUS &&
        isAiHighPressure &&
        isAiFavoritePressureStrong &&
        aiConfidence80 != null && aiConfidence80 >= 0.65 &&
        clampedLate >= 68
      ) {
        predictionType = PRED_TYPES_80.TB05_80_PLUS;
        reasons.push(`ai_upgrade_lean_to_primary ai_state=${aiOutput80.match_state} ai_pressure=${aiOutput80.favorite_pressure}`);
      }

      // AI block: if AI says dead/no pressure, block TB prediction
      const isAiDead = aiOutput80?.match_state === 'dead';
      const isAiNoPressure = aiOutput80?.favorite_pressure === 'none';
      if (
        (predictionType === PRED_TYPES_80.TB05_80_PLUS || predictionType === PRED_TYPES_80.LEAN_TB05_80_PLUS) &&
        isAiDead &&
        isAiNoPressure
      ) {
        predictionType = PRED_TYPES_80.NO_BET;
        reasons.push(`ai_block_tb dead_match_no_pressure ai_state=${aiOutput80.match_state}`);
      }
    }
  }

  if (aiApplied && !reasons.some(r => r.startsWith('ai_'))) {
    reasons.push(`ai_confirmed scenario=${aiOutput80?.match_state} tbSignal=${aiScenarioScore80?.toFixed(0)}`);
  }

  let dq = dataQualityTier({
    statsLevel,
    hasNg: !(w7080 && w7080.xg == null),
    hasNxgot: !(statsLevel === 'detailed' && w7080 && w7080.xgot == null),
  });

  const activationThreshold =
    predictionType === PRED_TYPES_80.TB05_80_PLUS ? 72
      : predictionType === PRED_TYPES_80.LEAN_TB05_80_PLUS ? 58
        : predictionType === PRED_TYPES_80.PROTECT_UNDER ? 55 : 54;

  const primaryScore =
    predictionType === PRED_TYPES_80.NO_BET ? 45 : predictionType === PRED_TYPES_80.PROTECT_UNDER ? fake80 : effectiveLate;

  const lowSnapshotCount = snapN < 3;
  const isHotButNoGoal = computed?.firstHalfProfile?.isHotButNoGoal === true;
  const modelMode = statsLevel === 'detailed' ? 'detailed' : 'basic';

  const confidence = buildConfidence({
    finalScore: predictionType === PRED_TYPES_80.NO_BET ? activationThreshold : Math.max(primaryScore, activationThreshold * 0.98),
    activationThreshold,
    dataQuality: dq,
    reasonsCount: reasons.length,
    lateActivationRisk: 0,
    realPressureScore: real80,
    isHotButNoGoal,
    hasRedCard: redWarn,
    statsLevel,
    lowSnapshotCount,
    modelMode,
  });

  const actionable =
    predictionType === PRED_TYPES_80.TB05_80_PLUS ||
    predictionType === PRED_TYPES_80.LEAN_TB05_80_PLUS ||
    predictionType === PRED_TYPES_80.PROTECT_UNDER;

  const actionablePrimary = predictionType === PRED_TYPES_80.TB05_80_PLUS;

  return {
    checkpoint: CHECKPOINTS.DECISION_80,
    target: TARGET_MARKET.decision80,
    predictionType,
    actionable,
    actionablePrimary,
    finalScore: primaryScore,
    confidence,
    modelMode,
    mode: modelMode,
    useInTelegram: actionablePrimary || (predictionType !== PRED_TYPES_80.NO_BET && confidence >= 0.70),
    useInBacktest: predictionType !== PRED_TYPES_80.NO_BET,
    components: {
      lateGoalScore80: effectiveLate,
      realPressureScore: real80,
      fakePressureScore: fake80,
      finalScore: primaryScore,
    },
    reasons,
    riskFlags: [...new Set(riskFlags)],
    aiApplied,
    aiScenarioScore: aiScenarioScore80,
    predictionAudit: {
      matchId: match.matchId,
      checkpoint: CHECKPOINTS.DECISION_80,
      predictionType,
      score: primaryScore,
      confidence,
      components: {},
      featuresSnapshot: { totals70_80: w7080, modelScoresRaw: mr, aiOutput: aiOutput80 ?? null },
      finalResult: null,
      hit: null,
      missingDetailed: statsLevel === 'detailed' && (!w7080 || w7080.xg == null),
    },
  };
}

module.exports = { evaluateDecision80 };
