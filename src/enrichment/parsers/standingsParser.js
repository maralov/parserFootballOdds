'use strict';

const cheerio = require('cheerio');
const { computeFavoriteStrength } = require('../helpers/favoriteStrength');

/**
 * Normalize a team name for fuzzy matching (lowercase, trim, collapse spaces).
 * @param {string} name
 * @returns {string}
 */
function normalizeTeamName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parse table.standings rows into an array of team position objects.
 * Columns: #, Team, MP, W, D, L, G, Pts
 *
 * @param {CheerioStatic} $
 * @returns {Array<{ position, team, mp, w, d, l, gf, ga, gd, pts }>}
 */
function parseStandingsTable($) {
  const rows = [];
  $('table.standings tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (cells.length < 8) return;

    const position = parseInt(cells[0], 10) || 0;
    const team     = cells[1].replace(/\.$/, '').trim();
    const mp       = parseInt(cells[2], 10) || 0;
    const w        = parseInt(cells[3], 10) || 0;
    const d        = parseInt(cells[4], 10) || 0;
    const l        = parseInt(cells[5], 10) || 0;
    const goals    = cells[6] || '0:0';
    const pts      = parseInt(cells[7], 10) || 0;

    const [gf = 0, ga = 0] = goals.split(':').map(Number);
    const gd = gf - ga;

    rows.push({ position, team, mp, w, d, l, gf, ga, gd, pts });
  });
  return rows;
}

/**
 * Find the best matching row for a team name (normalized fuzzy match).
 * @param {Array} rows
 * @param {string} teamName
 * @returns {Object|null}
 */
function findTeamPosition(rows, teamName) {
  const target = normalizeTeamName(teamName);
  // Exact match first
  let found = rows.find(r => normalizeTeamName(r.team) === target);
  if (found) return found;
  // Contains match (handles abbreviations like "FC" dropped)
  found = rows.find(r => {
    const norm = normalizeTeamName(r.team);
    return norm.includes(target) || target.includes(norm);
  });
  return found || null;
}

/**
 * Parse the standings page for home and away team positions.
 *
 * @param {string} html
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @returns {{
 *   totalTeams: number,
 *   home: Object|null,
 *   away: Object|null,
 *   favoriteStrength: Object
 * }|null}
 */
function parseStandings(html, homeTeam, awayTeam) {
  const $ = cheerio.load(html);
  const rows = parseStandingsTable($);
  if (!rows.length) return null;

  const totalTeams = rows.length;
  const homeRow = findTeamPosition(rows, homeTeam);
  const awayRow = findTeamPosition(rows, awayTeam);

  if (!homeRow || !awayRow) return null;

  const homeData = { position: homeRow.position, mp: homeRow.mp, w: homeRow.w, d: homeRow.d, l: homeRow.l, gd: homeRow.gd, pts: homeRow.pts };
  const awayData = { position: awayRow.position, mp: awayRow.mp, w: awayRow.w, d: awayRow.d, l: awayRow.l, gd: awayRow.gd, pts: awayRow.pts };

  const favoriteStrength = computeFavoriteStrength(homeRow, awayRow, totalTeams);

  return { totalTeams, home: homeData, away: awayData, favoriteStrength };
}

module.exports = { parseStandings, parseStandingsTable, findTeamPosition };
