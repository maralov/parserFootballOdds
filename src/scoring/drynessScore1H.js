'use strict';

// First-half dryness score (1HUNDER).
//
// Thesis: a clear pre-match favorite who is NOT creating chances early (~25')
// is unlikely to break through before halftime. So the score is FAVORITE-aware:
// it rewards low favorite xG / shots / box presence, plus low overall tempo.
//
// Operates on `snapshot.cumulative` (= since kick-off in the first half, because
// the first-half baseline is zero). Each scorer returns 0..100 or null when the
// underlying stat is missing; the final score normalizes by used weight.

const { drynessBias1HFor } = require('./leagueBias');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sumSide(pair) {
  if (!pair) return null;
  const h = pair.home;
  const a = pair.away;
  if (h == null && a == null) return null;
  return (h || 0) + (a || 0);
}

/** Identify the favorite side from pre-match odds. Returns 'home' | 'away' | null. */
function favoriteSide(match) {
  const fav = match?.odds?.isOddsFavorite?.favorite;
  return fav === 'home' || fav === 'away' ? fav : null;
}

function favVal(snapshot, field, side) {
  if (!side) return null;
  const pair = snapshot?.cumulative?.[field];
  if (!pair) return null;
  const v = pair[side];
  return v == null ? null : v;
}

// ── Favorite-suppression scorers ──────────────────────────────────────────────
function dryFromFavXg(snapshot, side) {
  const xg = favVal(snapshot, 'expectedGoalsXg', side);
  if (xg == null) return null;
  return 100 * (1 - clamp(xg / 0.5, 0, 1));
}

function dryFromFavSot(snapshot, side) {
  const sot = favVal(snapshot, 'shotsOnTarget', side);
  if (sot == null) return null;
  return 100 * (1 - clamp(sot / 2.5, 0, 1));
}

function dryFromFavTouches(snapshot, side) {
  const t = favVal(snapshot, 'touchesInOppositionBox', side);
  if (t == null) return null;
  return 100 * (1 - clamp(t / 12, 0, 1));
}

// ── Match-level scorers ───────────────────────────────────────────────────────
function dryFromTotalTempo(snapshot) {
  const xg = sumSide(snapshot?.cumulative?.expectedGoalsXg);
  if (xg == null) return null;
  return 100 * (1 - clamp(xg / 0.8, 0, 1));
}

function dryFromBigChances(snapshot) {
  const big = sumSide(snapshot?.cumulative?.bigChances);
  if (big == null) return null;
  return 100 * (1 - clamp(big / 2, 0, 1));
}

function dryFromCards(snapshot) {
  const y = sumSide(snapshot?.cumulative?.yellowCards);
  const r = sumSide(snapshot?.cumulative?.redCards);
  if (y == null && r == null) return null;
  const total = (y || 0) * 15 + (r || 0) * 40;
  return Math.max(0, 100 - total);
}

function dryFromPossessionBalance(snapshot) {
  const home = snapshot?.ballPossession?.home;
  if (home == null) return null;
  return clamp(100 - Math.abs(50 - home) * 2, 0, 100);
}

const COMPONENTS = [
  { key: 'fav_xg_suppressed',     weight: 25, fn: (s, side) => dryFromFavXg(s, side) },
  { key: 'fav_shots_suppressed',  weight: 20, fn: (s, side) => dryFromFavSot(s, side) },
  { key: 'fav_touches_box',       weight: 15, fn: (s, side) => dryFromFavTouches(s, side) },
  { key: 'total_tempo',           weight: 15, fn: (s) => dryFromTotalTempo(s) },
  { key: 'big_chances',           weight: 10, fn: (s) => dryFromBigChances(s) },
  { key: 'calm_cards',            weight:  5, fn: (s) => dryFromCards(s) },
  { key: 'possession_bal',        weight:  5, fn: (s) => dryFromPossessionBalance(s) },
];

const LEAGUE_BIAS_WEIGHT = 5;

/**
 * Compute first-half Dryness Score (~20–35').
 * @param {Object} match     match record (needs odds.isOddsFavorite)
 * @param {Object} snapshot  live snapshot with `cumulative` + `ballPossession`
 * @returns {{ score: number|null, components: Object, favorite: string|null, weightUsed: number }}
 */
function computeDS1H(match, snapshot) {
  const side = favoriteSide(match);
  const components = {};
  let weightedSum = 0;
  let weightUsed = 0;

  for (const c of COMPONENTS) {
    const value = c.fn(snapshot, side);
    components[c.key] = value;
    if (value != null) {
      weightedSum += value * c.weight;
      weightUsed += c.weight;
    }
  }

  const leagueBias = drynessBias1HFor(match);
  components.league_bias_1h = leagueBias;
  weightedSum += leagueBias * LEAGUE_BIAS_WEIGHT;
  weightUsed += LEAGUE_BIAS_WEIGHT;

  const score = weightUsed > 0 ? Math.round(weightedSum / weightUsed) : null;

  return { score, components, favorite: side, weightUsed };
}

module.exports = { computeDS1H, COMPONENTS, favoriteSide };
