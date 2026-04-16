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
 * Один запис на матч (dedup по matchId).
 * prediction — зберігає ОСТАННІЙ NON-SKIP bet: SKIP не перезаписує попередню ставку.
 * betHistory — масив всіх NON-SKIP ставок (для обліку флів ТМ→ТБ).
 */
function appendMatchEntry(entry, date) {
  const current = loadDayMatches(date);
  const idx = current.findIndex((m) => m.matchId === entry.matchId);

  if (idx === -1) {
    const stored = { ...entry };
    stored.betHistory = [];
    _applyPrediction(stored, entry);
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
    if (entry.modelV2 !== undefined) ex.modelV2 = entry.modelV2;
    if (entry.preMatchV3 !== undefined) ex.preMatchV3 = entry.preMatchV3;
    if (entry.snapshotHistoryV2 !== undefined) ex.snapshotHistoryV2 = entry.snapshotHistoryV2;
    if (entry.liveTrajectory !== undefined) ex.liveTrajectory = entry.liveTrajectory;
    if (entry.pipeline) ex.pipeline = entry.pipeline;
    if (entry.skipReason !== undefined) ex.skipReason = entry.skipReason;
    if (entry.telegramInitialSent === true) ex.telegramInitialSent = true;
    ex.timestamp = entry.timestamp;
    _applyPrediction(ex, entry);
  }

  saveDayMatches(date, current);
}

/**
 * Застосовує prediction до запису.
 * SKIP не перезаписує існуючий non-SKIP prediction.
 * Non-SKIP завжди оновлює prediction і додає в betHistory.
 */
function _applyPrediction(stored, entry) {
  if (!entry.prediction) return;

  const newBet = entry.prediction.bet;
  const oldBet = stored.prediction?.bet;

  if (newBet !== 'SKIP') {
    stored.prediction = entry.prediction;

    // betHistory: додаємо тільки якщо ставка або вікно змінились
    if (!stored.betHistory) stored.betHistory = [];
    const last = stored.betHistory[stored.betHistory.length - 1];
    const isDifferent = !last || last.bet !== newBet || last.timeWindow !== entry.prediction.timeWindow;
    if (isDifferent) {
      stored.betHistory.push({
        bet: newBet,
        timeWindow: entry.prediction.timeWindow,
        minute: entry.minute,
        confidence: entry.prediction.confidence,
        pGoal: entry.prediction.pGoal,
        pDry: entry.prediction.pDry,
        signalQuality: entry.prediction.signalQuality,
        snapshotCount: entry.prediction.snapshotCount ?? null,
        timestamp: entry.prediction.timestamp || entry.timestamp,
      });
    }
  } else if (!oldBet || oldBet === 'SKIP') {
    // Записати SKIP тільки якщо не було попередньої non-SKIP ставки
    stored.prediction = entry.prediction;
  }
  // Якщо oldBet = non-SKIP і newBet = SKIP → НЕ перезаписуємо
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
    liveTrajectory: features?.liveTrajectory || null,
    indices: scored ? { ...scored } : null,
    modelV2: extras.modelV2 ?? null,
    snapshotHistoryV2: extras.snapshotHistoryV2 ?? null,
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
      signalQuality: decision.signalQuality,
      snapshotCount: extras.modelV2?.snapshotHistoryUsed ?? null,
      minute: match.minute,
      timestamp: ts,
    } : null,
    pipeline: extras.pipeline || 'candidate_found',
    skipReason: extras.skipReason || null,
    timestamp: ts,
    resultChecked: false,
    actualResult: null,
    hit: null,
    ...(extras.preMatchV3 !== undefined ? { preMatchV3: extras.preMatchV3 } : {}),
  };
}

function saveDaySummary(date, summary) {
  fs.writeFileSync(path.join(getDayDir(date), 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
}

function saveDayPredictions(date, predictionsPayload) {
  fs.writeFileSync(
    path.join(getDayDir(date), 'prediction.json'),
    JSON.stringify(predictionsPayload, null, 2),
    'utf8'
  );
}

function saveDayStakeRoi(date, payload) {
  fs.writeFileSync(
    path.join(getDayDir(date), 'stake_roi.json'),
    JSON.stringify(payload, null, 2),
    'utf8'
  );
}

/**
 * @param {boolean|object} hitOrPayload — legacy: boolean; новий формат: { hit, hitLegs?: [{ bet, hit }] }
 */
function updateMatchResult(matchId, finalScore, hitOrPayload, date) {
  const current = loadDayMatches(date);
  let updated = false;
  for (let i = 0; i < current.length; i++) {
    if (current[i].matchId !== matchId) continue;
    current[i].resultChecked = true;
    current[i].actualResult = finalScore;
    if (typeof hitOrPayload === 'boolean') {
      current[i].hit = hitOrPayload;
    } else if (hitOrPayload && typeof hitOrPayload === 'object') {
      current[i].hit = hitOrPayload.hit;
      if (Array.isArray(hitOrPayload.hitLegs)) current[i].hitLegs = hitOrPayload.hitLegs;
    }
    current[i].resultTimestamp = toISO();
    updated = true;
  }
  if (updated) saveDayMatches(date, current);
  return updated;
}

/** Позначити що перший сигнал у Telegram вже надіслано (анти-дубль після рестарту). */
function markTelegramInitialSent(matchId, date) {
  const current = loadDayMatches(date);
  const idx = current.findIndex((m) => m.matchId === matchId);
  if (idx !== -1) {
    current[idx].telegramInitialSent = true;
    saveDayMatches(date, current);
    return true;
  }
  return false;
}

module.exports = {
  getDateString, getDayDir, loadDayMatches, saveDayMatches, appendMatchEntry, createMatchLogEntry,
  updateMatchResult, markTelegramInitialSent, saveDaySummary, saveDayPredictions, saveDayStakeRoi,
};
