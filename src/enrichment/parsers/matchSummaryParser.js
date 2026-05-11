'use strict';

const cheerio = require('cheerio');
const { parseOddsBlock, computeFavorite } = require('../helpers/oddsExtractor');

/**
 * Extract available tab flags from #detail-tabs.
 * Looks for <a> links with ?t=stats, ?t=standings, ?t=h2h.
 *
 * @param {CheerioStatic} $
 * @returns {{ stats: boolean, standings: boolean, h2h: boolean }}
 */
function extractTabs($) {
  const tabsHtml = $('#detail-tabs').html() || '';
  // cheerio serializes & → &amp; in attribute values, so check both
  function hasTab(name) {
    return tabsHtml.includes(`?t=${name}`)
      || tabsHtml.includes(`&t=${name}`)
      || tabsHtml.includes(`&amp;t=${name}`);
  }
  return {
    stats:     hasTab('stats'),
    standings: hasTab('standings'),
    h2h:       hasTab('h2h'),
  };
}

/**
 * Parse the match summary page.
 *
 * @param {string} html  raw HTML of /match/{id}/?s=2
 * @param {number} oddsThreshold
 * @returns {{
 *   tabs: { stats: boolean, standings: boolean, h2h: boolean },
 *   odds: { home, draw, away, isOddsFavorite }|null,
 * }}
 */
function parseMatchSummary(html, oddsThreshold = 1.8) {
  const $ = cheerio.load(html);
  const tabs = extractTabs($);
  const rawOdds = parseOddsBlock($);

  let odds = null;
  if (rawOdds) {
    odds = {
      ...rawOdds,
      isOddsFavorite: computeFavorite(rawOdds, oddsThreshold),
    };
  }

  return { tabs, odds };
}

module.exports = { parseMatchSummary, extractTabs };
