'use strict';

const { fetchResilient } = require('../fetcher/resilientFetcher');
const { randomDelay } = require('../fetcher/antibot/delays');
const { buildSummaryUrl, buildStatsUrl, buildStandingsUrl, buildH2hUrl } = require('./helpers/urlBuilder');
const { parseMatchSummary } = require('./parsers/matchSummaryParser');
const { parseMatchStats } = require('./parsers/matchStatsParser');
const { parseStandings } = require('./parsers/standingsParser');
const { parseH2h } = require('./parsers/h2hParser');
const env = require('../config/env');
const logger = require('../observability/logger');

/** Candidate context fields carried into every enrichment record. */
function candidateMeta(candidate) {
  return {
    country:  candidate.country  || null,
    league:   candidate.league   || null,
    homeTeam: candidate.homeTeam || null,
    awayTeam: candidate.awayTeam || null,
    matchUrl: candidate.matchUrl || null,
  };
}

function printProgress(line) {
  process.stdout.write(`  ${line}\n`);
}

/**
 * Enrich a single candidate with odds, stats, standings, and H2H data.
 * Performs 2–4 sequential HTTP requests with randomized delays.
 *
 * @param {{ matchId, homeTeam, awayTeam, currentStatus, country, league, matchUrl }} candidate
 * @returns {Promise<Object>}
 */
async function enrichOne(candidate) {
  const { matchId, homeTeam, awayTeam, currentStatus } = candidate;
  const enrichedAt = new Date().toISOString();
  const label = `${homeTeam} - ${awayTeam}`;

  printProgress(`↻  ${matchId}  ${label}`);

  try {
    // ── Step 1: Summary page (tabs + odds) ──────────────────────────────────
    await randomDelay(env.LIVE_ENRICHMENT_DELAY_MIN_MS, env.LIVE_ENRICHMENT_DELAY_MAX_MS);
    const summaryRes = await fetchResilient(buildSummaryUrl(matchId));
    const { tabs, odds } = parseMatchSummary(summaryRes.html, env.LIVE_ODDS_FAVORITE_THRESHOLD);

    if (!tabs.stats) {
      printProgress(`✗  ${matchId}  skip:no_stats  (${label})`);
      return {
        matchId,
        ...candidateMeta(candidate),
        status: 'skip:no_stats',
        skippedAt: enrichedAt,
        reason: 'no stats tab in #detail-tabs',
      };
    }

    // ── Step 2: Stats page ───────────────────────────────────────────────────
    await randomDelay(env.LIVE_ENRICHMENT_DELAY_MIN_MS, env.LIVE_ENRICHMENT_DELAY_MAX_MS);
    const statsRes = await fetchResilient(buildStatsUrl(matchId));
    const statistics = parseMatchStats(statsRes.html, currentStatus);

    // Extract statsLevel from internal field, then clean it off the statistics object
    const statsLevel = statistics?._statsLevel || null;
    if (statistics) delete statistics._statsLevel;

    const result = {
      matchId,
      ...candidateMeta(candidate),
      status: 'enriched',
      enrichedAt,
      tabs,
      odds,
      statsLevel,
      statistics,
      standings: null,
      h2h: null,
    };

    // ── Step 3: Standings (if tab present) ──────────────────────────────────
    if (tabs.standings) {
      await randomDelay(env.LIVE_ENRICHMENT_DELAY_MIN_MS, env.LIVE_ENRICHMENT_DELAY_MAX_MS);
      try {
        const standingsRes = await fetchResilient(buildStandingsUrl(matchId));
        result.standings = parseStandings(standingsRes.html, homeTeam, awayTeam);
      } catch (err) {
        logger.warn('Standings fetch failed', { matchId, err: err.message });
      }
    }

    // ── Step 4: H2H (if tab present) ────────────────────────────────────────
    if (tabs.h2h) {
      await randomDelay(env.LIVE_ENRICHMENT_DELAY_MIN_MS, env.LIVE_ENRICHMENT_DELAY_MAX_MS);
      try {
        const h2hRes = await fetchResilient(buildH2hUrl(matchId));
        result.h2h = parseH2h(h2hRes.html, homeTeam, awayTeam);
      } catch (err) {
        logger.warn('H2H fetch failed', { matchId, err: err.message });
      }
    }

    const favPart = odds?.isOddsFavorite?.favorite
      ? `fav=${odds.isOddsFavorite.favorite} (${odds[odds.isOddsFavorite.favorite]})`
      : 'fav=balanced';
    const strPart = result.standings?.favoriteStrength
      ? `  strength=${result.standings.favoriteStrength.label}`
      : '';

    printProgress(`✓  ${matchId}  enriched  level=${statsLevel || '?'}  ${favPart}${strPart}  (${label})`);
    return result;

  } catch (err) {
    logger.error('Enrichment failed', { matchId, err: err.message });
    printProgress(`!  ${matchId}  failed: ${err.message}`);
    return {
      matchId,
      ...candidateMeta(candidate),
      status: 'failed',
      failedAt: enrichedAt,
      reason: err.message,
    };
  }
}

module.exports = { enrichOne };
