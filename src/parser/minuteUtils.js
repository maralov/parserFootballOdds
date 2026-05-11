'use strict';

// Apostrophe variants: ', ', ′ (prime U+2032)
const APOST = /['\u2019\u2032]/;

/**
 * Parse a Flashscore status string into a synthetic minute number.
 *
 * Examples:
 *   "33'"      → 33
 *   "45+'"     → 46   (45 + at least 1 extra)
 *   "45+2'"    → 47
 *   "90+3'"    → 93
 *   "halftime" → 45
 *   "Half Time"→ 45
 *   "ht"       → 45
 *   "перерва"  → 45
 *   ""         → null
 *   "abc"      → null
 *
 * @param {string} statusText
 * @returns {number|null}
 */
function parseMinute(statusText) {
  if (!statusText) return null;
  const s = String(statusText).trim().toLowerCase();
  if (!s) return null;

  if (/^(half[\s-]*time|ht|перерва)$/.test(s)) return 45;

  // N+M' — explicit extra time count
  const extraExplicit = s.match(/^(\d{1,3})\+(\d{1,2})/);
  if (extraExplicit) {
    const v = Number(extraExplicit[1]) + Number(extraExplicit[2]);
    return v <= 130 ? v : null;
  }

  // N+' — plus sign present but no digit after (e.g. "45+'", "90+'")
  const extraImplicit = s.match(/^(\d{1,3})\+/);
  if (extraImplicit) {
    return Number(extraImplicit[1]) + 1;
  }

  // "1st Half - 23'" / "2nd Half - 71'" — do not use leading "2" from "2nd"
  const halfDash = s.match(
    /\d+(?:st|nd|rd|th)\s+half\s*[-–]\s*(\d{1,3})\s*['\u2032]/,
  );
  if (halfDash) {
    const v = Number(halfDash[1]);
    return v <= 130 ? v : null;
  }

  // N' — plain minute
  const plain = s.match(/^(\d{1,3})/);
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
