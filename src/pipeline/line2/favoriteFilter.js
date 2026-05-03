'use strict';

/**
 * Виявляє фаворита 1X2 за коефіцієнтами та перевіряє поріг.
 * @param {{home:number,draw:number,away:number}|null} odds1X2
 * @param {number} maxOdds — поріг кф фаворита (≤)
 * @returns {{eligible:boolean, favoriteSide:'home'|'away'|null, favoriteOdds:number|null, reason:string|null}}
 */
function detectFavorite(odds1X2, maxOdds) {
  if (!odds1X2) {
    return { eligible: false, favoriteSide: null, favoriteOdds: null, reason: 'no odds 1X2' };
  }
  const h = Number(odds1X2.home);
  const a = Number(odds1X2.away);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h <= 1 || a <= 1) {
    return { eligible: false, favoriteSide: null, favoriteOdds: null, reason: 'invalid odds 1X2' };
  }
  const favoriteSide = h <= a ? 'home' : 'away';
  const favoriteOdds = Number(Math.min(h, a).toFixed(2));
  if (favoriteOdds > maxOdds) {
    return {
      eligible: false,
      favoriteSide,
      favoriteOdds,
      reason: `favorite odds=${favoriteOdds} > ${maxOdds}`,
    };
  }
  return { eligible: true, favoriteSide, favoriteOdds, reason: null };
}

module.exports = { detectFavorite };
