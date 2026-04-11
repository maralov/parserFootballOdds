/**
 * Блок B: outcome-зрізи по часових вікнах 60-70, 70-80, 80-90+.
 * NB: оцінка моделі — один прогон на LIVE_MIN_CANDIDATE_MINUTE, не snapshot.
 */

const { pct } = require('./modelEval');
const { computeModelStats } = require('./modelEval');
const { getFirstGoalWindow } = require('./matchNormalizer');

const WINDOWS = ['60-70', '70-80', '80-90+'];
const DISCLAIMER =
  'Model was evaluated once at LIVE_MIN_CANDIDATE_MINUTE (typically 60). ' +
  'Time-window stratification is by actual first-goal minute, not by model re-eval at each window. ' +
  'True per-window model quality requires live snapshot data (planned).';

function windowOutcomes(matches) {
  const total = matches.length;
  const dry = matches.filter(m => m.result?.totalGoals === 0);

  const byFirstGoalWindow = {};
  for (const w of WINDOWS) {
    const inWindow = matches.filter(m => getFirstGoalWindow(m) === w);
    byFirstGoalWindow[w] = {
      count: inWindow.length,
      pctOfTotal: pct(inWindow.length, total),
      model: computeModelStats(inWindow),
    };
  }

  byFirstGoalWindow['noGoal'] = {
    count: dry.length,
    pctOfTotal: pct(dry.length, total),
    model: computeModelStats(dry),
  };

  const cumulativeStillDryAt = {};
  for (const threshold of [60, 70, 80]) {
    const stillDry = matches.filter(m => {
      const mins = m.finalScore?.goalMinutes || [];
      return mins.length === 0 || mins.every(min => min >= threshold);
    });
    const eventuallyScored = stillDry.filter(m => m.result?.totalGoals > 0);
    cumulativeStillDryAt[threshold] = {
      count: stillDry.length,
      eventuallyScored: eventuallyScored.length,
      eventuallyDry: stillDry.length - eventuallyScored.length,
      overRate: pct(eventuallyScored.length, stillDry.length),
      underRate: pct(stillDry.length - eventuallyScored.length, stillDry.length),
      model: computeModelStats(stillDry),
    };
  }

  const byConfidenceWindow = {};
  for (const conf of ['high', 'medium', 'low']) {
    byConfidenceWindow[conf] = {};
    const confMatches = matches.filter(m => m.modelPrediction?.confidence === conf);
    for (const w of WINDOWS) {
      const inWindow = confMatches.filter(m => getFirstGoalWindow(m) === w);
      byConfidenceWindow[conf][w] = {
        count: inWindow.length,
        model: computeModelStats(inWindow),
      };
    }
    const dryConf = confMatches.filter(m => m.result?.totalGoals === 0);
    byConfidenceWindow[conf]['noGoal'] = {
      count: dryConf.length,
      model: computeModelStats(dryConf),
    };
  }

  return {
    disclaimer: DISCLAIMER,
    total,
    byFirstGoalWindow,
    cumulativeStillDryAt,
    byConfidenceWindow,
  };
}

module.exports = { windowOutcomes, WINDOWS, DISCLAIMER };
