'use strict';

const cheerio = require('cheerio');

/**
 * Parse goal incidents from #detail-tab-content on a flashscore.mobi match summary page.
 *
 * Structure:
 *   <div id="detail-tab-content">
 *     <h4>1st Half: <b>0:0</b></h4>
 *     ...
 *     <h4>2nd Half: <b>0:1</b></h4>
 *     <div class="incident soccer">
 *       <p class="i-field time">63'</p>
 *       <p class="i-field icon ball">&nbsp;</p>
 *       Player Name [CHE]
 *     </div>
 *     <div class="incident soccer">
 *       <p class="i-field time-wide">90+4'</p>
 *       <p class="i-field icon ball">&nbsp;</p>
 *       Player Name [LIA]
 *     </div>
 *   </div>
 *
 * We only capture goals from the 2nd Half section.
 * Team is detected from [CODE] suffix in the incident text, matched against
 * the provided homeCode and awayCode. If matching fails we fall back to
 * incident position order (left = home in flashscore convention).
 *
 * @param {string} html
 * @param {string} [homeTeam]  Home team name (for code matching)
 * @param {string} [awayTeam]  Away team name (for code matching)
 * @returns {{
 *   firstHalfScore:  { home: number, away: number },
 *   secondHalfScore: { home: number, away: number },
 *   goals: Array<{
 *     minute: number,
 *     extraMinutes: number,
 *     team: 'home'|'away'|'unknown',
 *     isExtraTime: boolean,
 *   }>,
 * }}
 */
function parseIncidents(html, homeTeam = '', awayTeam = '') {
  const $ = cheerio.load(html);

  const result = {
    firstHalfScore:  { home: 0, away: 0 },
    secondHalfScore: { home: 0, away: 0 },
    goals: [],
  };

  const container = $('#detail-tab-content');
  if (!container.length) return result;

  // ── Parse half-time scores from <h4> headers ──────────────────────────────
  container.find('h4').each((_, el) => {
    const text = $(el).text().trim(); // "1st Half: 0:0" or "2nd Half: 0:1"
    const scoreMatch = text.match(/([\d]+):([\d]+)/);
    if (!scoreMatch) return;
    const h = parseInt(scoreMatch[1], 10);
    const a = parseInt(scoreMatch[2], 10);
    if (/^1st\s+half/i.test(text)) {
      result.firstHalfScore  = { home: h, away: a };
    } else if (/^2nd\s+half/i.test(text)) {
      result.secondHalfScore = { home: h, away: a };
    }
  });

  // ── Derive team code mapping from team names ─────────────────────────────
  // Flashscore appends short codes in brackets, e.g. [MIR] or [LDU].
  // We collect all unique codes from incidents and then match them against
  // the provided homeTeam/awayTeam names using substring/prefix matching.
  const allCodes = [];
  container.find('.incident.soccer').each((_, el) => {
    const text = $(el).text();
    const codeMatch = text.match(/\[([A-Z0-9]{2,6})\]/);
    if (codeMatch && !allCodes.includes(codeMatch[1])) {
      allCodes.push(codeMatch[1]);
    }
  });

  // Match codes to teams using case-insensitive prefix/substring heuristic
  const homeNorm = homeTeam.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const awayNorm = awayTeam.toUpperCase().replace(/[^A-Z0-9]/g, '');

  let homeCode = null;
  let awayCode = null;

  for (const code of allCodes) {
    if (!homeCode && (homeNorm.startsWith(code) || homeNorm.includes(code))) {
      homeCode = code;
    } else if (!awayCode && (awayNorm.startsWith(code) || awayNorm.includes(code))) {
      awayCode = code;
    }
  }
  // Second pass: if first loop missed one due to ordering
  if (!homeCode || !awayCode) {
    for (const code of allCodes) {
      if (code === homeCode || code === awayCode) continue;
      if (!awayCode && (awayNorm.startsWith(code) || awayNorm.includes(code))) {
        awayCode = code;
      } else if (!homeCode && (homeNorm.startsWith(code) || homeNorm.includes(code))) {
        homeCode = code;
      }
    }
  }

  function resolveTeam(code) {
    if (!code) return 'unknown';
    if (code === homeCode) return 'home';
    if (code === awayCode) return 'away';
    return 'unknown';
  }

  // ── Identify 2nd Half incidents ───────────────────────────────────────────
  // Structure can be either:
  //   #detail-tab-content > h4 > div.detail > div.incident.soccer  (nested)
  //   #detail-tab-content > h4 > div.incident.soccer              (flat)
  // We iterate ALL elements looking for h4 markers, then find incidents
  // that follow the 2nd Half h4 (at any nesting level).

  let secondHalfStarted = false;
  const allElements = container.find('*');

  allElements.each((_, el) => {
    const $el = $(el);
    const tag = el.tagName?.toLowerCase();

    if (tag === 'h4') {
      const text = $el.text().trim();
      secondHalfStarted = /^2nd\s+half/i.test(text);
      return;
    }

    if (!secondHalfStarted) return;

    if (tag === 'div' && $el.hasClass('incident') && $el.hasClass('soccer')) {
      // Only process goal events
      const isBall = $el.find('.i-field.icon.ball').length > 0 ||
                     $el.find('.icon.ball').length > 0;
      if (!isBall) return;

      // Time field — either .i-field.time or .i-field.time-wide (extra time)
      const isExtraTime = $el.find('.i-field.time-wide').length > 0;
      const timeText = isExtraTime
        ? $el.find('.i-field.time-wide').first().text().trim()
        : $el.find('.i-field.time').first().text().trim();

      // Parse minute and extra minutes from "63'" / "90+4'"
      let minute = 0;
      let extraMinutes = 0;
      const extraMatch = timeText.match(/^(\d{1,3})\+(\d{1,2})/);
      if (extraMatch) {
        minute       = parseInt(extraMatch[1], 10);
        extraMinutes = parseInt(extraMatch[2], 10);
      } else {
        const plainMatch = timeText.match(/^(\d{1,3})/);
        if (plainMatch) minute = parseInt(plainMatch[1], 10);
      }

      // Team code from text
      const incidentText = $el.text();
      const codeMatch = incidentText.match(/\[([A-Z0-9]{2,6})\]/);
      const team = resolveTeam(codeMatch ? codeMatch[1] : null);

      result.goals.push({ minute, extraMinutes, team, isExtraTime });
    }
  });

  return result;
}

module.exports = { parseIncidents };
