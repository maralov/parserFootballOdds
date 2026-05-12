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

module.exports = {
  TM05_ODDS_BY_MINUTE,
  TB05_ODDS_BY_MINUTE,
  tm05OddsAt,
  tb05OddsAt,
};
