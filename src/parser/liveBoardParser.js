'use strict';

const cheerio = require('cheerio');
const { sanitizeLeagueName, sanitizeTeams } = require('../helpers/utils/normalizeMatchText');
const { parseMinute } = require('./minuteUtils');
const { extractMatchId } = require('./urlUtils');
const { normalizeScoreString } = require('./scoreUtils');

/**
 * @typedef {Object} LiveMatch
 * @property {string|null} matchId
 * @property {string} country
 * @property {string} league
 * @property {string} homeTeam
 * @property {string} awayTeam
 * @property {string} score       - e.g. "0:0", "2:1"
 * @property {number|null} minute - synthetic minute
 * @property {string} status      - raw status text from span.live
 * @property {string} matchUrl    - e.g. "/match/Sh1Xq0bL/?s=2"
 */

/**
 * @typedef {Object} BoardHealth
 * @property {number} totalRows
 * @property {number} totalZeroZero
 * @property {number} missingId
 * @property {number} parseErrors
 */

/**
 * Parse the full HTML of flashscore.mobi/?s=2 into a list of live matches.
 *
 * DOM structure inside #score-data (flat, server-rendered):
 *   <h4>COUNTRY: League <a>Standings</a></h4>
 *   <span class="live">45+'</span>Home - Away <a href="/match/ID/?s=2" class="live">0:0</a><br>
 *   <span class="live">90+'</span>Home - Away<img class="rcard-1"> <a ... class="live">2-0</a><br>
 *   (Flashscore may use ":" or "-" as separator; normalized to "H:A" internally.)
 *
 * Strategy: walk #score-data.contents() tracking state (league, pendingStatus, pendingTeamText).
 * An `a.live[href*=/match/]` node closes a "row" and produces one LiveMatch.
 *
 * @param {string} html
 * @returns {{ matches: LiveMatch[], health: BoardHealth }}
 */
function parseLiveBoard(html) {
  /** @type {LiveMatch[]} */
  const matches = [];
  /** @type {BoardHealth} */
  const health = { totalRows: 0, totalZeroZero: 0, missingId: 0, parseErrors: 0 };

  let $;
  try {
    $ = cheerio.load(html);
  } catch (e) {
    health.parseErrors++;
    return { matches, health };
  }

  const scoreData = $('#score-data');
  if (!scoreData.length) {
    return { matches, health };
  }

  let currentCountry = 'unknown';
  let currentLeague = 'unknown';
  let pendingStatus = null;
  let pendingTeamText = '';

  scoreData.contents().each((_, node) => {
    try {
      const $node = $(node);

      if (node.type === 'tag' && node.name === 'h4') {
        const rawText = $node.text();
        const cleaned = sanitizeLeagueName(rawText);
        const colonIdx = cleaned.indexOf(':');
        if (colonIdx > 0) {
          currentCountry = cleaned.slice(0, colonIdx).trim();
          currentLeague = cleaned.slice(colonIdx + 1).trim();
        } else {
          currentCountry = cleaned || 'unknown';
          currentLeague = 'unknown';
        }
        // h4 resets any dangling row state
        pendingStatus = null;
        pendingTeamText = '';
        return;
      }

      if (node.type === 'tag' && node.name === 'span' && $node.hasClass('live')) {
        pendingStatus = $node.text().trim();
        pendingTeamText = '';
        return;
      }

      // Accumulate text between span.live and a.live (skip tags like <img>)
      if (node.type === 'text' && pendingStatus !== null) {
        pendingTeamText += node.data || '';
        return;
      }

      if (
        node.type === 'tag' &&
        node.name === 'a' &&
        $node.hasClass('live') &&
        ($node.attr('href') || '').includes('/match/')
      ) {
        health.totalRows++;

        const href = $node.attr('href') || '';
        const score = normalizeScoreString($node.text().trim());
        const matchId = extractMatchId(href);

        if (!matchId) health.missingId++;
        if (score === '0:0') health.totalZeroZero++;

        const rawTeamText = pendingTeamText.replace(/\s+/g, ' ').trim();
        const dashMatch = rawTeamText.match(/^(.+?)\s+-\s+(.+)$/);
        const homeRaw = dashMatch ? dashMatch[1] : rawTeamText;
        const awayRaw = dashMatch ? dashMatch[2] : '';
        const { home, away } = sanitizeTeams(homeRaw, awayRaw);

        matches.push({
          matchId,
          country: currentCountry,
          league: currentLeague,
          homeTeam: home,
          awayTeam: away,
          score,
          minute: parseMinute(pendingStatus),
          status: pendingStatus || '',
          matchUrl: matchId ? `/match/${matchId}/?s=2` : href,
        });

        pendingStatus = null;
        pendingTeamText = '';
      }
    } catch (e) {
      health.parseErrors++;
    }
  });

  return { matches, health };
}

module.exports = { parseLiveBoard };
