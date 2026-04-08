const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'logs');

function getDateString(date) {
  return (date || new Date()).toISOString().slice(0, 10);
}

function getDayDir(date) {
  const dir = path.join(DATA_DIR, getDateString(date));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadDayMatches(date) {
  const fp = path.join(getDayDir(date), 'matches.json');
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) || []; } catch { return []; }
}

function saveDayMatches(date, matches) {
  fs.writeFileSync(path.join(getDayDir(date), 'matches.json'), JSON.stringify(matches, null, 2), 'utf8');
}

function appendMatchEntry(entry, date) {
  const current = loadDayMatches(date);
  const idx = current.findIndex((m) => m.matchId === entry.matchId && m.minuteBucket === entry.minuteBucket);
  if (idx === -1) current.push(entry);
  else current[idx] = { ...current[idx], ...entry };
  saveDayMatches(date, current);
}

function createMatchLogEntry(match, features, scored, decision, extras = {}) {
  const ts = new Date().toISOString();
  return {
    matchId: match.id,
    league: match.league,
    home: match.home,
    away: match.away,
    minute: match.minute,
    minuteBucket: features?.minuteBucket || null,
    score: match.score,
    mobileUrl: match.matchDetailsUrl,
    desktopUrl: extras.desktopUrl || null,
    statsStatus: features?.statsStatus || 'unavailable',
    stats: {
      overall: features?.rawOverall || null,
      secondHalf: features?.raw2H || null,
    },
    indices: scored ? {
      goalPressureIndex: scored.goalPressureIndex,
      dryPenalty: scored.dryPenalty,
      trendBonus: scored.trendBonus,
      imbalanceBonus: scored.imbalanceBonus,
      pGoal: scored.pGoal,
      pDry: scored.pDry,
    } : null,
    prediction: decision ? {
      bet: decision.bet,
      confidence: decision.confidence,
      pGoal: decision.pGoal,
      pDry: decision.pDry,
      edge: decision.edge,
      reason: decision.reason,
    } : null,
    pipeline: extras.pipeline || 'candidate_found',
    timestamp: ts,
    resultChecked: false,
    actualResult: null,
    hit: null,
  };
}

function saveDaySummary(date, summary) {
  fs.writeFileSync(path.join(getDayDir(date), 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
}

module.exports = { getDateString, getDayDir, loadDayMatches, saveDayMatches, appendMatchEntry, createMatchLogEntry, saveDaySummary };
