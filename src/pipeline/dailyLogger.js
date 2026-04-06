const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'logs');

function getDateString(date) {
  const d = date || new Date();
  return d.toISOString().slice(0, 10);
}

function getDayDir(date) {
  const dateStr = getDateString(date);
  const dir = path.join(DATA_DIR, dateStr);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadDayMatches(date) {
  const filePath = path.join(getDayDir(date), 'matches.json');
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function saveDayMatches(date, matches) {
  const filePath = path.join(getDayDir(date), 'matches.json');
  fs.writeFileSync(filePath, JSON.stringify(matches, null, 2), 'utf8');
}

function appendMatchEntry(entry, date) {
  const current = loadDayMatches(date);
  const exists = current.some((m) => m.key === entry.key);
  if (!exists) {
    current.push(entry);
  } else {
    const idx = current.findIndex((m) => m.key === entry.key);
    current[idx] = { ...current[idx], ...entry };
  }
  saveDayMatches(date, current);
}

function createMatchLogEntry(match, features, scored, decision) {
  const now = new Date();
  const ts = now.toISOString();
  const key = `${ts.slice(0, 16)}_${match.home}_vs_${match.away}`.replace(/\s+/g, '_');

  return {
    key,
    matchId: match.id,
    league: match.league,
    home: match.home,
    away: match.away,
    minute: match.minute,
    score: match.score,
    matchDetailsUrl: match.matchDetailsUrl,
    stats: features.raw,
    indices: {
      goalPressureIndex: scored.goalPressureIndex,
      dryPenalty: scored.dryPenalty,
      pGoal: scored.pGoal,
      pDry: scored.pDry,
    },
    prediction: {
      bet: decision.bet,
      confidence: decision.confidence,
      pGoal: decision.pGoal,
      pDry: decision.pDry,
      edge: decision.edge,
      reason: decision.reason,
    },
    provider: match.provider || 'flashscore-mobile-ua',
    timestamp: ts,
    resultChecked: false,
    actualResult: null,
    hit: null,
  };
}

function saveDaySummary(date, summary) {
  const filePath = path.join(getDayDir(date), 'summary.json');
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf8');
}

module.exports = {
  getDateString,
  getDayDir,
  loadDayMatches,
  saveDayMatches,
  appendMatchEntry,
  createMatchLogEntry,
  saveDaySummary,
};
