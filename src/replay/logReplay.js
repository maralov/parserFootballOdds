const fs = require('fs');
const path = require('path');
const { buildFeatures } = require('../pipeline/featureBuilder');

function wrapFlat(block) {
  if (!block) return null;
  if (block.sum) return block;
  return { sum: block, home: {}, away: {} };
}

function rowToStatsResult(row) {
  return {
    overall: wrapFlat(row.stats?.overall),
    secondHalf: wrapFlat(row.stats?.secondHalf),
    statsStatus: row.statsStatus || 'unavailable',
  };
}

function rowToMatch(row) {
  return {
    id: row.matchId,
    league: row.league,
    minute: row.minute,
    score: row.score,
    home: row.home,
    away: row.away,
  };
}

function buildFeaturesFromLogRow(row) {
  const statsResult = rowToStatsResult(row);
  const match = rowToMatch(row);
  const features = buildFeatures(match, statsResult);
  const pred = row.prediction || row.latestPrediction;
  features.odds1X2 = pred?.odds1X2 || row.odds1X2 || null;
  if (!features.redCards) features.redCards = { homeRedCards: 0, awayRedCards: 0 };
  if (row.liveTrajectory) features.liveTrajectory = row.liveTrajectory;
  return features;
}

function inferPrevBet(row) {
  const h = row.betHistory;
  if (!Array.isArray(h) || h.length < 2) return null;
  const prev = h[h.length - 2];
  if (prev.bet === 'UNDER_0_5' || prev.bet === 'OVER_0_5') return prev.bet;
  return null;
}

function actualTotalGoals(row) {
  const ar = row.actualResult;
  if (!ar || ar.home == null || ar.away == null) return null;
  return Number(ar.home) + Number(ar.away);
}

function hitForBet(bet, totalGoals) {
  if (bet === 'SKIP' || !bet) return null;
  const over = totalGoals > 0;
  if (bet === 'OVER_0_5') return over;
  if (bet === 'UNDER_0_5') return !over;
  return null;
}

function loadMatchesFromLogDir(logsRoot, dateStr) {
  const fp = path.join(logsRoot, dateStr, 'matches.json');
  if (!fs.existsSync(fp)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function listLogDates(logsRoot) {
  if (!fs.existsSync(logsRoot)) return [];
  return fs.readdirSync(logsRoot)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}

/**
 * Останній запис decision_made з перевіреним фіналом на кожен matchId (усі дні разом).
 */
function lastResolvedDecisionRows(logsRoot, dateStrs) {
  const byId = new Map();
  for (const d of dateStrs) {
    const rows = loadMatchesFromLogDir(logsRoot, d);
    for (const r of rows) {
      if (r.pipeline !== 'decision_made' || !r.resultChecked) continue;
      if (actualTotalGoals(r) == null) continue;
      const id = r.matchId;
      const prev = byId.get(id);
      const ts = String(r.timestamp || '');
      if (!prev || ts >= String(prev.timestamp || '')) byId.set(id, r);
    }
  }
  return [...byId.values()];
}

module.exports = {
  buildFeaturesFromLogRow,
  inferPrevBet,
  actualTotalGoals,
  hitForBet,
  loadMatchesFromLogDir,
  listLogDates,
  lastResolvedDecisionRows,
};
