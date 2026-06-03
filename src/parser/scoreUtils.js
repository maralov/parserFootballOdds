'use strict';

/** Colon, hyphen-minus, en-dash, minus sign — Flashscore uses `-` on mobi/ua locales. */
const SCORE_SEP = /[:\-\u2013\u2212]/;

/**
 * Normalize a score string to canonical "H:A" (e.g. "3-0" → "3:0").
 * Returns the original string if it does not look like a two-part score.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeScoreString(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';

  const parts = s.split(SCORE_SEP);
  if (parts.length !== 2) return s;

  const home = parts[0].trim();
  const away = parts[1].trim();
  if (!/^\d+$/.test(home) || !/^\d+$/.test(away)) return s;

  return `${home}:${away}`;
}

/**
 * @param {string} raw
 * @returns {{ home: number, away: number }|null}
 */
function parseScorePair(raw) {
  const normalized = normalizeScoreString(raw);
  const parts = normalized.split(':');
  if (parts.length !== 2) return null;

  const home = parseInt(parts[0], 10);
  const away = parseInt(parts[1], 10);
  if (Number.isNaN(home) || Number.isNaN(away)) return null;

  return { home, away };
}

module.exports = { normalizeScoreString, parseScorePair, SCORE_SEP };
