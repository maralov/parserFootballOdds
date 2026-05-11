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

/**
 * Scores TB0.5 candidate quality (0-3 points).
 * Returns { score, reasons } where score 3=all signals, 2=strong, 1=partial, 0=weak
 */
function evaluateTbCandidateQuality(w7080Totals, modelSignals, aiOutput80) {
  let score = 0;
  const reasons = [];

  // Component 1: Real pressure quality (xG or shots)
  const t = w7080Totals;
  if (t) {
    const xg = typeof t.xg === 'number' ? t.xg : 0;
    const sot = t.shotsOnTarget ?? 0;
    const trend = modelSignals?.tempoTrend70_80;
    if (xg >= 0.6 || (sot >= 3 && (trend === 'growing' || trend === 'explosive'))) {
      score += 1;
      reasons.push(`tb_quality_pressure xg=${xg} sot=${sot} trend=${trend}`);
    }
  }

  // Component 2: Pressure direction (one team clearly pushing)
  // Use available totals — if one team dominates via AI pressure_team field
  if (aiOutput80?.pressure_team && aiOutput80.pressure_team !== 'none' && aiOutput80.pressure_team !== 'both') {
    const pq = aiOutput80.pressure_quality;
    if (pq === 'real') {
      score += 1;
      reasons.push(`tb_quality_direction team=${aiOutput80.pressure_team} quality=${pq}`);
    }
  }

  // Component 3: Motivation asymmetry (one team must score)
  const motiv = aiOutput80?.motivation_asymmetry;
  if (motiv?.team_that_must_score && motiv.team_that_must_score !== 'none' && motiv.strength === 'high') {
    score += 1;
    reasons.push(`tb_quality_motivation team=${motiv.team_that_must_score} strength=${motiv.strength}`);
  }

  return { score, reasons };
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

  // Pre-match draw odds: open match (draw > 4.0) → boost TB; closed (draw < 3.0) → suppress
  const drawOdds = match.odds?.draw != null ? Number(match.odds.draw) : null;
  let oddsAdjustment = 0;
  if (drawOdds != null && Number.isFinite(drawOdds) && drawOdds > 0) {
    if (drawOdds > 4.0) {
      oddsAdjustment = 5;   // open match, 0:0 was unexpected → TB more likely
      reasons.push(`odds_open_match draw=${drawOdds}`);
    } else if (drawOdds < 3.0) {
      oddsAdjustment = -5;  // closed match, 0:0 expected → suppress TB
      reasons.push(`odds_closed_match draw=${drawOdds}`);
    }
  }

  let effectiveLate = Math.max(0, Math.min(100, late + oddsAdjustment));

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

  const tbQuality = evaluateTbCandidateQuality(w7080, computed.modelSignals, aiOutput80);
  const qualityGate = qualityOkDetailedOrBasic || tbQuality.score >= 2;

  let predictionType = PRED_TYPES_80.NO_BET;

  const tbActionableCandidate =
    !redWarn &&
    effectiveLate >= 72 &&
    real80 >= 60 &&
    fake80 < 55 &&
    qualityGate;

  const tbLeanCandidate =
    !redWarn &&
    effectiveLate >= 60 &&
    effectiveLate < 72 &&
    real80 >= 52 &&
    fake80 < 65 &&
    qualityGate;

  const fakeShield = fake80 >= 62 || (fake80 >= 55 && real80 < 48 && effectiveLate < 68);

  if (tbActionableCandidate) {
    predictionType = PRED_TYPES_80.TB05_80_PLUS;
    reasons.push(`tb_actionable_core late=${effectiveLate} real=${real80} fake=${fake80}`);
  } else if (tbLeanCandidate) {
    predictionType = PRED_TYPES_80.LEAN_TB05_80_PLUS;
    reasons.push(`lean_tb late=${effectiveLate} real=${real80} fake=${fake80}`);
  } else if (!redWarn && fakeShield) {
    predictionType = PRED_TYPES_80.PROTECT_UNDER;
    reasons.push(`fake_pressure_shield TB unlikely fake=${fake80} real=${real80}`);
  }

  if (tbActionableCandidate || tbLeanCandidate) {
    reasons.push(...tbQuality.reasons);
  }

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
      const blendedLate = effectiveLate * (1 - aiWeight) + tbAiScore * aiWeight;
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
      tbQualityScore: tbQuality.score,
      oddsAdjustment,
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
      featuresSnapshot: {
        totals70_80: w7080,
        modelScoresRaw: mr,
        aiOutput: aiOutput80 ?? null,
        drawOdds,
        oddsAdjustment,
      },
      finalResult: null,
      hit: null,
      missingDetailed: statsLevel === 'detailed' && (!w7080 || w7080.xg == null),
    },
  };
}

module.exports = { evaluateDecision80, evaluateTbCandidateQuality };
