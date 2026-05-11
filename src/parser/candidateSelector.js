'use strict';

const { isHalftimeStatus } = require('./minuteUtils');
const { toISO } = require('../helpers/date');

/**
 * @typedef {Object} Candidate
 * @property {string} matchId
 * @property {string} country
 * @property {string} league
 * @property {string} homeTeam
 * @property {string} awayTeam
 * @property {string} matchUrl
 * @property {string} discoveredAt  - ISO timestamp
 */

/**
 * @typedef {Object} PotentialSleeper
 * @property {number} minute
 * @property {string} matchId
 * @property {string} homeTeam
 * @property {string} awayTeam
 */

/**
 * Filter live matches into candidates and potential sleepers.
 *
 * Candidate = score 0:0 AND status is halftime or 45+'.
 * PotentialSleeper = score 0:0 AND in 1st half (minute < 45) — used for adaptive sleep.
 *
 * @param {import('./liveBoardParser').LiveMatch[]} matches
 * @param {number} [cycleId]
 * @returns {{ candidates: Candidate[], potentialSleepers: PotentialSleeper[] }}
 */
function selectCandidates(matches, cycleId) {
  /** @type {Candidate[]} */
  const candidates = [];
  /** @type {PotentialSleeper[]} */
  const potentialSleepers = [];

  const discoveredAt = toISO();

  for (const m of matches) {
    if (m.score !== '0:0') continue;
    if (!m.matchId) continue;

    if (isHalftimeStatus(m.status)) {
      candidates.push({
        matchId: m.matchId,
        country: m.country,
        league: m.league,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        currentStatus: m.status || '',
        matchUrl: m.matchUrl,
        discoveredAt,
        ...(cycleId !== undefined ? { cycleId } : {}),
      });
    } else if (m.minute !== null && m.minute < 45) {
      potentialSleepers.push({
        minute: m.minute,
        matchId: m.matchId,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
      });
    }
  }

  return { candidates, potentialSleepers };
}

module.exports = { selectCandidates };
