'use strict';

const { CHECKPOINTS, TARGET_MARKET, PRED_TYPES_60 } = require('./constants');
const { buildConfidence, dataQualityTier } = require('./confidence');

const LATE_ACTIVATION_HARD_CAP = 60;
const REAL_PRESSURE_HARD_CAP = 60;

/** Жорсткі ознаки «реального тиску» в агрегаті між 60' і межею decision-віку. */
function hardRealPressureTotals(totals) {
  if (!totals) return false;
  if ((totals.shotsOnTarget ?? 0) >= 1) return true;
  const xg = totals.xg;
  if (xg != null && xg >= 0.15) return true;
  if ((totals.xgot ?? 0) > 0) return true;
  if ((totals.bigChances ?? 0) >= 1) return true;
  if ((totals.shotsInsideBox ?? 0) >= 2) return true;
  return false;
}

function nonEmptyFiniteSamples(values) {
  return values.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Перевірка «сухого» тиску у доступних дробинках доріжки до 75'. */
function allRealPressureQuiet(ms, ceiling = 35) {
  const r = ms?.realPressureScores || {};
  const arr = nonEmptyFiniteSamples([
    r.window45_60,
    r.window65_70,
    r.window70_75,
    r.windowTracked6075,
  ]);
  if (!arr.length) return false;
  return arr.every((v) => v < ceiling);
}

function extendedPremiumGates({ fh, sinceHt, statsLevel }) {
  if (statsLevel !== 'detailed' || !fh || !sinceHt) return false;

  const xgOk = fh.totalXg != null && fh.totalXg <= 0.80;
  const xgotOk = fh.totalXgot != null && fh.totalXgot <= 0.50;
  const bcOk = (fh.totalBigChances ?? 0) === 0;
  const sotOk = (fh.totalShotsOnTarget ?? 0) <= 3;
  const sibOk = fh.totalShotsInsideBox == null ? true : fh.totalShotsInsideBox <= 6;

  const stXgOk = sinceHt.xg != null && sinceHt.xg <= 0.12;
  const stXgotOk = (sinceHt.xgot ?? 0) === 0;
  const stBcOk = (sinceHt.bigChances ?? 0) === 0;
  const stSotOk = (sinceHt.shotsOnTarget ?? 0) === 0;
  const stSibOk = (sinceHt.shotsInsideBox ?? 0) <= 1;
  const stTouchOk = (sinceHt.touchesInBox ?? 0) <= 5;

  return Boolean(
    xgOk &&
    xgotOk &&
    bcOk &&
    sotOk &&
    sibOk &&
    stXgOk &&
    stXgotOk &&
    stBcOk &&
    stSotOk &&
    stSibOk &&
    stTouchOk,
  );
}

function basicPremiumGates({ liveTotals, windows, sinceHt, ms }) {
  const rp45 = ms?.realPressureScores?.window45_60 ?? 999;
  if (!Number.isFinite(rp45) || rp45 >= 35) return false;

  const w456 = windows?.window45_60?.totals;
  const shots456 = w456?.totalShots ?? 0;

  if (!liveTotals) return false;

  const shtTotalOk = (liveTotals.shotsOnTarget ?? 999) <= 2;
  const sotHtOk = sinceHt ? (sinceHt.shotsOnTarget ?? 999) === 0 : false;
  const shots456Ok = shots456 <= 2;
  const cornersHtOk = sinceHt ? (sinceHt.corners ?? 999) <= 2 : false;
  const tempoOk =
    ms?.tempoTrend6075 !== 'explosive' &&
    ms?.tempoTrend6075 !== 'growing';

  return Boolean(shtTotalOk && sotHtOk && shots456Ok && cornersHtOk && tempoOk);
}

function strongFavoriteSiegeViolates(ms, sinceHt) {
  if (!ms?.favoriteContext?.isStrongContext) return false;
  if (!sinceHt) return true;
  return !(
    (sinceHt.shotsOnTarget ?? 0) === 0 &&
    (sinceHt.xg ?? 0) <= 0.1 &&
    (sinceHt.touchesInBox ?? 0) <= 4
  );
}

function evaluateDecision60(match, computed) {
  const reasons = [];
  const riskFlags = [];

  const ms = computed.modelSignals;
  const windows = computed.windows || {};

  const statsLevel = match.statsLevel || 'basic';
  const snapN = computed.snapshotCount ?? 0;
  const redBlocked = Boolean(computed.pressure?.redCards?.anyRed);

  const sinceHt = ms?.sinceHtTotalsSnapshot ?? null;
  const liveTotals = ms?.cumulativeLiveTotals ?? null;
  const fh = computed.firstHalfProfile;
  const tracked6075Totals = windows.window60_toTracked75?.totals ?? null;

  let predictionType = PRED_TYPES_60.NO_BET;
  let tier = null;

  const tempoBad = ms?.tempoTrend6075 === 'growing' || ms?.tempoTrend6075 === 'explosive';
  const trackedHard = hardRealPressureTotals(tracked6075Totals);

  const hot1hDanger = Boolean(ms?.hotFirstHalfDanger);
  const siegeBad = strongFavoriteSiegeViolates(ms, sinceHt);

  const ftScore = ms?.fullTimeNilNilScore ?? 0;
  const lateAct = ms?.lateActivationRisk ?? 0;
  const rpHardMax = Math.max(
    ms?.realPressureScores?.window45_60 ?? 0,
    ms?.realPressureScores?.window60_70 ?? 0,
    ms?.realPressureScores?.window65_70 ?? 0,
    ms?.realPressureScores?.window70_75 ?? 0,
    ms?.realPressureScores?.windowTracked6075 ?? 0,
  );

  const hasNgDetailed = !!(sinceHt?.xg != null || tracked6075Totals?.xg != null);
  const missingXgotFlag = statsLevel === 'detailed' && sinceHt?.xgot == null;

  if (snapN < 4) riskFlags.push('low_snapshot_count');
  if (redBlocked) riskFlags.push('red_card');
  if ((liveTotals?.yellowCardsTotal ?? 0) >= 4 || (ms?.chaosRisk ?? 0) >= 65) {
    riskFlags.push('chaos_cards');
  }
  if (sinceHt?.xg == null && statsLevel === 'detailed') riskFlags.push('missing_xg');
  if (missingXgotFlag) riskFlags.push('missing_xgot');
  if (statsLevel === 'basic') riskFlags.push('basic_stats_only');

  if (redBlocked) {
    predictionType = PRED_TYPES_60.NO_BET;
    reasons.push('blocked_red_card_ft_nil_nil');
  }

  /** Нема коректних live cumulative — утримуємось. */
  else if (!liveTotals || !sinceHt) {
    predictionType = PRED_TYPES_60.NO_BET;
    reasons.push('insufficient_live_stats_for_ft_projection');
    riskFlags.push('data_inconsistent');
  }

  else if (lateAct >= LATE_ACTIVATION_HARD_CAP) {
    predictionType = PRED_TYPES_60.NO_BET;
    reasons.push('late_activation_risk_too_high');
    riskFlags.push('late_activation_signs');
  }

  else if (rpHardMax >= REAL_PRESSURE_HARD_CAP) {
    predictionType = PRED_TYPES_60.NO_BET;
    reasons.push('real_pressure_too_high');
    riskFlags.push('late_activation_signs');
  }

  else if (tempoBad) {
    predictionType = PRED_TYPES_60.NO_BET;
    reasons.push('late_activation_tempo_negative');
    riskFlags.push('late_activation_signs');
  }

  else if (trackedHard) {
    predictionType = PRED_TYPES_60.NO_BET;
    reasons.push('real_pressure_present_in_entered_slice');
    riskFlags.push('late_activation_signs');
  }

  else if (tempoBad === false && trackedHard === false) {
    reasons.push(`fullTimeNilNilScore=${ftScore}`);
    reasons.push(`lateActivationRisk=${lateAct}`);
    reasons.push(`tempoTrend=${ms?.tempoTrend6075 ?? '?'}`);

    const larCeilExtended = siegeBad ? 30 : 38;
    const larCeilBasic = siegeBad ? 28 : 35;

    const extendedOkPre =
      !hot1hDanger &&
      !siegeBad &&
      extendedPremiumGates({ fh, sinceHt, statsLevel }) &&
      lateAct < larCeilExtended &&
      allRealPressureQuiet(ms, 35);

    const basicOkPre =
      basicPremiumGates({ liveTotals, windows, sinceHt, ms }) &&
      lateAct < larCeilBasic &&
      allRealPressureQuiet(ms);

    const riskCandidate =
      (hot1hDanger && lateAct < 62) ||
      (lateAct >= 42 && ftScore >= 54);

    if (extendedOkPre && ftScore >= 76) {
      predictionType = PRED_TYPES_60.FT_TM05_FROM_60_75;
      tier = 'extended_ft';
      reasons.push('extended_ft_candidate');
    }

    /** Basic premium пакунок (дуже обмежений). */
    else if (
      basicOkPre &&
      ftScore >= 70 &&
      (sinceHt.shotsOnTarget ?? 999) === 0 &&
      (sinceHt.bigChances ?? 0) === 0 &&
      lateAct <= 34
    ) {
      predictionType = PRED_TYPES_60.FT_TM05_FROM_60_75;
      tier = 'basic_ft';
      reasons.push('basic_ft_candidate');
    } else if (ftScore >= 58 && lateAct < 54) {
      predictionType = PRED_TYPES_60.LEAN_FT_TM05_FROM_60_75;
      tier = 'lean_ft';
      reasons.push('weak_positive_ft_tm_context');
    } else if (riskCandidate) {
      predictionType = PRED_TYPES_60.FT_TM05_RISK;
      reasons.push('ft_tm_residual_risk');
    }
  }

  if (predictionType !== PRED_TYPES_60.NO_BET && siegeBad) {
    if (predictionType === PRED_TYPES_60.FT_TM05_FROM_60_75) {
      predictionType = PRED_TYPES_60.NO_BET;
      tier = null;
      reasons.push('favorite_siege_no_premium_ft');
      riskFlags.push('favorite_siege_risk');
    } else if (
      predictionType === PRED_TYPES_60.LEAN_FT_TM05_FROM_60_75 &&
      sinceHt &&
      sinceHt.shotsOnTarget !== 0
    ) {
      predictionType = PRED_TYPES_60.FT_TM05_RISK;
      tier = null;
      reasons.push('favorite_siege_downgrade');
      riskFlags.push('favorite_siege_risk');
    }
  }

  if (
    predictionType === PRED_TYPES_60.FT_TM05_FROM_60_75 &&
    hot1hDanger
  ) {
    predictionType = PRED_TYPES_60.LEAN_FT_TM05_FROM_60_75;
    tier = 'lean_hot_half_derisk';
    reasons.push('downgrade_hot_first_half');
  }

  const dqBase = dataQualityTier({
    statsLevel,
    hasNg: hasNgDetailed,
    hasNxgot: (sinceHt && sinceHt.xgot != null) || statsLevel !== 'detailed',
  });
  const dqAdj = dqBase - (ms.confidencePenalty || 0);
  let dq = Math.max(0.36, Math.min(1, dqAdj));

  const activationGate =
    predictionType === PRED_TYPES_60.FT_TM05_FROM_60_75
      ? tier === 'extended_ft' ? 76 : tier === 'basic_ft' ? 70 : 75
      : predictionType === PRED_TYPES_60.LEAN_FT_TM05_FROM_60_75 ? 58
        : predictionType === PRED_TYPES_60.FT_TM05_RISK ? 48
          : 50;

  let confidence = buildConfidence({
    finalScore: predictionType === PRED_TYPES_60.NO_BET
      ? 50
      : Math.max(ftScore, activationGate * 0.98),
    activationThreshold:
      predictionType === PRED_TYPES_60.NO_BET ? 50 : activationGate,
    dataQuality: dq,
    reasonsCount: reasons.length,
  });
  confidence = Math.max(
    predictionType === PRED_TYPES_60.NO_BET ? 0.35 : 0.38,
    confidence - (ms.confidencePenalty || 0),
  );

  if (tier === 'basic_ft') confidence = Math.min(confidence, 0.68);

  const actionablePrimary =
    predictionType === PRED_TYPES_60.FT_TM05_FROM_60_75 &&
    (tier === 'extended_ft' || tier === 'basic_ft');
  const actionable =
    actionablePrimary ||
    predictionType === PRED_TYPES_60.LEAN_FT_TM05_FROM_60_75;

  return finalizeReturn({
    match,
    predictionType,
    tier,
    actionable,
    actionablePrimary,
    confidence,
    ftScore,
    reasons,
    riskFlags,
    ms,
    sinceHt,
    tracked6075Totals,
    statsLevel,
    hot1hDanger,
    missingXgotFlag,
    hasNgDetailed,
  });
}

function finalizeReturn(p) {
  const {
    match,
    predictionType,
    tier,
    actionable,
    actionablePrimary,
    confidence,
    ftScore,
    reasons,
    riskFlags,
    ms,
    sinceHt,
    tracked6075Totals,
    statsLevel,
    hot1hDanger,
    missingXgotFlag,
    hasNgDetailed,
  } = p;

  const result = {
    checkpoint: CHECKPOINTS.DECISION_60,
    target: TARGET_MARKET.decision60,
    tier,
    predictionType,
    actionable,
    actionablePrimary,
    finalScore: ftScore,
    confidence,
    modelMode: statsLevel === 'detailed' ? 'detailed' : 'basic',
    components: {
      fullTimeNilNilScore: ftScore,
      dryStateScore: ms?.dryStateScore,
      lateActivationRisk: ms?.lateActivationRisk,
      realPressureScores: ms?.realPressureScores,
      chaosRisk: ms?.chaosRisk,
      tempoTrend6075: ms?.tempoTrend6075,
      favoriteDesperationRisk: ms?.favoriteDesperationRisk,
    },
    reasons,
    riskFlags: [...new Set(riskFlags)],
    predictionAudit: {
      matchId: match.matchId,
      checkpoint: CHECKPOINTS.DECISION_60,
      predictionType,
      score: ftScore,
      confidence,
      components: {},
      featuresSnapshot: {
        modelSignals: ms,
        totalsTracked6075: tracked6075Totals,
        sinceHtTotals: sinceHt,
      },
      finalResult: null,
      hit: null,
      missingDetailed: statsLevel === 'detailed' && (!hasNgDetailed || missingXgotFlag),
      hotFirstHalfDanger: hot1hDanger,
    },
  };
  result.predictionAudit.components = { ...result.components };
  return result;
}

module.exports = { evaluateDecision60 };
