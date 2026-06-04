'use strict';

const cheerio = require('cheerio');
const { flashscoreToMobi } = require('../helpers/flashscoreUrlNormalizer');
const { parseScorePair } = require('../../parser/scoreUtils');

/**
 * Parse flashscore date string "DD.MM.YYYY" → Date object (local midnight).
 * Returns null on invalid input.
 */
function parseDateStr(str) {
  if (!str) return null;
  const parts = str.split('.');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

/**
 * Days elapsed between a date and today (always >= 0).
 * Returns null if date is invalid.
 */
function daysAgo(dateStr, now = new Date()) {
  const d = parseDateStr(dateStr);
  if (!d) return null;
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((todayMidnight - d) / 86_400_000));
}

/**
 * Normalize team name for comparison.
 */
function norm(name) {
  return (name || '').replace(/<!-- -->/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Determine W/D/L result from the perspective of a given team.
 *
 * @param {string} homeTeamInRow  first team listed in the match row
 * @param {string} awayTeamInRow  second team listed
 * @param {string} score          e.g. "4:0"
 * @param {string} perspectiveTeam  the team whose result we compute
 * @returns {'W'|'D'|'L'|null}
 */
function computeResult(homeTeamInRow, awayTeamInRow, score, perspectiveTeam) {
  const target = norm(perspectiveTeam);
  const isHome = norm(homeTeamInRow).includes(target) || target.includes(norm(homeTeamInRow));

  const pair = parseScorePair(score);
  if (!pair) return null;
  const { home: homeScore, away: awayScore } = pair;

  const myScore  = isHome ? homeScore  : awayScore;
  const oppScore = isHome ? awayScore  : homeScore;
  const vs       = isHome ? awayTeamInRow : homeTeamInRow;

  if (myScore > oppScore)  return { result: 'W', vs };
  if (myScore === oppScore) return { result: 'D', vs };
  return { result: 'L', vs };
}

/**
 * Parse a single H2H table row into a match entry.
 *
 * HTML row structure:
 *   <tr><td class="data">
 *     <span>05.05.2026</span>
 *     <span>Team A <!-- --> - <!-- --> Team B</span>
 *     <a href="https://www.flashscore.com/match/ID"><b>1:0</b></a>
 *   </td></tr>
 *
 * @param {CheerioAPI} $
 * @param {CheerioElement} tr
 * @returns {{ date, teams, score, matchUrl }|null}
 */
function parseH2hRow($, tr) {
  const spans = $(tr).find('td.data span');
  if (spans.length < 2) return null;

  const date  = $(spans[0]).text().trim();
  const teamsRaw = $(spans[1]).text().replace(/<!-- -->/g, '').trim();
  const scoreRaw = $(tr).find('a b').text().replace(/<!-- -->/g, '').trim();
  const href     = $(tr).find('a').attr('href') || '';

  if (!teamsRaw || !scoreRaw) return null;

  const [homeTeam = '', awayTeam = ''] = teamsRaw.split(' - ').map(s => s.trim());
  const matchUrl = flashscoreToMobi(href);

  return { date, homeTeam, awayTeam, score: scoreRaw, matchUrl };
}

/**
 * Parse all H2H sections from the h2h page.
 *
 * The page contains:
 *   <h4>Last matches: {homeTeamName}</h4><table class="h2h">...</table>
 *   <h4>Last matches: {awayTeamName}</h4><table class="h2h">...</table>
 *   <h4>Head-to-head matches</h4><table class="h2h">...</table>
 *
 * @param {string} html
 * @param {string} homeTeam  candidate home team name
 * @param {string} awayTeam  candidate away team name
 * @returns {{
 *   recentForm: { home: Array, away: Array },
 *   faceToFace: Array
 * }|null}
 */
function parseH2h(html, homeTeam, awayTeam) {
  const $ = cheerio.load(html);
  const content = $('#commentary-mobi, #detail-tab-content');

  const result = {
    recentForm: { home: [], away: [] },
    faceToFace: [],
  };

  let currentSection = null;
  const homeLower = norm(homeTeam);
  const awayLower = norm(awayTeam);

  content.find('h4, table.h2h').each((_, el) => {
    if (el.name === 'h4') {
      const text = $(el).text().trim();
      if (text.toLowerCase().startsWith('last matches:')) {
        const teamPart = text.replace(/last matches:/i, '').trim();
        const teamNorm = norm(teamPart);
        if (teamNorm.includes(homeLower) || homeLower.includes(teamNorm)) {
          currentSection = 'home';
        } else if (teamNorm.includes(awayLower) || awayLower.includes(teamNorm)) {
          currentSection = 'away';
        } else {
          currentSection = null;
        }
      } else if (text.toLowerCase().includes('head-to-head')) {
        currentSection = 'h2h';
      } else {
        currentSection = null;
      }
      return;
    }

    // <table class="h2h">
    $(el).find('tr').each((_, tr) => {
      const row = parseH2hRow($, tr);
      if (!row) return;

      if (currentSection === 'home' || currentSection === 'away') {
        const perspectiveTeam = currentSection === 'home' ? homeTeam : awayTeam;
        const res = computeResult(row.homeTeam, row.awayTeam, row.score, perspectiveTeam);
        if (!res) return;

        const entry = {
          date:     row.date,
          daysAgo:  daysAgo(row.date),
          result:   res.result,
          score:    row.score,
          vs:       res.vs.trim(),
          matchUrl: row.matchUrl,
        };
        result.recentForm[currentSection].push(entry);

      } else if (currentSection === 'h2h') {
        result.faceToFace.push({
          date:     row.date,
          daysAgo:  daysAgo(row.date),
          home:     row.homeTeam,
          away:     row.awayTeam,
          score:    row.score,
          matchUrl: row.matchUrl,
        });
      }
    });
  });

  const hasData = result.recentForm.home.length > 0
    || result.recentForm.away.length > 0
    || result.faceToFace.length > 0;

  if (!hasData) return null;

  // Summary convenience fields
  result.daysSinceLastH2h = result.faceToFace[0]?.daysAgo ?? null;
  result.daysSinceLastMatch = {
    home: result.recentForm.home[0]?.daysAgo ?? null,
    away: result.recentForm.away[0]?.daysAgo ?? null,
  };

  return result;
}

module.exports = { parseH2h, parseH2hRow, computeResult };
