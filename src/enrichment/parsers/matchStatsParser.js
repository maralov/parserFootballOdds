'use strict';

const cheerio = require('cheerio');
const { mapStatsLabel } = require('../helpers/statsLabelMap');
const { applyStatsValue } = require('../helpers/statsValueParser');
const { detectStatsLevel } = require('../helpers/statsLevelDetector');
const { computeOverall } = require('../helpers/statsOverall');

// ─── Feed string extraction ───────────────────────────────────────────────────

/**
 * Extract the feed string from window.environment.props.feed in the HTML.
 * @param {string} html
 * @returns {string|null}
 */
function extractFeedString(html) {
  // "feed":"SE÷Match¬~..." — capture including escaped chars
  const m = html.match(/"feed"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/);
  if (!m) return null;
  // Unescape JSON-encoded slashes (flashscore uses \/ for /)
  return m[1].replace(/\\\//g, '/');
}

/**
 * Parse a flashscore feed string into sections.
 * Feed format: SE÷{period}¬~SF÷{category}¬~SD÷{id}¬SG÷{label}¬SH÷{home}¬SI÷{away}¬~
 *
 * ¬ = U+00AC (NOT SIGN), ÷ = U+00F7 (DIVISION SIGN)
 *
 * @param {string} feed
 * @returns {{ [period: string]: Array<{ label: string, home: string, away: string }> }}
 */
function parseFeedString(feed) {
  const sections = {};
  let currentSection = 'Match';
  const seenIds = {};      // dedup per section by SD id

  const entries = feed.split('\u00AC~'); // ¬~
  for (const entry of entries) {
    if (!entry) continue;
    const parts = entry.split('\u00AC'); // ¬
    const fields = {};
    for (const part of parts) {
      const divIdx = part.indexOf('\u00F7'); // ÷
      if (divIdx === 2) {
        fields[part.slice(0, 2)] = part.slice(3);
      }
    }

    if (fields['SE']) {
      currentSection = fields['SE'];
      if (!sections[currentSection]) sections[currentSection] = [];
      if (!seenIds[currentSection]) seenIds[currentSection] = new Set();
      continue;
    }

    // Skip category separators (SF only, no SG)
    if (!fields['SG']) continue;

    const id = fields['SD'] || fields['SG'];
    if (!sections[currentSection]) sections[currentSection] = [];
    if (!seenIds[currentSection]) seenIds[currentSection] = new Set();

    // Deduplicate by stat ID within the same section
    if (!seenIds[currentSection].has(id)) {
      seenIds[currentSection].add(id);
      sections[currentSection].push({
        label: fields['SG'],
        home:  fields['SH'] || '',
        away:  fields['SI'] || '',
      });
    }
  }

  return sections;
}

// ─── DOM fallback ─────────────────────────────────────────────────────────────

/**
 * Parse stat rows from HTML DOM using stable data-testid attributes.
 * Returns raw rows without period separation (DOM shows current stats only).
 *
 * @param {CheerioStatic} $
 * @returns {Array<{ label: string, home: string, away: string }>}
 */
function parseStatsDomFallback($) {
  const rows = [];
  $('[data-testid="wcl-statistics"]').each((_, el) => {
    const $el = $(el);
    const values = $el.find('[data-testid="wcl-statistics-value"]');
    const label = $el.find('[data-testid="wcl-statistics-category"]').text().trim();
    if (values.length >= 2 && label) {
      rows.push({
        label,
        home: $(values[0]).text().trim(),
        away: $(values[1]).text().trim(),
      });
    }
  });
  return rows;
}

// ─── Row → StatsTeam object ───────────────────────────────────────────────────

/**
 * Convert an array of raw rows into home/away StatsTeam objects.
 *
 * @param {Array<{ label, home, away }>} rows
 * @returns {{ home: Object, away: Object, rawRows: Array }}
 */
function rowsToTeamStats(rows) {
  const home = {};
  const away = {};
  const rawRows = [];

  for (const row of rows) {
    const key = mapStatsLabel(row.label);
    if (!key) continue;
    rawRows.push({ label: row.label, home: row.home, away: row.away });
    applyStatsValue(home, key, row.home);
    applyStatsValue(away, key, row.away);
  }

  return { home, away, rawRows };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Parse the stats page HTML into structured statistics.
 *
 * Strategy:
 *  1. Extract window.environment.props.feed → period-aware parsing
 *     - only uses "1st Half" section; returns null if section is absent
 *     - does NOT fall back to "Match" (would contaminate baseline with cumulative stats)
 *  2. If no feed → DOM fallback (works for halftime, not for finished matches)
 *
 * @param {string} html
 * @param {string} capturedAtStatus  e.g. "Half Time"
 * @returns {{
 *   statsLevel: 'detailed'|'basic',
 *   capturedAtStatus: string,
 *   baseline1HCapturedAtStatus: string,
 *   '1half': { home: Object, away: Object, overall: Object },
 *   rawRows: Array
 * }|null}
 */
function parseMatchStats(html, capturedAtStatus = '') {
  const feed = extractFeedString(html);

  let rawRows;
  if (feed) {
    const sections = parseFeedString(feed);
    // Only use "1st Half" section — never fall back to "Match".
    // "Match" is cumulative (1H + elapsed 2H) and would corrupt the baseline
    // if enrichment ran even a few minutes into the second half.
    // If "1st Half" is absent from the feed, return null so the caller can
    // discard this enrichment rather than store a contaminated baseline.
    if (!sections['1st Half']) return null;
    rawRows = sections['1st Half'];
  } else {
    // DOM fallback is only safe at halftime — the DOM shows whatever is currently
    // visible (1H stats during HT, cumulative stats during 2H).  If the match is
    // NOT at halftime, we can't trust the DOM as a pure 1H baseline, so return null.
    const status = capturedAtStatus.toLowerCase();
    const isHalftime = status.includes('half') || status.includes('45+') || status.includes('ht');
    if (!isHalftime) return null;

    const $ = cheerio.load(html);
    rawRows = parseStatsDomFallback($);
  }

  if (!rawRows.length) return null;

  const { home, away, rawRows: mappedRows } = rowsToTeamStats(rawRows);
  const overall = computeOverall(home, away);
  const statsLevel = detectStatsLevel(home);

  // statsLevel lives at enrichment-item level; not duplicated inside statistics
  return {
    _statsLevel: statsLevel,
    capturedAtStatus,
    baseline1HCapturedAtStatus: capturedAtStatus,
    '1half': { home, away, overall },
    rawRows: mappedRows,
  };
}

/**
 * Parse cumulative (whole-match) stats from a live or finished stats page.
 *
 * Used by Stage 3 snapshot collector — always reads the "Match" feed section
 * which represents cumulative stats from kick-off (1H + elapsed 2H time).
 * Falls back to DOM if no feed available.
 *
 * @param {string} html
 * @returns {{ home: Object, away: Object, statsLevel: 'detailed'|'basic' }|null}
 */
function parseCumulativeStats(html) {
  const feed = extractFeedString(html);

  let rawRows;
  if (feed) {
    const sections = parseFeedString(feed);
    // "Match" = full cumulative; "2nd Half" exists separately when feed splits by period.
    // We want the whole-match cumulative so we prefer "Match", then try "2nd Half"
    // (which on flashscore.mobi represents running 2H snapshot, not the full match).
    // Always prefer "Match" for correctness.
    rawRows = sections['Match'] || sections['1st Half'] || [];
  } else {
    const $ = cheerio.load(html);
    rawRows = parseStatsDomFallback($);
  }

  if (!rawRows.length) return null;

  const { home, away } = rowsToTeamStats(rawRows);
  const statsLevel = detectStatsLevel(home);

  return { home, away, statsLevel };
}

module.exports = {
  parseMatchStats,
  parseCumulativeStats,
  extractFeedString,
  parseFeedString,
  parseStatsDomFallback,
};
