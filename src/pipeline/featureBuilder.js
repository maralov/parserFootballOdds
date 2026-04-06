const PRIMARY_METRICS = [
  'shotsOnTarget', 'shotsInsideTheBox', 'bigChances',
  'touchesInOppositionBox', 'cornerKicks', 'goalkeeperSaves',
];

const SECONDARY_METRICS = [
  'expectedGoalsXg', 'xgOnTargetXgot', 'passesInFinalThird',
  'expectedAssistsXa',
];

const ALL_METRICS = [
  ...PRIMARY_METRICS, ...SECONDARY_METRICS,
  'totalShots', 'shotsOffTarget', 'shotsOutsideTheBox', 'blockedShots',
  'hitTheWoodwork', 'crosses', 'longPasses', 'accurateThroughPasses',
  'fouls', 'tackles', 'duelsWon', 'clearances', 'interceptions',
  'errorsLeadingToShot', 'errorsLeadingToGoal',
  'ballPossession', 'yellowCards', 'redCards', 'throwIns', 'passes',
  'offsides', 'freeKicks', 'xgotFaced', 'goalsPrevented', 'headedGoals',
];

const NORMALIZATION_BOUNDS = {
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
};

function getMinuteBucket(minute) {
  if (minute >= 86) return '86+';
  if (minute >= 81) return '81-85';
  if (minute >= 76) return '76-80';
  return '70-75';
}

function normalize(value, key) {
  if (value === null || value === undefined) return null;
  const bounds = NORMALIZATION_BOUNDS[key];
  if (!bounds) return null;
  const clamped = Math.max(bounds.min, Math.min(value, bounds.max));
  return Number(((clamped - bounds.min) / (bounds.max - bounds.min)).toFixed(3));
}

function safeGet(stats, key) {
  const val = stats?.sum?.[key] ?? stats?.[key];
  if (val === undefined || val === null) return null;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildFeatures(match, stats2h = {}) {
  const raw = {};
  const norm = {};
  let availablePrimary = 0;
  let availableSecondary = 0;
  let availableTotal = 0;

  for (const key of ALL_METRICS) {
    const value = safeGet(stats2h, key);
    raw[key] = value;
    if (value !== null) availableTotal++;

    const normalizedVal = normalize(value, key);
    if (normalizedVal !== null) norm[key] = normalizedVal;

    if (PRIMARY_METRICS.includes(key) && value !== null) availablePrimary++;
    if (SECONDARY_METRICS.includes(key) && value !== null) availableSecondary++;
  }

  const totalShots = raw.totalShots || 0;
  const ratios = {
    offTargetRatio: totalShots > 0 ? Number(((raw.shotsOffTarget || 0) / totalShots).toFixed(3)) : null,
    outsideBoxRatio: totalShots > 0 ? Number(((raw.shotsOutsideTheBox || 0) / totalShots).toFixed(3)) : null,
    onTargetRatio: totalShots > 0 ? Number(((raw.shotsOnTarget || 0) / totalShots).toFixed(3)) : null,
    insideBoxRatio: totalShots > 0 ? Number(((raw.shotsInsideTheBox || 0) / totalShots).toFixed(3)) : null,
  };

  const homeStats = stats2h?.home || {};
  const awayStats = stats2h?.away || {};
  const imbalance = {};
  for (const key of PRIMARY_METRICS) {
    const h = Number(homeStats[key] || 0);
    const a = Number(awayStats[key] || 0);
    const total = h + a;
    imbalance[key] = total > 0 ? Number((Math.abs(h - a) / total).toFixed(3)) : 0;
  }

  const dataQualityScore = Number(
    ((availablePrimary / PRIMARY_METRICS.length) * 0.7 +
     (availableSecondary / SECONDARY_METRICS.length) * 0.3).toFixed(2)
  );

  let confidence = 'low';
  if (availablePrimary >= 5) confidence = 'high';
  else if (availablePrimary >= 3) confidence = 'medium';

  return {
    matchId: match.id,
    league: match.league,
    minute: match.minute || 0,
    minuteBucket: getMinuteBucket(match.minute || 0),
    raw,
    normalized: norm,
    ratios,
    imbalance,
    dataQualityScore,
    availablePrimary,
    availableSecondary,
    availableTotal,
    confidence,
    allowDecision: availablePrimary >= 3 && confidence !== 'low',
  };
}

module.exports = {
  buildFeatures,
  getMinuteBucket,
  PRIMARY_METRICS,
  SECONDARY_METRICS,
  NORMALIZATION_BOUNDS,
};
