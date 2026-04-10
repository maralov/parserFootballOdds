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

/**
 * Один запис на матч (dedup по matchId). predictions — об'єкт по часових вікнах:
 * { '60-70': {...}, '70-80': {...}, '80-90+': {...} }
 */
function appendMatchEntry(entry, date) {
  const current = loadDayMatches(date);
  const idx = current.findIndex((m) => m.matchId === entry.matchId);

  if (idx === -1) {
    const stored = { ...entry };
    if (entry.prediction && entry.prediction.timeWindow) {
      stored.predictions = {
        [entry.prediction.timeWindow]: { ...entry.prediction, minute: entry.minute, timestamp: entry.timestamp },
      };
      stored.latestPrediction = entry.prediction;
    } else {
      stored.predictions = {};
      stored.latestPrediction = null;
    }
    delete stored.prediction;
    current.push(stored);
  } else {
    const ex = current[idx];
    if (entry.minute !== undefined) ex.minute = entry.minute;
    if (entry.minuteBucket) ex.minuteBucket = entry.minuteBucket;
    if (entry.desktopUrl) ex.desktopUrl = entry.desktopUrl;
    if (entry.statsStatus && entry.statsStatus !== 'unavailable') {
      ex.statsStatus = entry.statsStatus;
      ex.stats = entry.stats;
    }
    if (entry.indices) ex.indices = entry.indices;
    if (entry.pipeline) ex.pipeline = entry.pipeline;
    if (entry.skipReason !== undefined) ex.skipReason = entry.skipReason;
    ex.timestamp = entry.timestamp;

    if (entry.prediction && entry.prediction.timeWindow) {
      if (!ex.predictions) ex.predictions = {};
      ex.predictions[entry.prediction.timeWindow] = {
        ...entry.prediction,
        minute: entry.minute,
        timestamp: entry.timestamp,
      };
      ex.latestPrediction = entry.prediction;
    }
  }

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
      timeWindow: decision.timeWindow,
      signalEligible: decision.signalEligible,
      impliedProb: decision.impliedProb,
      odds1X2: decision.odds1X2,
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
  const idx = current.findIndex((m) => m.matchId === matchId);
  if (idx !== -1) {
    current[idx].resultChecked = true;
    current[idx].actualResult = finalScore;
    current[idx].hit = hit;
    current[idx].resultTimestamp = toISO();
    saveDayMatches(date, current);
    return true;
  }
  return false;
}

module.exports = { getDateString, getDayDir, loadDayMatches, saveDayMatches, appendMatchEntry, createMatchLogEntry, updateMatchResult, saveDaySummary };
