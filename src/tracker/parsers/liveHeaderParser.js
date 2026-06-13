'use strict';

const cheerio = require('cheerio');
const { parseMinute } = require('../../parser/minuteUtils');
const { parseScorePair } = require('../../parser/scoreUtils');

/**
 * Parse the #main block from a flashscore.mobi match page.
 *
 * Expected HTML structure:
 *   <div id="main" class="soccer">
 *     ...
 *     <h3>Team1 - Team2</h3>
 *     <div class="detail"><b>0:1</b>  (0:0,0:1)</div>   ← score
 *     <div class="detail">Finished</div>                 ← status
 *     <div class="detail">05.05.2026 13:35</div>
 *     ...
 *   </div>
 *
 * During live match the status div contains "67'" / "2nd Half" / "Half Time" / "45+'" etc.
 *
 * @param {string} html
 * @returns {{
 *   scoreHome: number,
 *   scoreAway: number,
 *   minute: number|null,
 *   statusText: string,
 *   isFinished: boolean,
 *   isHalftime: boolean,
 *   isSecondHalf: boolean,
 *   isFirstHalfStoppage: boolean,
 *   htScore: {home:number, away:number}|null,
 * }}
 */
function parseLiveHeader(html) {
  const $ = cheerio.load(html);

  // ── Score from first .detail containing <b> ────────────────────────────────
  let scoreHome = 0;
  let scoreAway = 0;
  let htScore = null;

  const scoreDetail = $('#main .detail').filter((_, el) => $(el).find('b').length > 0).first();
  if (scoreDetail.length) {
    const scoreText = scoreDetail.find('b').first().text().trim(); // "0:1" or "0-1"
    const pair = parseScorePair(scoreText);
    if (pair) {
      scoreHome = pair.home;
      scoreAway = pair.away;
    }

    // Halftime score appears in parentheses, e.g. "0:1  (0:0,0:1)" → HT = 0:0.
    // First pair inside parens is the HT score (Flashscore convention).
    const fullText = scoreDetail.text();
    const m = fullText.match(/\((\d+)\s*[:\-]\s*(\d+)/);
    if (m) htScore = { home: Number(m[1]), away: Number(m[2]) };
  }

  // ── Status text from the second .detail (no <b>, no date pattern) ──────────
  // Find the first .detail that has no child elements (plain text only)
  // and doesn't look like a date (dd.mm.yyyy)
  let statusText = '';
  $('#main .detail').each((_, el) => {
    const $el = $(el);
    if ($el.find('b').length > 0) return; // skip score div
    const text = $el.text().trim();
    if (!text) return;
    if (/^\d{2}\.\d{2}\.\d{4}/.test(text)) return; // skip date
    statusText = text;
    return false; // break
  });

  const isFinished  = /^finished$/i.test(statusText);
  // True break only — explicit HT words. First-half stoppage ("45+1'") is NOT
  // halftime: goals still possible until the whistle.
  const isHalftime  = /^(half[\s-]*time|ht|перерва)$/i.test(statusText);
  const isSecondHalf = /^(2nd\s+half|second\s+half)/i.test(statusText);
  const isFirstHalfStoppage = /^(1st\s+half\s*[-–]\s*)?45\+/i.test(statusText);

  // Parse numeric minute from status (e.g. "67'" → 67; "Finished" → null)
  const minute = isFinished ? null : parseMinute(statusText);

  return {
    scoreHome, scoreAway, minute, statusText,
    isFinished, isHalftime, isSecondHalf, isFirstHalfStoppage, htScore,
  };
}

module.exports = { parseLiveHeader };
