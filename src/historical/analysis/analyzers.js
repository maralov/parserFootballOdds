const { computeModelStats, pct } = require('./modelEval');
const {
  byCountry, byLeague,
  byStatsLevel, byHasXG, byHasXGOT,
  byConfidence,
  byFavorite, byDrawProb, byBalance,
} = require('./grouper');

function computeGroupStats(matches) {
  const total = matches.length;
  if (total === 0) {
    return {
      total: 0, withGoalAfter60: 0, dry: 0,
      lateGoalRate: 0, dryRate: 0, avgGoalsAfter60: 0,
      goalsByTimeRange: { '60-70': 0, '70-80': 0, '80-90+': 0 },
      goalsByTimeRateOfMatches: { '60-70': 0, '70-80': 0, '80-90+': 0 },
      scoreDistribution: {},
      model: computeModelStats([]),
    };
  }

  const withGoalAfter60 = matches.filter(m => m.result?.totalGoals > 0).length;
  const dry = matches.filter(m => m.result?.totalGoals === 0).length;

  let sumGoalsAfter60 = 0;
  for (const m of matches) {
    sumGoalsAfter60 += m.result?.goalsAfter60 ?? 0;
  }

  const goalsByTimeRange = { '60-70': 0, '70-80': 0, '80-90+': 0 };
  const matchesWithGoalInRange = { '60-70': 0, '70-80': 0, '80-90+': 0 };

  for (const m of matches) {
    const mins = m.finalScore?.goalMinutes || [];
    const rangesHit = new Set();
    for (const min of mins) {
      if (min >= 60 && min < 70) { goalsByTimeRange['60-70']++; rangesHit.add('60-70'); }
      else if (min >= 70 && min < 80) { goalsByTimeRange['70-80']++; rangesHit.add('70-80'); }
      else if (min >= 80) { goalsByTimeRange['80-90+']++; rangesHit.add('80-90+'); }
    }
    for (const r of rangesHit) matchesWithGoalInRange[r]++;
  }

  const scoreDistribution = {};
  for (const m of matches) {
    const key = `${m.finalScore.home}:${m.finalScore.away}`;
    scoreDistribution[key] = (scoreDistribution[key] || 0) + 1;
  }

  return {
    total,
    withGoalAfter60,
    dry,
    lateGoalRate: pct(withGoalAfter60, total),
    dryRate: pct(dry, total),
    avgGoalsAfter60: Number((sumGoalsAfter60 / total).toFixed(2)),
    goalsByTimeRange,
    goalsByTimeRateOfMatches: {
      '60-70': pct(matchesWithGoalInRange['60-70'], total),
      '70-80': pct(matchesWithGoalInRange['70-80'], total),
      '80-90+': pct(matchesWithGoalInRange['80-90+'], total),
    },
    scoreDistribution,
    model: computeModelStats(matches),
  };
}

function analyzeGrouped(groups) {
  const result = {};
  for (const [key, matches] of Object.entries(groups)) {
    result[key] = computeGroupStats(matches);
  }
  return result;
}

function analyzeAll(matches) {
  const global = computeGroupStats(matches);

  const countries = analyzeGrouped(byCountry(matches));
  const leagues = analyzeGrouped(byLeague(matches));

  const statsLevel = analyzeGrouped(byStatsLevel(matches));
  const hasXG = analyzeGrouped(byHasXG(matches));
  const hasXGOT = analyzeGrouped(byHasXGOT(matches));

  const confidence = analyzeGrouped(byConfidence(matches));

  const favorite = analyzeGrouped(byFavorite(matches));
  const drawProb = analyzeGrouped(byDrawProb(matches));
  const balance = analyzeGrouped(byBalance(matches));

  return {
    global,
    byCountry: countries,
    byLeague: leagues,
    byStatsLevel: statsLevel,
    byHasXG: hasXG,
    byHasXGOT: hasXGOT,
    byConfidence: confidence,
    byFavorite: favorite,
    byDrawProb: drawProb,
    byBalance: balance,
  };
}

module.exports = { computeGroupStats, analyzeAll };
