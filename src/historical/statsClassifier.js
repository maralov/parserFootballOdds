const GROUPS = {
  attackPressure: [
    'expectedGoalsXg', 'xgOnTargetXgot', 'shotsOnTarget',
    'shotsInsideTheBox', 'bigChances', 'touchesInOppositionBox',
  ],
  chanceCreation: [
    'passesInFinalThird', 'crosses', 'accurateThroughPasses', 'expectedAssistsXa',
  ],
  shotEfficiency: [
    'totalShots', 'shotsOffTarget', 'shotsOutsideTheBox', 'blockedShots', 'hitTheWoodwork',
  ],
  defensiveBlock: [
    'goalkeeperSaves', 'clearances', 'interceptions', 'tackles', 'duelsWon',
  ],
  gameTempo: [
    'ballPossession', 'passes', 'longPasses', 'fouls', 'freeKicks',
  ],
  discipline: [
    'yellowCards', 'redCards', 'offsides',
  ],
};

function classifyStats(statsResult) {
  if (!statsResult) {
    return {
      statsLevel: 'none',
      hasXG: false,
      hasXGOT: false,
      metricsCount: 0,
      availableGroups: [],
      groupCoverage: {},
    };
  }

  const primary = statsResult.secondHalf || statsResult.overall;
  if (!primary || !primary.sum) {
    return {
      statsLevel: 'none',
      hasXG: false,
      hasXGOT: false,
      metricsCount: 0,
      availableGroups: [],
      groupCoverage: {},
    };
  }

  const sum = primary.sum;
  const allKeys = Object.keys(sum);
  const metricsCount = allKeys.length;

  const hasXG = sum.expectedGoalsXg !== undefined && sum.expectedGoalsXg !== null;
  const hasXGOT = sum.xgOnTargetXgot !== undefined && sum.xgOnTargetXgot !== null;

  const groupCoverage = {};
  const availableGroups = [];

  for (const [group, metrics] of Object.entries(GROUPS)) {
    const available = metrics.filter(m => sum[m] !== undefined && sum[m] !== null);
    groupCoverage[group] = available.length;
    if (available.length > 0) availableGroups.push(group);
  }

  let statsLevel = 'minimal';
  if (metricsCount >= 18 && hasXG) statsLevel = 'full';
  else if (metricsCount >= 12) statsLevel = 'advanced';
  else if (metricsCount >= 6) statsLevel = 'basic';

  return { statsLevel, hasXG, hasXGOT, metricsCount, availableGroups, groupCoverage };
}

module.exports = { classifyStats, GROUPS };
