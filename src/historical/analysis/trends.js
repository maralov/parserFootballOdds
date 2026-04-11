const MIN_MATCHES = 3;
const DRY_THRESHOLD_PP = 15;
const LATE_GOAL_THRESHOLD_PP = 15;
const MODEL_STRONG_PP = 10;
const MODEL_WEAK_PP = 10;

function detectGroupTrends(groupAnalysis, globalStats, dimension) {
  const trends = [];
  const gDry = globalStats.dryRate;
  const gLate = globalStats.lateGoalRate;
  const gHit = globalStats.model.hitRate;

  for (const [key, stats] of Object.entries(groupAnalysis)) {
    if (stats.total < MIN_MATCHES) continue;

    if (stats.dryRate > gDry + DRY_THRESHOLD_PP) {
      trends.push({
        dimension,
        group: key,
        type: 'dryAboveAvg',
        detail: `dry ${stats.dryRate}% vs global ${gDry}% (+${(stats.dryRate - gDry).toFixed(1)}pp)`,
        n: stats.total,
      });
    }

    if (stats.lateGoalRate > gLate + LATE_GOAL_THRESHOLD_PP) {
      trends.push({
        dimension,
        group: key,
        type: 'lateGoalAboveAvg',
        detail: `late goal ${stats.lateGoalRate}% vs global ${gLate}% (+${(stats.lateGoalRate - gLate).toFixed(1)}pp)`,
        n: stats.total,
      });
    }

    if (stats.model.hitRate > gHit + MODEL_STRONG_PP && stats.model.predictions >= MIN_MATCHES) {
      trends.push({
        dimension,
        group: key,
        type: 'modelStrongHere',
        detail: `hit rate ${stats.model.hitRate}% vs global ${gHit}% (+${(stats.model.hitRate - gHit).toFixed(1)}pp)`,
        n: stats.model.predictions,
      });
    }

    if (stats.model.hitRate < gHit - MODEL_WEAK_PP && stats.model.predictions >= MIN_MATCHES) {
      trends.push({
        dimension,
        group: key,
        type: 'modelWeakHere',
        detail: `hit rate ${stats.model.hitRate}% vs global ${gHit}% (${(stats.model.hitRate - gHit).toFixed(1)}pp)`,
        n: stats.model.predictions,
      });
    }
  }

  return trends;
}

function detectTrends(analysis) {
  const g = analysis.global;
  const all = [];

  const dimensions = [
    ['byCountry', 'country'],
    ['byLeague', 'league'],
    ['byFavorite', 'favorite'],
    ['byDrawProb', 'drawProb'],
    ['byBalance', 'balance'],
    ['byStatsLevel', 'statsLevel'],
    ['byHasXG', 'hasXG'],
    ['byConfidence', 'confidence'],
  ];

  for (const [key, dim] of dimensions) {
    if (analysis[key]) {
      all.push(...detectGroupTrends(analysis[key], g, dim));
    }
  }

  all.sort((a, b) => b.n - a.n);

  return all;
}

module.exports = { detectTrends, MIN_MATCHES };
