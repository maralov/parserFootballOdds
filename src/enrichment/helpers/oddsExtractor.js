'use strict';

/**
 * Parse the odds block from a parsed cheerio document.
 * Looks for .p-set.odds-detail links — order: home | draw | away.
 *
 * @param {CheerioStatic} $
 * @returns {{ home: number|null, draw: number|null, away: number|null }|null}
 */
function parseOddsBlock($) {
  const links = $('.p-set.odds-detail a');
  if (links.length < 3) return null;

  const values = links.map((_, el) => {
    const n = parseFloat($(el).text().trim());
    return Number.isFinite(n) ? n : null;
  }).get();

  if (values.length < 3) return null;

  return {
    home: values[0],
    draw: values[1],
    away: values[2],
  };
}

/**
 * Determine the favorite team (if any) based on odds.
 * A team is a favorite if its odds are below the threshold.
 *
 * Returns an isOddsFavorite descriptor:
 *   { favorite: 'home'|'away'|null, margin: number, threshold: number }
 *
 * @param {{ home: number|null, draw: number|null, away: number|null }} odds
 * @param {number} threshold  default 1.8
 */
function computeFavorite(odds, threshold = 1.8) {
  if (!odds) return { favorite: null, margin: 0, threshold };

  const { home, away } = odds;
  const homeFav = home != null && home < threshold;
  const awayFav = away != null && away < threshold;

  if (!homeFav && !awayFav) {
    return { favorite: null, margin: 0, threshold };
  }

  // When both somehow qualify (very rare), pick the lower odds side
  if (homeFav && awayFav) {
    const favorite = home <= away ? 'home' : 'away';
    const odds_val = favorite === 'home' ? home : away;
    return { favorite, margin: Math.round((threshold - odds_val) * 100) / 100, threshold };
  }

  if (homeFav) {
    return { favorite: 'home', margin: Math.round((threshold - home) * 100) / 100, threshold };
  }

  return { favorite: 'away', margin: Math.round((threshold - away) * 100) / 100, threshold };
}

module.exports = { parseOddsBlock, computeFavorite };
