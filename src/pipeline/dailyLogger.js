const fs = require('fs');
const path = require('path');
const { dateKeyLocal, toISO } = require('../helpers/date');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'logs');

function getDateString(date) {
  return dateKeyLocal(date);
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
  const ts = toISO();
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
    feed: match.feed || extras.feed || null,
    feedUrl: match.feedUrl || extras.feedUrl || null,
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
    skipReason: extras.skipReason || null,
    timestamp: ts,
    resultChecked: false,
    actualResult: null,
    hit: null,
  };
}

function saveDaySummary(date, summary) {
  fs.writeFileSync(path.join(getDayDir(date), 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
}

function updateMatchResult(matchId, finalScore, hit, date) {
  const current = loadDayMatches(date);
  let updated = false;
  for (let i = current.length - 1; i >= 0; i--) {
    if (current[i].matchId === matchId && current[i].pipeline === 'decision_made') {
      current[i].resultChecked = true;
      current[i].actualResult = finalScore;
      current[i].hit = hit;
      current[i].resultTimestamp = toISO();
      updated = true;
    }
  }
  if (updated) saveDayMatches(date, current);
  return updated;
}

module.exports = { getDateString, getDayDir, loadDayMatches, saveDayMatches, appendMatchEntry, createMatchLogEntry, updateMatchResult, saveDaySummary };
