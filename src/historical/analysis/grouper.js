const FAVORITE_THRESHOLDS = { strong: 1.50, moderate: 2.20 };
const DRAW_THRESHOLDS = { low: 0.25, medium: 0.32 };
const BALANCE_THRESHOLDS = { high: 0.25, medium: 0.10 };

function groupBy(matches, keyFn) {
  const groups = {};
  for (const m of matches) {
    const key = keyFn(m) ?? 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  return groups;
}

function byCountry(matches) {
  return groupBy(matches, m => m.country || 'unknown');
}

function byLeague(matches) {
  return groupBy(matches, m => m.league || m.leagueName || 'unknown');
}

function byStatsLevel(matches) {
  return groupBy(matches, m => m.statsClassification?.statsLevel || 'none');
}

function byHasXG(matches) {
  return groupBy(matches, m => m.statsClassification?.hasXG ? 'withXG' : 'withoutXG');
}

function byHasXGOT(matches) {
  return groupBy(matches, m => m.statsClassification?.hasXGOT ? 'withXGOT' : 'withoutXGOT');
}

function byConfidence(matches) {
  return groupBy(matches, m => m.modelPrediction?.confidence || 'none');
}

function classifyFavorite(odds) {
  if (!odds || odds.home == null || odds.away == null) return 'noOdds';
  const minOdds = Math.min(odds.home, odds.away);
  if (minOdds < FAVORITE_THRESHOLDS.strong) return 'strongFavorite';
  if (minOdds < FAVORITE_THRESHOLDS.moderate) return 'moderateFavorite';
  return 'evenMatch';
}

function classifyDrawProb(impliedProb) {
  if (!impliedProb || impliedProb.draw == null) return 'noOdds';
  if (impliedProb.draw < DRAW_THRESHOLDS.low) return 'lowDraw';
  if (impliedProb.draw < DRAW_THRESHOLDS.medium) return 'mediumDraw';
  return 'highDraw';
}

function classifyBalance(impliedProb) {
  if (!impliedProb || impliedProb.home == null || impliedProb.away == null) return 'noOdds';
  const diff = Math.abs(impliedProb.home - impliedProb.away);
  if (diff > BALANCE_THRESHOLDS.high) return 'highImbalance';
  if (diff > BALANCE_THRESHOLDS.medium) return 'mediumImbalance';
  return 'balanced';
}

function byFavorite(matches) {
  return groupBy(matches, m => classifyFavorite(m.odds1X2));
}

function byDrawProb(matches) {
  return groupBy(matches, m => classifyDrawProb(m.impliedProb));
}

function byBalance(matches) {
  return groupBy(matches, m => classifyBalance(m.impliedProb));
}

module.exports = {
  groupBy,
  byCountry, byLeague,
  byStatsLevel, byHasXG, byHasXGOT,
  byConfidence,
  byFavorite, byDrawProb, byBalance,
  classifyFavorite, classifyDrawProb, classifyBalance,
  FAVORITE_THRESHOLDS, DRAW_THRESHOLDS, BALANCE_THRESHOLDS,
};
