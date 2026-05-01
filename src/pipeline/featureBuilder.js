const PRIMARY_METRICS = [
  'shotsOnTarget', 'shotsInsideTheBox', 'bigChances',
  'touchesInOppositionBox', 'cornerKicks', 'goalkeeperSaves',
];
const SECONDARY_METRICS = [
  'expectedGoalsXg', 'xgOnTargetXgot', 'passesInFinalThird', 'expectedAssistsXa',
];
const ALL_METRICS = [
  ...PRIMARY_METRICS, ...SECONDARY_METRICS,
  'totalShots', 'shotsOffTarget', 'shotsOutsideTheBox', 'blockedShots',
  'hitTheWoodwork', 'crosses', 'longPasses', 'accurateThroughPasses',
  'fouls', 'tackles', 'duelsWon', 'clearances', 'interceptions',
  'errorsLeadingToShot', 'errorsLeadingToGoal',
  'ballPossession', 'yellowCards', 'redCards', 'throwIns', 'passes',
  'offsides', 'freeKicks', 'xgotFaced', 'goalsPrevented',
];

const NORM_BOUNDS = {
  shotsOnTarget:          { min: 0, max: 14 },
  shotsInsideTheBox:      { min: 0, max: 18 },
  bigChances:             { min: 0, max: 8 },
  touchesInOppositionBox: { min: 0, max: 45 },
  cornerKicks:            { min: 0, max: 16 },
  goalkeeperSaves:        { min: 0, max: 12 },
  expectedGoalsXg:        { min: 0, max: 4 },
  xgOnTargetXgot:         { min: 0, max: 3.5 },
  passesInFinalThird:     { min: 0, max: 200 },
  expectedAssistsXa:      { min: 0, max: 3 },
  totalShots:             { min: 0, max: 30 },
  shotsOffTarget:         { min: 0, max: 16 },
  shotsOutsideTheBox:     { min: 0, max: 14 },
  errorsLeadingToShot:    { min: 0, max: 5 },
};

function getMinuteBucket(minute) {
  if (minute >= 85) return '85+';
  if (minute >= 81) return '81-84';
  if (minute >= 76) return '76-80';
  if (minute >= 70) return '70-75';
  return '60-69';
}

function normalize(value, key) {
  if (value === null || value === undefined) return null;
  const b = NORM_BOUNDS[key];
  if (!b) return null;
  return Number((Math.max(b.min, Math.min(value, b.max)) / (b.max - b.min)).toFixed(3));
}

function safeSum(stats, key) {
  const v = stats?.sum?.[key];
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractRaw(stats) {
  const raw = {};
  for (const key of ALL_METRICS) raw[key] = safeSum(stats, key);
  return raw;
}

function computeNormalized(raw) {
  const norm = {};
  for (const key of [...PRIMARY_METRICS, ...SECONDARY_METRICS]) {
    const v = normalize(raw[key], key);
    if (v !== null) norm[key] = v;
  }
  return norm;
}

function computeImbalance(stats) {
  const imb = {};
  const h = stats?.home || {};
  const a = stats?.away || {};
  for (const key of PRIMARY_METRICS) {
    const hv = Number(h[key] || 0);
    const av = Number(a[key] || 0);
    const total = hv + av;
    imb[key] = total > 0 ? Number((Math.abs(hv - av) / total).toFixed(3)) : 0;
  }
  return imb;
}

function computeDominanceRatio(stats) {
  const h = Number(stats?.home?.shotsOnTarget || 0);
  const a = Number(stats?.away?.shotsOnTarget || 0);
  const total = h + a;
  if (total === 0) return 0.5;
  return Number((Math.max(h, a) / total).toFixed(3));
}

function computeTrend(rawOverall, raw2H) {
  if (!rawOverall || !raw2H) return { trendSOT: null, trendXG: null };
  const h1_sot = (rawOverall.shotsOnTarget ?? 0) - (raw2H.shotsOnTarget ?? 0);
  const h1_xg = (rawOverall.expectedGoalsXg ?? 0) - (raw2H.expectedGoalsXg ?? 0);
  return {
    trendSOT: raw2H.shotsOnTarget !== null ? Number(((raw2H.shotsOnTarget ?? 0) - h1_sot).toFixed(1)) : null,
    trendXG: raw2H.expectedGoalsXg !== null ? Number(((raw2H.expectedGoalsXg ?? 0) - h1_xg).toFixed(2)) : null,
  };
}

function buildFeatures(match, statsResult) {
  const { overall, firstHalf, secondHalf, statsStatus } = statsResult;
  const primary = secondHalf || overall;
  const context = overall;

  if (!primary) {
    return {
      matchId: match.id, league: match.league, minute: match.minute,
      minuteBucket: getMinuteBucket(match.minute),
      statsStatus: statsStatus || 'unavailable',
      raw2H: null, raw1H: null, rawOverall: null, normalized: {}, imbalance: {},
      ratios: {}, trend: {}, dominanceRatio: 0.5,
      dataQualityScore: 0, availablePrimary: 0,
      confidence: 'none', allowDecision: false,
    };
  }

  const raw2H = secondHalf ? extractRaw(secondHalf) : null;
  const raw1H = firstHalf ? extractRaw(firstHalf) : null;
  const rawOverall = context ? extractRaw(context) : null;
  const activeRaw = raw2H || rawOverall;
  const norm = computeNormalized(activeRaw);
  const imbalance = computeImbalance(primary);
  const dominanceRatio = computeDominanceRatio(secondHalf || overall);
  const trend = computeTrend(rawOverall, raw2H);

  const totalShots = activeRaw.totalShots || 0;
  const ratios = {
    onTargetRatio: totalShots > 0 ? Number(((activeRaw.shotsOnTarget || 0) / totalShots).toFixed(3)) : null,
    insideBoxRatio: totalShots > 0 ? Number(((activeRaw.shotsInsideTheBox || 0) / totalShots).toFixed(3)) : null,
    offTargetRatio: totalShots > 0 ? Number(((activeRaw.shotsOffTarget || 0) / totalShots).toFixed(3)) : null,
    outsideBoxRatio: totalShots > 0 ? Number(((activeRaw.shotsOutsideTheBox || 0) / totalShots).toFixed(3)) : null,
  };

  let availPrimary = 0;
  for (const k of PRIMARY_METRICS) if (activeRaw[k] !== null) availPrimary++;
  let availSecondary = 0;
  for (const k of SECONDARY_METRICS) if (activeRaw[k] !== null) availSecondary++;

  const dq = Number(((availPrimary / PRIMARY_METRICS.length) * 0.7 + (availSecondary / SECONDARY_METRICS.length) * 0.3).toFixed(2));

  let confidence = 'low';
  if (availPrimary >= 5 && secondHalf) confidence = 'high';
  else if (availPrimary >= 3) confidence = 'medium';

  return {
    matchId: match.id, league: match.league, minute: match.minute,
    minuteBucket: getMinuteBucket(match.minute),
    statsStatus,
    raw2H, raw1H, rawOverall, normalized: norm, imbalance,
    ratios, trend, dominanceRatio,
    dataQualityScore: dq, availablePrimary: availPrimary,
    confidence,
    allowDecision:
      Boolean(primary) &&
      (availPrimary >= 1 || availSecondary >= 1) &&
      statsStatus !== 'unavailable',
  };
}

module.exports = { buildFeatures, getMinuteBucket, PRIMARY_METRICS, SECONDARY_METRICS };
