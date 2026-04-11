/**
 * Нормалізація матчу: єдиний sum, розширені прапорці наявності метрик.
 * Пріоритет: secondHalf.sum → overall.sum (для «тиску в кінцівці»).
 */

function getStatsSum(m) {
  const sh = m.stats?.secondHalf?.sum;
  const ov = m.stats?.overall?.sum;
  const hasBoth = m.stats?.statsStatus === 'both';
  return {
    sum: sh || ov || {},
    overallSum: ov || {},
    secondHalfSum: sh || {},
    source: sh ? (hasBoth ? '2H_preferred' : '2H_only') : (ov ? 'overall_only' : 'none'),
    hasBoth,
  };
}

function getFeatureFlags(m) {
  const cls = m.statsClassification || {};
  const s = getStatsSum(m).sum;
  return {
    statsLevel: cls.statsLevel || 'none',
    hasXG: cls.hasXG === true,
    hasXGOT: cls.hasXGOT === true,
    hasBigChances: s.bigChances != null,
    hasTouchesInOppositionBox: s.touchesInOppositionBox != null,
    hasExpectedAssists: s.expectedAssistsXa != null,
    hasShotsOnTarget: s.shotsOnTarget != null,
    hasCornerKicks: s.cornerKicks != null,
    hasGoalkeeperSaves: s.goalkeeperSaves != null,
  };
}

function getGoalMinutesBuckets(m) {
  const mins = m.finalScore?.goalMinutes || [];
  const buckets = { '60-70': 0, '70-80': 0, '80-90+': 0 };
  for (const min of mins) {
    if (min >= 60 && min < 70) buckets['60-70']++;
    else if (min >= 70 && min < 80) buckets['70-80']++;
    else if (min >= 80) buckets['80-90+']++;
  }
  return buckets;
}

function getFirstGoalWindow(m) {
  const fg = m.firstGoalMinute;
  if (fg == null) return 'noGoal';
  if (fg >= 60 && fg < 70) return '60-70';
  if (fg >= 70 && fg < 80) return '70-80';
  if (fg >= 80) return '80-90+';
  return 'before60';
}

const TOURNAMENT_PATTERNS = [
  { pattern: /\b(дублер|резерв|U\d{2}|юніор|молод|юнак|2$|II$)/i, type: 'reserves' },
  { pattern: /\bЖ\b|\bWomen|\bW$|\bЖін/i, type: 'women' },
  { pattern: /\b(кубок|Cup|Copa|Coupe|Coppa|Pokal|Taça)\b/i, type: 'cup' },
  { pattern: /\b(Ліга чемпіонів|Champions League|Europa|Conference|Лібертадорес|Судамерікана|AFC|CAF)\b/i, type: 'international' },
];

function inferTournamentType(league) {
  const s = String(league || '');
  for (const { pattern, type } of TOURNAMENT_PATTERNS) {
    if (pattern.test(s)) return type;
  }
  return 'league';
}

module.exports = {
  getStatsSum, getFeatureFlags, getGoalMinutesBuckets,
  getFirstGoalWindow, inferTournamentType,
};
