'use strict';

const fs = require('fs');
const path = require('path');
const { sessionDateKey, toISO } = require('../helpers/date');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'logs');

function getDayDir(date) {
  const key = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : sessionDateKey(date);
  const dir = path.join(DATA_DIR, key);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFile(date) {
  return path.join(getDayDir(date), 'prediction_events.json');
}

function loadEvents(date) {
  const fp = getFile(date);
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) || []; } catch { return []; }
}

/**
 * Уніфікована подія прогнозу від будь-якої моделі/лінії.
 * Append-only — один виклик evaluate() = одна подія. Дублі (matchId+model+minute) перезаписуються.
 *
 * @param {object} ev
 * @param {string} ev.matchId
 * @param {'v3_main'|'L1'|'L2'} ev.model
 * @param {number} ev.minute
 * @param {'UNDER_0_5'|'OVER_0_5'|'SKIP'} ev.bet
 * @param {boolean} ev.signalEligible
 * @param {boolean} [ev.telegramSent]
 * @param {number|null} [ev.pDry]
 * @param {number|null} [ev.pGoal]
 * @param {number|null} [ev.signalQuality]
 * @param {number|null} [ev.edge]
 * @param {string|null} [ev.timeWindow]
 * @param {string|null} [ev.reason]
 * @param {object|null} [ev.components] — model-specific (consensus, trajectory, surge тощо)
 * @param {string} [ev.league]
 * @param {string} [ev.home]
 * @param {string} [ev.away]
 * @param {object} [ev.score]
 * @param {string} [ev.desktopUrl]
 */
function appendPredictionEvent(date, ev) {
  if (!ev || !ev.matchId || !ev.model) return;
  const list = loadEvents(date);
  const entry = { ...ev, ts: ev.ts || toISO() };
  // Dedup: same match + model + minute → replace (avoid log spam from same cycle)
  const idx = list.findIndex((e) => e.matchId === ev.matchId && e.model === ev.model && e.minute === ev.minute);
  if (idx === -1) list.push(entry); else list[idx] = entry;
  fs.writeFileSync(getFile(date), JSON.stringify(list, null, 2), 'utf8');
}

/** Збагачення подій фінальним результатом (викликається resultChecker'ом). */
function enrichWithResults(date, resultsByMatchId) {
  const list = loadEvents(date);
  let touched = 0;
  for (const e of list) {
    const r = resultsByMatchId[e.matchId];
    if (!r) continue;
    e.actualResult = r.score;
    e.actualTotal = (r.score?.home ?? 0) + (r.score?.away ?? 0);
    if (e.bet === 'UNDER_0_5') e.hit = e.actualTotal === 0;
    else if (e.bet === 'OVER_0_5') e.hit = e.actualTotal > 0;
    else e.hit = null;
    e.resultTimestamp = r.ts || toISO();
    touched++;
  }
  if (touched > 0) fs.writeFileSync(getFile(date), JSON.stringify(list, null, 2), 'utf8');
  return touched;
}

module.exports = { appendPredictionEvent, loadEvents, enrichWithResults, getFile };
