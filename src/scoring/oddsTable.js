'use strict';

const TM05_ODDS_BY_MINUTE = {
  60: 2.00,
  65: 1.85,
  70: 1.70,
  75: 1.60,
};

const TB05_ODDS_BY_MINUTE = {
  80: 1.90,
  85: 2.50,
  88: 3.00,
  90: 3.50,
};

// 1HUNDER — ТМ 0.5 першого тайму (0:0 на перерві). Реальний ринок на 25–30' ≈ 1.45–1.97
// і корелює з прематч-кефом нічиєї (проксі очікуваної результативності), НЕ з фіктивними
// 2.6/2.2. Provisional бакети з 2026-06-16 (7 точок) — калібрувати в P4.
const TM05_1H_UNDER_BASE = 1.60; // fallback коли прематч-кеф нічиєї відсутній

function tmUnderOddsFromDraw(drawOdds) {
  if (drawOdds == null || !Number.isFinite(drawOdds)) return TM05_1H_UNDER_BASE;
  if (drawOdds < 2.6) return 1.45;
  if (drawOdds < 3.3) return 1.55;
  if (drawOdds < 3.8) return 1.70;
  return 1.95;
}

// 1HOVER — ТБ 0.5 першого тайму (гол ДО перерви). Вікно для голу скорочується з часом,
// тож P(гол) падає → кеф РОСТЕ. Реальне спостереження 2026-06-16: 27'≈1.8, 30'≈2.1, 35'≈2.5.
// (Стара таблиця спадала — баг: інверсія за часом.)
const TB05_1H_ODDS_BY_MINUTE = {
  25: 1.80,
  30: 2.10,
  35: 2.50,
};

function nearestKey(table, minute) {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) {
    if (k <= minute) best = k;
  }
  return best;
}

function tm05OddsAt(minute) {
  if (minute == null || !Number.isFinite(minute)) return null;
  if (minute < 60) return TM05_ODDS_BY_MINUTE[60];
  if (minute > 75) return null;
  return TM05_ODDS_BY_MINUTE[nearestKey(TM05_ODDS_BY_MINUTE, minute)];
}

function tb05OddsAt(minute) {
  if (minute == null || !Number.isFinite(minute)) return null;
  if (minute < 80) return TB05_ODDS_BY_MINUTE[80];
  if (minute > 90) return null;
  return TB05_ODDS_BY_MINUTE[nearestKey(TB05_ODDS_BY_MINUTE, minute)];
}

function tm05_1hOddsAt(minute, matchOdds) {
  if (minute == null || !Number.isFinite(minute)) return null;
  if (minute > 35) return null; // лінія закрита після вікна рішення
  return tmUnderOddsFromDraw(matchOdds?.draw);
}

function tb05_1hOddsAt(minute, matchOdds) { // matchOdds зарезервовано (favorite-tilt → P4)
  if (minute == null || !Number.isFinite(minute)) return null;
  if (minute < 25) return TB05_1H_ODDS_BY_MINUTE[25];
  if (minute > 35) return null;
  return TB05_1H_ODDS_BY_MINUTE[nearestKey(TB05_1H_ODDS_BY_MINUTE, minute)];
}

module.exports = {
  TM05_ODDS_BY_MINUTE,
  TB05_ODDS_BY_MINUTE,
  TB05_1H_ODDS_BY_MINUTE,
  TM05_1H_UNDER_BASE,
  tmUnderOddsFromDraw,
  tm05OddsAt,
  tb05OddsAt,
  tm05_1hOddsAt,
  tb05_1hOddsAt,
};
