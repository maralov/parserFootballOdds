'use strict';

const { detectFavorite } = require('./favoriteFilter');
const { detectPressure } = require('./pressureDetector');
const {
  LINE2_MIN_DECISION_MINUTE,
  LINE2_MAX_DECISION_MINUTE,
  LINE2_FAVORITE_ODDS_MAX,
  LINE2_PRESSURE_THRESHOLD,
  LINE2_MIN_SURGE_METRICS,
  LINE2_REQUIRE_MONOTONIC,
  LINE2_MIN_SNAPSHOTS_IN_WINDOW,
  LINE2_SURGE_RATIO,
} = require('../../helpers/constants');

function isZeroZero(score) {
  return !!(score && String(score.home) === '0' && String(score.away) === '0');
}

function detectScoreChange(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return false;
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1].score;
    const b = snapshots[i].score;
    if (!a || !b) continue;
    if (String(a.home) !== String(b.home) || String(a.away) !== String(b.away)) return true;
  }
  return false;
}

/**
 * Line 2: ставка ТБ 0,5 на пізній push фаворита у матчі 0:0.
 *
 * @param {{
 *   match:object,
 *   features:{minute:number, odds1X2:object|null, league:string|null},
 *   snapshots:Array,
 *   incidents:{homeRedCards:number, awayRedCards:number}|null,
 *   lockedFavorite?: {favoriteSide:'home'|'away', favoriteOdds:number, lockedAtMinute:number}|null
 * }} input
 *
 * Якщо передано lockedFavorite — фаворит визнаний раніше і повторно не перевіряється
 * проти live odds (вони можуть мігрувати під час матчу). Перший раз коли lockedFavorite=null,
 * engine використовує features.odds1X2 для встановлення фаворита; результат повертається
 * у полях favoriteSide/favoriteOdds — caller повинен закешувати.
 */
function evaluateLine2LateSurge({ match, features, snapshots, incidents, lockedFavorite = null }) {
  const minute = Number(features?.minute);
  const score = match?.score;

  // Gate 1: 0:0
  if (!isZeroZero(score)) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `score not 0:0 (${score?.home ?? '?'}:${score?.away ?? '?'})`,
      pressureScore: null, components: null, favoriteSide: null, favoriteOdds: null, minute,
    };
  }

  // Gate 2: window
  if (!Number.isFinite(minute) || minute < LINE2_MIN_DECISION_MINUTE) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `minute=${minute} before window (>=${LINE2_MIN_DECISION_MINUTE})`,
      pressureScore: null, components: null, favoriteSide: null, favoriteOdds: null, minute,
    };
  }
  if (minute > LINE2_MAX_DECISION_MINUTE) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `minute=${minute} after window (<=${LINE2_MAX_DECISION_MINUTE})`,
      pressureScore: null, components: null, favoriteSide: null, favoriteOdds: null, minute,
    };
  }

  // Gate 3: favorite — використовуємо locked (визнаний при першому циклі), або визначаємо вперше
  let fav;
  if (lockedFavorite && lockedFavorite.favoriteSide) {
    fav = {
      eligible: lockedFavorite.favoriteOdds <= LINE2_FAVORITE_ODDS_MAX,
      favoriteSide: lockedFavorite.favoriteSide,
      favoriteOdds: lockedFavorite.favoriteOdds,
      reason: lockedFavorite.favoriteOdds <= LINE2_FAVORITE_ODDS_MAX
        ? null
        : `locked favorite odds=${lockedFavorite.favoriteOdds} > ${LINE2_FAVORITE_ODDS_MAX}`,
      locked: true,
    };
  } else {
    fav = detectFavorite(features?.odds1X2, LINE2_FAVORITE_ODDS_MAX);
    fav.locked = false;
  }
  if (!fav.eligible) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: fav.reason,
      pressureScore: null, components: null,
      favoriteSide: fav.favoriteSide, favoriteOdds: fav.favoriteOdds,
      favoriteLocked: fav.locked, minute,
    };
  }

  // Gate 4: score not changed (means goal happened — invalidate baseline)
  if (detectScoreChange(snapshots)) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: 'score changed during observation — Line 2 only on stable 0:0',
      pressureScore: null, components: null,
      favoriteSide: fav.favoriteSide, favoriteOdds: fav.favoriteOdds,
      favoriteLocked: fav.locked, minute,
    };
  }

  // Gate 5: red card handling
  const rcHome = Number(incidents?.homeRedCards) || 0;
  const rcAway = Number(incidents?.awayRedCards) || 0;
  const favoriteRedCard = (fav.favoriteSide === 'home' && rcHome > 0)
                       || (fav.favoriteSide === 'away' && rcAway > 0);
  const underdogRedCard = (fav.favoriteSide === 'home' && rcAway > 0)
                       || (fav.favoriteSide === 'away' && rcHome > 0);
  if (favoriteRedCard) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `red card to favorite (${fav.favoriteSide}, h=${rcHome} a=${rcAway})`,
      pressureScore: null, components: null,
      favoriteSide: fav.favoriteSide, favoriteOdds: fav.favoriteOdds,
      favoriteLocked: fav.locked, minute,
    };
  }

  // Pressure detection
  const pressure = detectPressure(snapshots, {
    startMinute: LINE2_MIN_DECISION_MINUTE,
    surgeRatio: LINE2_SURGE_RATIO,
  });

  // Gate 6: enough snapshots in window
  if (pressure.snapshotsInWindow < LINE2_MIN_SNAPSHOTS_IN_WINDOW) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `snapshots in late window=${pressure.snapshotsInWindow} < ${LINE2_MIN_SNAPSHOTS_IN_WINDOW}`,
      pressureScore: pressure.pressureScore, components: pressure,
      favoriteSide: fav.favoriteSide, favoriteOdds: fav.favoriteOdds,
      favoriteLocked: fav.locked, minute,
    };
  }

  // Underdog red card → бонус: знижуємо вимоги до monotonic + поріг surge
  // (фаворит має пресувати, навіть якщо темп нестабільний — більшість, всупереч поточному, теж важлива)
  const requireMonotonic = LINE2_REQUIRE_MONOTONIC && !underdogRedCard;
  const minSurgeMetrics  = underdogRedCard ? Math.max(1, LINE2_MIN_SURGE_METRICS - 1) : LINE2_MIN_SURGE_METRICS;
  const pressureThreshold = underdogRedCard
    ? Math.max(0, LINE2_PRESSURE_THRESHOLD - 0.15)
    : LINE2_PRESSURE_THRESHOLD;

  // Gate 7: monotonic
  if (requireMonotonic && !pressure.monotonic) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: 'pressure not monotonic — drops between snapshots',
      pressureScore: pressure.pressureScore, components: pressure,
      favoriteSide: fav.favoriteSide, favoriteOdds: fav.favoriteOdds,
      favoriteLocked: fav.locked, minute,
    };
  }

  // Gate 8: surging metrics count
  if (pressure.surgingCount < minSurgeMetrics) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `surge metrics ${pressure.surgingCount} < ${minSurgeMetrics}`,
      pressureScore: pressure.pressureScore, components: pressure,
      favoriteSide: fav.favoriteSide, favoriteOdds: fav.favoriteOdds,
      favoriteLocked: fav.locked, minute,
    };
  }

  // Gate 9: pressureScore threshold
  if (pressure.pressureScore < pressureThreshold) {
    return {
      bet: 'SKIP', signalEligible: false,
      reason: `pressureScore=${pressure.pressureScore} < ${pressureThreshold}`,
      pressureScore: pressure.pressureScore, components: pressure,
      favoriteSide: fav.favoriteSide, favoriteOdds: fav.favoriteOdds,
      favoriteLocked: fav.locked, minute,
    };
  }

  // SIGNAL!
  const boost = underdogRedCard ? ' +UNDERDOG_RED_CARD' : '';
  return {
    bet: 'OVER_0_5',
    signalEligible: true,
    reason: `Line2 ТБ 0.5 — pressure=${pressure.pressureScore}, surge=${pressure.surgingCount}/5, fav=${fav.favoriteSide}@${fav.favoriteOdds}${boost}`,
    pressureScore: pressure.pressureScore,
    components: pressure,
    favoriteSide: fav.favoriteSide,
    favoriteOdds: fav.favoriteOdds,
    favoriteLocked: fav.locked,
    underdogRedCard,
    minute,
  };
}

module.exports = { evaluateLine2LateSurge };
