'use strict';

// First-half (1HUNDER) favorite gate.
//
// Beyond "has a clear favorite", optionally exclude HEAVY favorites: empirically
// a very strong favorite (low odds) breaks the 0:0 before halftime more often, so
// betting ТМ 0.5 1H against it is worse. LIVE_1H_FAV_ODDS_MIN sets the lower bound
// on the favorite's odds (0 = disabled). The upper bound (~1.8) is already enforced
// upstream by computeFavorite's threshold.

/**
 * @param {Object} odds  match odds with isOddsFavorite { favorite }
 * @param {Object} cfg   env (LIVE_1H_FAV_ODDS_MIN)
 * @returns {{ pass:boolean, reason:string|null, favorite:('home'|'away'|null), favOdd:(number|null) }}
 */
function passesFavoriteGate1H(odds, cfg) {
  const favorite = odds?.isOddsFavorite?.favorite;
  if (favorite !== 'home' && favorite !== 'away') {
    return { pass: false, reason: 'no_favorite', favorite: null, favOdd: null };
  }

  const favOdd = odds[favorite];
  const min = Number(cfg?.LIVE_1H_FAV_ODDS_MIN) || 0;
  if (min > 0 && (favOdd == null || favOdd < min)) {
    return { pass: false, reason: 'fav_too_strong', favorite, favOdd: favOdd ?? null };
  }

  const max = Number(cfg?.LIVE_1H_FAV_ODDS_MAX) || 0;
  if (max > 0 && (favOdd == null || favOdd > max)) {
    return { pass: false, reason: 'fav_too_weak', favorite, favOdd: favOdd ?? null };
  }

  // Empirically away favorites keep the 0:0 to HT more often than home favorites
  // (home favorite is expected to attack and break through early).
  if (cfg?.LIVE_1H_AWAY_FAV_ONLY && favorite !== 'away') {
    return { pass: false, reason: 'fav_not_away', favorite, favOdd };
  }

  return { pass: true, reason: null, favorite, favOdd };
}

module.exports = { passesFavoriteGate1H };
