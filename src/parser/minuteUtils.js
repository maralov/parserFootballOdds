'use strict';

// Apostrophe variants: ', ’, ′ (prime U+2032)
const APOST = /['’′]/;

/**
 * Parse a Flashscore status string into a synthetic minute number.
 *
 * Examples:
 *   "33'"             → 33
 *   "45+'"            → 46   (45 + at least 1 extra)
 *   "45+2'"           → 47
 *   "90+3'"           → 93
 *   "1st Half - 23'"  → 23
 *   "1st Half - 45+2'"→ 47   (compensated time inside the half-dash form)
 *   "halftime"        → 45
 *   "Half Time"       → 45
 *   "ht"              → 45
 *   "перерва"         → 45
 *   "1st half"        → null (ordinal word is not a minute)
 *   ""                → null
 *   "abc"             → null
 *
 * @param {string} statusText
 * @returns {number|null}
 */
function parseMinute(statusText) {
  if (!statusText) return null;
  const s = String(statusText).trim().toLowerCase();
  if (!s) return null;

  if (/^(half[\s-]*time|ht|перерва)$/.test(s)) return 45;

  // "1st Half - 45+2'" / "2nd Half - 71'" — strip the ordinal+half prefix and
  // parse the remainder, so a leading ordinal digit ("1" from "1st") never
  // leaks into the minute, and compensated time after the dash is respected.
  const halfPrefix = s.match(/^\d+(?:st|nd|rd|th)\s+half\s*[-–]\s*(.+)$/);
  const core = halfPrefix ? halfPrefix[1].trim() : s;

  // N+M' — explicit extra time count
  const extraExplicit = core.match(/^(\d{1,3})\+(\d{1,2})/);
  if (extraExplicit) {
    const v = Number(extraExplicit[1]) + Number(extraExplicit[2]);
    return v <= 130 ? v : null;
  }

  // N+' — plus sign present but no digit after (e.g. "45+'", "90+'")
  const extraImplicit = core.match(/^(\d{1,3})\+/);
  if (extraImplicit) {
    return Number(extraImplicit[1]) + 1;
  }

  // N' — plain minute. Require an apostrophe or end-of-string right after the
  // digits so an ordinal like "1st" is never mistaken for minute "1".
  const plain = core.match(/^(\d{1,3})\s*(?:['’′]|$)/);
  if (plain) {
    const v = Number(plain[1]);
    return v <= 130 ? v : null;
  }

  return null;
}

/**
 * Returns true when the status indicates the match is at or entering half-time.
 * Matches: "halftime", "Half Time", "ht", "перерва", "45+'", "45+2'", etc.
 *
 * @param {string} statusText
 * @returns {boolean}
 */
function isHalftimeStatus(statusText) {
  if (!statusText) return false;
  const s = String(statusText).trim().toLowerCase();
  return (
    /^(half[\s-]*time|ht|перерва)$/.test(s) ||
    /^45\+/.test(s)
  );
}

module.exports = { parseMinute, isHalftimeStatus };
