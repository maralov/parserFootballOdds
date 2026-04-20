const { applyOddsContext } = require('./oddsContext');
const { buildScoreContext } = require('./scoreContext');
const { buildDominanceMetrics } = require('./dominanceMetrics');
const { buildMarketContext } = require('./marketContextV2');
const { computeSegmentFeatures } = require('./segmentMetrics');
const {
  LIVE_SEGMENT_STEP_MINUTES,
  LIVE_DECISION_WINDOW_START_MINUTE,
  LIVE_WINDOW_END_60_70,
  LIVE_WINDOW_END_70_80,
  LIVE_V2_MIN_SIGNAL_QUALITY_TELEGRAM,
  LIVE_V2_UNDER_CONFIRM_SNAPSHOTS,
  LIVE_V2_PDRY_MIN_60_70,
  LIVE_V2_PGOAL_MAX_60_70,
  LIVE_V2_PGOAL_MIN_70_80,
  LIVE_V2_PDRY_MIN_70_80,
  LIVE_V2_PGOAL_MIN_80,
  LIVE_V2_BURST_MIN_SOT,
  LIVE_V2_BURST_MIN_XG,
  LIVE_V2_LATE_SURGE_RATIO,
  LIVE_70_80_TIE_BREAK_MARGIN,
  LIVE_V3_PDRY_MIN_60_70,
  LIVE_V3_SQ_MIN_60_70,
  LIVE_V3_SQ_MIN_70_80,
  LIVE_V3_MIN_SNAPSHOTS,
} = require('../helpers/constants');
const { computePreMatchBasePBias } = require('./preMatchFormBias');

function getLiveTimeWindow(minute) {
  const m = Number(minute);
  const e70 = LIVE_WINDOW_END_60_70;
  const e80 = LIVE_WINDOW_END_70_80;
  const w0 = LIVE_DECISION_WINDOW_START_MINUTE;
  if (!Number.isFinite(m) || m < w0) return 'before';
  if (m < e70) return '60-70';
  if (m < e80) return '70-80';
  if (m <= 120) return '80-90+';
  return 'after';
}

function drySignalsFromRaw(raw2H) {
  if (!raw2H) {
    return { strength: 0, strong: false, soft: false };
  }
  const sot = Number(raw2H.shotsOnTarget ?? 0);
  const xg = Number(raw2H.expectedGoalsXg ?? 0);
  const touch = Number(raw2H.touchesInOppositionBox ?? 0);
  const bc = Number(raw2H.bigChances ?? 0);
  let strength = 0;
  if (sot <= 1) strength += 0.24;
  if (xg < 0.4) strength += 0.2;
  if (touch < 16) strength += 0.16;
  if (bc === 0 && sot + (Number(raw2H.totalShots) || 0) > 4) strength += 0.08;
  strength = Math.min(1, strength);
  return {
    strength: Number(strength.toFixed(4)),
    strong: strength >= 0.42,
    soft: strength >= 0.22,
  };
}

function classifyState({ dry, segment, dom, scoreCtx }) {
  const trailingDom =
    scoreCtx.trailingSide &&
    dom.dominanceSide === scoreCtx.trailingSide &&
    dom.dominanceStrength >= 0.56;

  const lateSurgeSeg =
    segment &&
    segment.vsSecondHalfRatio != null &&
    segment.vsSecondHalfRatio >= LIVE_V2_LATE_SURGE_RATIO &&
    segment.currentMinute >= 74;

  if (lateSurgeSeg) return 'lateSurge';
  if (trailingDom) return 'desperatePressure';
  if (dry.strong && scoreCtx.isZeroZero) return 'dry';
  if (dry.strong && scoreCtx.leadingSide && dom.dominanceSide === scoreCtx.leadingSide) {
    return 'tacticalDry';
  }
  if (segment?.trendDirection === 'up') return 'pressureGrowth';
  if (segment?.trendDirection === 'down') return 'pressureCollapse';
  if (dry.soft && scoreCtx.isZeroZero && segment?.comparisonLabel === 'weaker_than_2h_avg') {
    return 'falseDry';
  }
  if (
    dom.oneSidedPressure &&
    scoreCtx.isZeroZero &&
    dom.dominanceStrength >= 0.6 &&
    segment?.vsSecondHalfRatio != null &&
    segment.vsSecondHalfRatio < 0.92
  ) {
    return 'accumulatedPressure';
  }
  return 'neutral';
}

function buildRedCardContext(incidents, scoreCtx) {
  const h = incidents?.homeRedCards ?? 0;
  const a = incidents?.awayRedCards ?? 0;
  const u = incidents?.unknownRedCards ?? 0;
  const side = h > 0 && a > 0 ? 'both' : h > 0 ? 'home' : a > 0 ? 'away' : u > 0 ? 'unknown' : null;

  let redCardTeamIsLeading = null;
  let redCardTeamIsTrailing = null;
  if (side === 'home') {
    redCardTeamIsLeading = scoreCtx.leadingSide === 'home';
    redCardTeamIsTrailing = scoreCtx.trailingSide === 'home';
  } else if (side === 'away') {
    redCardTeamIsLeading = scoreCtx.leadingSide === 'away';
    redCardTeamIsTrailing = scoreCtx.trailingSide === 'away';
  }

  return {
    redCardState: side ? 'present' : 'none',
    redCardSide: side,
    redCardMinute: null,
    redCardTeamIsLeading,
    redCardTeamIsTrailing,
    homeRedCards: h,
    awayRedCards: a,
    unknownRedCards: u,
  };
}

function computeBasePGoal({ segment, dry, state, scoreCtx, market, redCtx }) {
  let p = 0.44;

  if (segment?.vsSecondHalfRatio != null) {
    if (segment.vsSecondHalfRatio >= 1.14) p += 0.07;
    if (segment.vsSecondHalfRatio <= 0.86) p -= 0.06;
  }
  if (segment?.trendDirection === 'up') p += 0.05;
  if (segment?.trendDirection === 'down') p -= 0.04;

  if (scoreCtx.isZeroZero) {
    if (dry.strong) p -= 0.1;
    else if (dry.soft) p -= 0.04;
  } else {
    if (state === 'tacticalDry') p -= 0.05;
    if (state === 'desperatePressure') p += 0.08;
  }

  if (state === 'lateSurge') p += 0.07;
  if (state === 'pressureCollapse') p -= 0.05;
  if (state === 'accumulatedPressure') p += 0.05;

  p += market.marketPressureBias;

  const rc = (redCtx.homeRedCards || 0) + (redCtx.awayRedCards || 0) + (redCtx.unknownRedCards || 0);
  if (rc > 0) p += Math.min(0.11, 0.035 * rc);

  p = Math.max(0.08, Math.min(0.92, p));
  return Number(p.toFixed(4));
}

function computeSignalQuality(features, historyLen, state, pGoal) {
  let q = 0.36;
  q += (features.dataQualityScore || 0) * 0.3;
  q += Math.min(0.22, (historyLen / 14) * 0.22);
  if (Math.abs(pGoal - 0.5) >= 0.1) q += 0.08;
  if (state === 'neutral' || state === 'falseDry') q -= 0.06;
  return Number(Math.max(0, Math.min(1, q)).toFixed(4));
}

function buildStatsReasonLine(features) {
  const raw = features.raw2H || features.rawOverall || {};
  const parts = [];
  if (raw.shotsOnTarget != null) parts.push(`${raw.shotsOnTarget} уд. в площ.`);
  if (raw.bigChances != null) parts.push(`${raw.bigChances} мом.`);
  if (raw.expectedGoalsXg != null) parts.push(`xG ${raw.expectedGoalsXg}`);
  return parts.length ? parts.join(', ') : 'мало даних';
}

/**
 * Спільна оцінка live-моделі (вікна 60–70 / 70–80 / 80+).
 * @param {object} input — той самий контракт, що evaluateLiveModelV2/V3
 * @param {{ applyPreMatchFormBias?: boolean, modelArtifactVersion?: string, scoredVersion?: string }} [options]
 */
function evaluateLiveModel(input, options = {}) {
  const applyPre = Boolean(options.applyPreMatchFormBias);
  const reasonTag = applyPre ? 'v3' : 'v2';
  const modelArtifactVersion = options.modelArtifactVersion || (applyPre ? '3.0.0' : '2.0.0');
  const scoredVersion = options.scoredVersion || (applyPre ? 'v3' : 'v2');

  const {
    match,
    features,
    odds1X2,
    incidents,
    history,
    secondHalfSides,
    previousState,
    prevBet,
    liveTrajectory,
    preMatchContext,
  } = input;

  const minute = match.minute;
  const tw = getLiveTimeWindow(minute);
  const scoreContext = buildScoreContext(match.score);
  const segmentFeatures = computeSegmentFeatures(history || [], LIVE_SEGMENT_STEP_MINUTES);
  const dom = buildDominanceMetrics(secondHalfSides || {});
  const marketContext = buildMarketContext(odds1X2);
  const redCardContext = buildRedCardContext(incidents || {}, scoreContext);

  const raw = features.raw2H || {};
  const dry = drySignalsFromRaw(raw);
  const currentState = classifyState({
    dry,
    segment: segmentFeatures,
    dom,
    scoreCtx: scoreContext,
  });
  const stateChanged = previousState != null && previousState !== currentState;

  const baseP = computeBasePGoal({
    segment: segmentFeatures,
    dry,
    state: currentState,
    scoreCtx: scoreContext,
    market: marketContext,
    redCtx: redCardContext,
  });

  const preBias = applyPre
    ? computePreMatchBasePBias(preMatchContext || null, tw, odds1X2)
    : { deltaPGoal: 0, note: '' };

  let basePForOdds = Number((baseP + preBias.deltaPGoal).toFixed(4));
  basePForOdds = Math.max(0.08, Math.min(0.92, basePForOdds));
  const baseDryForOdds = Number((1 - basePForOdds).toFixed(4));

  const twOdds = tw === '60-70' || tw === '70-80' || tw === '80-90+' ? tw : '70-80';
  const oc = applyOddsContext(basePForOdds, baseDryForOdds, twOdds, odds1X2);
  const pGoal = oc.pGoal;
  const pDry = oc.pDry;

  const historyLen = history?.length || 0;
  const signalQuality = computeSignalQuality(features, historyLen, currentState, pGoal);
  const snapshotEvidenceWeight = Number(
    Math.min(1, historyLen / Math.max(3, LIVE_V2_UNDER_CONFIRM_SNAPSHOTS + 2)).toFixed(3)
  );

  const lt = liveTrajectory;
  let burst = false;
  if (lt && lt.deltas && historyLen >= 2) {
    const dSot = lt.deltas.shotsOnTarget;
    const dXg = lt.deltas.expectedGoalsXg;
    burst =
      (dSot != null && dSot >= LIVE_V2_BURST_MIN_SOT) ||
      (dXg != null && dXg >= LIVE_V2_BURST_MIN_XG);
  }

  const substitutionContext = {
    known: false,
    substitutionsDelta: null,
    substitutionsBySide: null,
    substitutionProfile: null,
    tripleSubstitutionFlag: null,
  };

  const leagueBaseline = null;
  const leagueAdjustedPressure = null;
  const leagueAdjustedDryness = null;

  const statsLine = buildStatsReasonLine(features);
  const src = features.statsStatus === 'both' ? '(2H+O)' :
    features.statsStatus === '2h_only' ? '(2H)' : '(O)';

  let bet = 'SKIP';
  let reason = '';

  if (tw === 'before' || tw === 'after') {
    bet = 'SKIP';
    reason = `Поза вікном ${LIVE_DECISION_WINDOW_START_MINUTE}–90+ (${minute}')`;
  } else if (!features.allowDecision) {
    bet = 'SKIP';
    reason = `Недостатньо метрик: ${statsLine} ${src}`;
  } else if (tw === '60-70') {
    const confirmOk = historyLen >= LIVE_V3_MIN_SNAPSHOTS;
    const badState =
      currentState === 'desperatePressure' ||
      currentState === 'lateSurge' ||
      currentState === 'pressureGrowth' ||
      currentState === 'falseDry' ||
      currentState === 'dry' ||
      currentState === 'accumulatedPressure';
    const sqOk60 = signalQuality >= LIVE_V3_SQ_MIN_60_70;
    if (
      confirmOk &&
      !burst &&
      pDry >= LIVE_V3_PDRY_MIN_60_70 &&
      pGoal <= LIVE_V2_PGOAL_MAX_60_70 &&
      sqOk60 &&
      !badState
    ) {
      bet = 'UNDER_0_5';
      reason = `ТМ 60–70 ${reasonTag} | ${statsLine} ${src} | стан=${currentState} | зрізів=${historyLen} | SQ=${signalQuality}`;
    } else {
      reason =
        `60–70 ${reasonTag} очікування: зрізів=${historyLen}/${LIVE_V3_MIN_SNAPSHOTS} burst=${burst} ` +
        `pD=${pDry} pG=${pGoal} SQ=${signalQuality}(мін ${LIVE_V3_SQ_MIN_60_70}) стан=${currentState} | ${statsLine}`;
    }
  } else if (tw === '70-80') {
    const sqOk70 = signalQuality >= LIVE_V3_SQ_MIN_70_80;
    const overOk = pGoal >= LIVE_V2_PGOAL_MIN_70_80 && sqOk70;
    const underOk = pDry >= LIVE_V2_PDRY_MIN_70_80 && pGoal <= 0.55 && sqOk70;
    if (overOk && underOk) {
      const margin = LIVE_70_80_TIE_BREAK_MARGIN;
      if (margin > 0 && Math.abs(pGoal - pDry) < margin) {
        reason = `70–80 ${reasonTag}: tie-break |pG−pD|<${margin} | ${statsLine}`;
      } else {
        bet = pGoal >= pDry ? 'OVER_0_5' : 'UNDER_0_5';
        reason = `${bet === 'OVER_0_5' ? 'ТБ' : 'ТМ'} 70–80 ${reasonTag} | ${statsLine} ${src} | SQ=${signalQuality}`;
      }
    } else if (overOk) {
      bet = 'OVER_0_5';
      reason = `ТБ 70–80 ${reasonTag} | ${statsLine} ${src} | SQ=${signalQuality}`;
    } else if (underOk) {
      bet = 'UNDER_0_5';
      reason = `ТМ 70–80 ${reasonTag} | ${statsLine} ${src} | SQ=${signalQuality}`;
    } else {
      reason = `70–80 ${reasonTag}: немає порогів pG=${pGoal} pD=${pDry} | ${statsLine}`;
    }
  } else if (tw === '80-90+') {
    const implied = marketContext.impliedProb;
    const favBonus = implied && Math.max(implied.home, implied.away) > 0.52 ? 0.04 : 0;
    const pGoalDec = Number(Math.min(1, pGoal + favBonus).toFixed(4));
    const late =
      currentState === 'lateSurge' ||
      (segmentFeatures?.vsSecondHalfRatio != null &&
        segmentFeatures.vsSecondHalfRatio >= LIVE_V2_LATE_SURGE_RATIO &&
        minute >= LIVE_WINDOW_END_70_80 - 3);

    if (pGoalDec >= LIVE_V2_PGOAL_MIN_80 || late) {
      bet = 'OVER_0_5';
      const tag = late ? 'late surge' : `pGoal≥${LIVE_V2_PGOAL_MIN_80}`;
      reason = `ТБ 80+ ${reasonTag} (${tag}${favBonus ? ', фав+' : ''}) | ${statsLine} ${src}`;
    } else if (prevBet === 'UNDER_0_5') {
      reason = `80+ ${reasonTag} після ТМ: моніторинг (pG_dec=${pGoalDec}) | ${statsLine}`;
    } else {
      reason = `80+ ${reasonTag}: слабкий ТБ pG_dec=${pGoalDec} | ${statsLine}`;
    }
  }

  const edge =
    bet === 'OVER_0_5'
      ? Number((pGoal - 0.5).toFixed(3))
      : bet === 'UNDER_0_5'
        ? Number((pDry - 0.5).toFixed(3))
        : null;

  const highStats = features.confidence === 'high';
  const mediumStats = features.confidence === 'medium';
  const confOut = highStats ? 'high' : mediumStats ? 'medium' : features.confidence || 'low';

  const signalEligible =
    bet !== 'SKIP' &&
    (highStats || mediumStats) &&
    signalQuality >= LIVE_V2_MIN_SIGNAL_QUALITY_TELEGRAM;

  if (oc.oddsNote) {
    reason += ` [ринок ΔpG ${oc.oddsAdjust >= 0 ? '+' : ''}${oc.oddsAdjust}]`;
  }
  if (applyPre && (preBias.note || preBias.deltaPGoal !== 0)) {
    reason += ` [форма:${preBias.note || '—'} Δp=${preBias.deltaPGoal}]`;
  }

  const decision = {
    bet,
    confidence: confOut,
    pGoal,
    pDry,
    edge,
    reason,
    timeWindow: tw,
    signalEligible,
    impliedProb: oc.impliedProb,
    odds1X2: odds1X2 || null,
    signalQuality,
  };

  const trendFeatures = {
    trendDirection: segmentFeatures?.trendDirection ?? 'flat',
    snapshotEvidenceWeight,
    burstLastInterval: burst,
  };

  const secondHalfComparison = segmentFeatures
    ? {
      vsSecondHalfRatio: segmentFeatures.vsSecondHalfRatio,
      comparisonLabel: segmentFeatures.comparisonLabel,
      cumulativePerMinute2H: segmentFeatures.cumulativePerMinute2H,
      segmentPerMinute: segmentFeatures.segmentPerMinute,
    }
    : null;

  const modelV2 = {
    modelVersion: modelArtifactVersion,
    minute,
    timeWindow: tw,
    score: scoreContext.score,
    scoreContext,
    bet,
    confidence: confOut,
    signalQuality,
    reason,
    currentState,
    previousState: previousState ?? null,
    stateChanged,
    dominanceSide: dom.dominanceSide,
    dominanceStrength: dom.dominanceStrength,
    homePressureShare: dom.homePressureShare,
    awayPressureShare: dom.awayPressureShare,
    balancedMatch: dom.balancedMatch,
    oneSidedPressure: dom.oneSidedPressure,
    accumulatedPressureWithoutGoal: currentState === 'accumulatedPressure',
    segmentFeatures: segmentFeatures,
    trendFeatures,
    secondHalfComparison,
    marketContext: {
      favoriteSide: marketContext.favoriteSide,
      favoriteStrength: marketContext.favoriteStrength,
      drawResistance: marketContext.drawResistance,
      marketPressureBias: marketContext.marketPressureBias,
    },
    redCardContext,
    substitutionContext,
    stoppageTimeAnnounced: null,
    stoppageTimeRemaining: null,
    leagueBaseline,
    leagueAdjustedPressure,
    leagueAdjustedDryness,
    snapshotHistoryUsed: historyLen,
    pGoal,
    pDry,
    ...(applyPre
      ? {
        basePGoalCore: baseP,
        basePGoalPreOdds: basePForOdds,
        preMatchFormBias: {
          deltaPGoal: preBias.deltaPGoal,
          note: preBias.note,
        },
      }
      : {}),
  };

  const scoredSummary = {
    modelVersion: scoredVersion,
    pGoal,
    pDry,
    signalQuality,
    currentState,
    snapshotEvidenceWeight,
    ...(applyPre ? { preMatchDeltaPGoal: preBias.deltaPGoal } : {}),
  };

  return { modelV2, decision, scoredSummary };
}

module.exports = {
  evaluateLiveModel,
  getLiveTimeWindow,
  drySignalsFromRaw,
  classifyState,
};
