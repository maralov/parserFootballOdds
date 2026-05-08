'use strict';

const { bundleWindowTotals } = require('./helpers');
const {
  calculateDryStateScore,
  calculateRealPressureScore,
  calculateFakePressureScore,
  calculateLateActivationRisk,
  calculateFullTimeNilNilScore,
  dataQualityScore,
} = require('./modelScoresRaw');

function nn(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function aggregateWindowBundles(w1, w2, w3) {
  const parts = [w1?.totals, w2?.totals, w3?.totals].filter(Boolean);
  if (!parts.length) return null;
  const agg = {};
  const keys = new Set([
    ...Object.keys(parts[0]),
    ...parts.slice(1).flatMap(Object.keys),
  ]);

  keys.forEach((k) => {
    let sum = 0;
    parts.forEach((p) => {
      const z = p[k];
      sum += nn(z) ? z : typeof z === 'number' ? z : 0;
    });
    agg[k] = sum;
  });
  agg.xg = parts.reduce((s, p) => s + (nn(p.xg) ? p.xg : 0), 0);
  return agg;
}

function buildFirstHalfProfileLite(statistics) {
  const ov = statistics?.['1half']?.overall;
  if (!ov) return null;
  return {
    totalXg: ov.expectedGoalsXg != null ? Number(ov.expectedGoalsXg) : null,
    totalXgot: ov.xgOnTargetXgot != null ? Number(ov.xgOnTargetXgot) : null,
    totalShotsOnTarget: ov.shotsOnTarget != null ? Number(ov.shotsOnTarget) : null,
    totalBigChances: ov.bigChances != null ? Number(ov.bigChances) : null,
    totalGoalkeeperSaves: ov.goalkeeperSaves != null ? Number(ov.goalkeeperSaves) : null,
    totalCorners: ov.cornerKicks != null ? Number(ov.cornerKicks) : null,
  };
}

/** Сума поля по home+away із карти `{ field:{home,away} }` (baseline/cumulative/since2H). */
function sumSidesMap(mapField) {
  if (!mapField) return null;
  const h = mapField.home;
  const a = mapField.away;
  if (nn(h) && nn(a)) return h + a;
  if (nn(h)) return h;
  if (nn(a)) return a;
  return null;
}

/** Агрегати всього матчу з останнього snapshot.cumulative */
function cumulativeLiveTotals(match) {
  const snaps = match.snapshots || [];
  const last = snaps[snaps.length - 1];
  const c = last?.cumulative;
  if (!c) return null;
  const sot = sumSidesMap(c.shotsOnTarget);
  const shots = sumSidesMap(c.totalShots);
  const corners = sumSidesMap(c.cornerKicks);
  const y = sumSidesMap(c.yellowCards);
  const reds = sumSidesMap(c.redCards);
  return {
    shotsOnTarget: sot ?? 0,
    totalShots: shots ?? 0,
    corners,
    yellowCardsTotal: nn(y) ? y : 0,
    redCardsTotal: nn(reds) ? reds : 0,
  };
}

/** Агрегати другого тайму cumulative − baseline (since2H). */
function sinceHtTotals(match) {
  const snaps = match.snapshots || [];
  const last = snaps[snaps.length - 1];
  const s = last?.since2H;
  if (!s) return null;
  return bundleWindowTotals(s);
}

function hotHalfNoGoal1H(profile, statsLevel) {
  if (statsLevel !== 'detailed' || !profile) return false;
  if (typeof profile.isHotButNoGoal === 'boolean') return profile.isHotButNoGoal;

  const xg = profile.totalXg;
  const xgot = profile.totalXgot;
  const bc = profile.totalBigChances;
  const sot = profile.totalShotsOnTarget;
  const saves = profile.totalGoalkeeperSaves;

  if (xg != null && xg >= 1.0) return true;
  if (xgot != null && xgot >= 0.8) return true;
  if (bc != null && bc >= 1) return true;
  if (sot != null && sot >= 4) return true;
  if (saves != null && saves >= 3) return true;
  return false;
}

function activityScore(t, statsLevel) {
  if (!t) return 0;
  let s = (t.totalShots ?? 0) * 1
    + (t.shotsOnTarget ?? 0) * 3
    + (t.corners ?? 0) * 0.8
    + (typeof t.xg === 'number' ? t.xg : 0) * 8;
  if (statsLevel === 'detailed') {
    s += (t.xgot ?? 0) * 8
      + (t.bigChances ?? 0) * 5
      + (t.shotsInsideBox ?? 0) * 1.5
      + (t.touchesInBox ?? 0) * 0.3;
  }
  return s;
}

/** Activity-based темп між останнім і попереднім вікном 60–75. */
function classifyTrend6075(windows, opts = {}) {
  const statsLevel = opts.statsLevel || 'detailed';
  const lastWin = windows.window70_75 || windows.window65_70 || windows.window60_65 || windows.window45_60;
  const prevWin = windows.window65_70 || windows.window60_65 || windows.window50_60 || windows.window45_60;

  const last = activityScore(lastWin?.totals, statsLevel);
  const prev = activityScore(prevWin?.totals, statsLevel);

  if (prev <= 0.5 && last > 6) return 'explosive';
  if (last > prev * 2 && last >= 3) return 'explosive';
  if (last > prev * 1.3 && last >= 2) return 'growing';
  if (last <= prev * 0.75 && prev >= 2) return 'falling';
  if (Math.abs(last - prev) <= 1.5) return 'flat';
  return 'flat';
}

/** Activity-based темп 70–80′ (останнє 5′ vs попереднє 5′ у межах інтервалу). */
function classifyTrend7080(windows, opts = {}) {
  const statsLevel = opts.statsLevel || 'detailed';
  const lastWin = windows.window75_80 || windows.window70_75 || windows.window45_60;
  const prevWin = windows.window70_75 || windows.window65_70 || windows.window45_60;

  const last = activityScore(lastWin?.totals, statsLevel);
  const prev = activityScore(prevWin?.totals, statsLevel);

  if (prev <= 0.5 && last > 6) return 'explosive';
  if (last > prev * 2 && last >= 3) return 'explosive';
  if (last > prev * 1.3 && last >= 2) return 'growing';
  if (last <= prev * 0.75 && prev >= 2) return 'falling';
  if (Math.abs(last - prev) <= 1.5) return 'flat';
  return 'flat';
}

/** Сильний сигнал на фаворита з коэфами + турнірним контекстом. */
function strongFavoriteContext(match) {
  const favLab = match.standings?.favoriteStrength?.label;
  const hasFavOdds = !!match.odds?.isOddsFavorite?.favorite;
  const ms = typeof match.derived?.marketSignal === 'number'
    ? match.derived.marketSignal
    : 0;
  const ts = typeof match.derived?.tableSignal === 'number'
    ? match.derived.tableSignal
    : 0;
  let strongLabel = favLab === 'strong';
  const strongMarket = Math.abs(ms) >= 0.42;
  const strongTable = Math.abs(ts) >= 0.45;
  return {
    isStrongContext: Boolean(hasFavOdds && (strongLabel || (strongMarket && strongTable))),
    favLab,
    marketSignal: ms,
    tableSignal: ts,
    strongMarket,
    strongTable,
    strongLabel,
  };
}

/**
 * Ключові сигнали для FT 0–0 із вікном прийняття рішення 60–75.
 */
function buildFtTmModelSignals(match, computed) {
  const mode = match.statsLevel === 'detailed' ? 'detailed' : 'basic';
  const windows = computed.windows || {};
  const fh = computed.firstHalfProfile || buildFirstHalfProfileLite(match.statistics);

  const sinceHt = sinceHtTotals(match);
  const liveTotals = cumulativeLiveTotals(match);

  const statsLevelForTrend = mode === 'detailed' ? 'detailed' : 'basic';
  const trend6075 = classifyTrend6075(windows, { statsLevel: statsLevelForTrend });
  const trend7080 = classifyTrend7080(windows, { statsLevel: statsLevelForTrend });

  const dryStateScore = calculateDryStateScore({
    sinceHt,
    tempoTrend: trend6075,
    statsLevel: statsLevelForTrend,
  });

  const real45_60 = calculateRealPressureScore(windows.window45_60?.totals ?? null, { mode });
  const real60_70 = calculateRealPressureScore(windows.window60_70?.totals ?? null, { mode });
  const real6570 = calculateRealPressureScore(windows.window65_70?.totals ?? null, { mode });
  const real70_75 = calculateRealPressureScore(windows.window70_75?.totals ?? null, { mode });
  const tracked6075Totals = windows.window60_toTracked75?.totals ?? null;
  const realTracked6075 = calculateRealPressureScore(tracked6075Totals ?? null, { mode });
  const real6075Combined = calculateRealPressureScore(
    tracked6075Totals ??
      aggregateWindowBundles(windows.window60_65, windows.window65_70, windows.window70_75),
    { mode },
  );

  const hot1h = hotHalfNoGoal1H(fh, match.statsLevel);
  const favCtx = strongFavoriteContext(match);

  const fakePressureScore =
    computed.modelScoresRaw?.fakePressureScore60 ??
    calculateFakePressureScore(
      windows.window50_60?.totals ?? windows.window45_60?.totals ?? null,
      { mode },
    );

  const realPressureScore = Math.max(real45_60 || 0, real60_70 || 0);

  const tournamentImportanceHome =
    match.aiAnalysis?.halftime?.output?.match_context?.tournament_importance_home ?? 0;
  const tournamentImportanceAway =
    match.aiAnalysis?.halftime?.output?.match_context?.tournament_importance_away ?? 0;
  const tournamentImportance = Math.max(
    Number(tournamentImportanceHome) || 0,
    Number(tournamentImportanceAway) || 0,
  );

  const yellowCardsTotal =
    computed.pressure?.yellowCardsTotal ?? liveTotals?.yellowCardsTotal ?? 0;
  const hasRedCard = Boolean(computed.pressure?.redCards?.anyRed);

  const lateActivationRisk = calculateLateActivationRisk({
    firstHalfProfile: fh,
    favoriteContext: favCtx,
    tournamentImportance,
    realPressureScore50_60: real45_60,
    realPressureScore60_70: real60_70,
    tempoTrend: trend6075,
    yellowCardsTotal,
    hasRedCard,
    isDryFirstHalf: fh?.isDryFirstHalf,
    dryStateScore,
    fakePressureScore,
    realPressureScore,
  });

  const dq = dataQualityScore({
    statsLevel: mode === 'detailed' ? 'detailed' : 'basic',
    hasXg: sinceHt?.xg != null,
    hasXgot: sinceHt?.xgot != null,
  });

  const fullTimeNilNilScore = calculateFullTimeNilNilScore({
    dryStateScore,
    realPressureScore,
    lateActivationRisk,
    isDryFirstHalf: fh?.isDryFirstHalf,
    isHotButNoGoal: fh?.isHotButNoGoal,
    fakePressureScore,
    dataQualityScore: dq,
  });

  let chaosRisk = 0;
  if (computed.pressure?.redCards?.anyRed) chaosRisk += 90;
  if ((liveTotals?.yellowCardsTotal ?? 0) >= 4) chaosRisk += 40;
  if ((liveTotals?.yellowCardsTotal ?? 0) >= 6) chaosRisk += 20;

  /** Додатковий ризик — фаворит «глодатиме» результат при 0:0 без якості або з хаосом фолів. */
  let favoriteDesperationRisk = 0;
  if (favCtx.isStrongContext && favCtx.marketSignal !== 0) favoriteDesperationRisk += 35;
  if (sinceHt && (sinceHt.corners ?? 0) >= 5 && (sinceHt.shotsOnTarget ?? 0) >= 3) favoriteDesperationRisk += 28;
  favoriteDesperationRisk = Math.min(100, favoriteDesperationRisk);

  let confidencePenalty = 0;
  if (computed.statsLevel !== 'detailed') confidencePenalty += 0.12;
  if (computed.pressure?.redCards?.anyRed) confidencePenalty += 0.5;
  else if ((liveTotals?.yellowCardsTotal ?? 0) >= 4) confidencePenalty += 0.18;

  confidencePenalty += Math.min(0.35, lateActivationRisk / 220);

  return {
    fullTimeNilNilScore: Math.round(fullTimeNilNilScore),
    dryStateScore: Math.round(dryStateScore),
    dataQualityScore: dq,
    realPressureScores: {
      window45_60: real45_60,
      window60_70: real60_70,
      window65_70: real6570,
      window70_75: real70_75,
      windowTracked6075: realTracked6075,
      windowCombined6075: real6075Combined,
    },
    lateActivationRisk: Math.round(lateActivationRisk),
    favoriteDesperationRisk: Math.round(favoriteDesperationRisk),
    chaosRisk: Math.round(chaosRisk),
    confidencePenalty,
    tempoTrend6075: trend6075,
    tempoTrend70_80: trend7080,
    hotFirstHalfDanger: hot1h,
    favoriteContext: favCtx,
    sinceHtTotalsSnapshot: sinceHt,
    cumulativeLiveTotals: liveTotals,
  };
}

module.exports = {
  buildFtTmModelSignals,
  cumulativeLiveTotals,
  sinceHtTotals,
  classifyTrend6075,
  classifyTrend7080,
  hotHalfNoGoal1H,
};
