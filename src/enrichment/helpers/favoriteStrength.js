'use strict';

function clamp(val, min = 0, max = 1) {
  return Math.max(min, Math.min(max, val));
}

function avg(...vals) {
  const nums = vals.filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Compute a composite favorite-strength score from standings data.
 *
 * @param {{ position, mp, w, d, l, gf, ga, gd, pts }} home
 * @param {{ position, mp, w, d, l, gf, ga, gd, pts }} away
 * @param {number} totalTeams
 * @returns {{
 *   label: 'strong'|'slight'|'balanced',
 *   score: number,
 *   favorite: 'home'|'away'|null,
 *   components: { positionScore, pointsScore, goalDiffScore, winRateScore }
 * }}
 */
function computeFavoriteStrength(home, away, totalTeams) {
  if (!home || !away || !totalTeams) {
    return { label: 'balanced', score: 0, favorite: null, components: {} };
  }

  // Position score: bigger positional gap → stronger favorite
  const positionDiff = Math.abs(home.position - away.position);
  const positionScore = clamp(positionDiff / totalTeams);

  // Points score: normalized by max possible gap (3pts/game × mp)
  const mp = Math.max(home.mp, away.mp, 1);
  const pointsDiff = Math.abs((home.pts || 0) - (away.pts || 0));
  const pointsScore = clamp(pointsDiff / (3 * mp));

  // Goal difference score: |GD gap| normalized by league size × 2
  const gdDiff = Math.abs((home.gd || 0) - (away.gd || 0));
  const goalDiffScore = clamp(gdDiff / (totalTeams * 2));

  // Win rate score: |winRate home − winRate away|
  const winRateHome = home.mp > 0 ? home.w / home.mp : 0;
  const winRateAway = away.mp > 0 ? away.w / away.mp : 0;
  const winRateScore = Math.abs(winRateHome - winRateAway);

  const score = Math.round(avg(positionScore, pointsScore, goalDiffScore, winRateScore) * 100) / 100;

  const label = score >= 0.6 ? 'strong' : score >= 0.3 ? 'slight' : 'balanced';

  // Determine which team is the favorite
  // Per-team "strength index": better position + more pts + better GD + higher win rate
  const homeStrength = (totalTeams - home.position + 1) / totalTeams
    + clamp((home.pts || 0) / (3 * mp))
    + clamp(((home.gd || 0) + totalTeams * 2) / (totalTeams * 4))
    + winRateHome;

  const awayStrength = (totalTeams - away.position + 1) / totalTeams
    + clamp((away.pts || 0) / (3 * mp))
    + clamp(((away.gd || 0) + totalTeams * 2) / (totalTeams * 4))
    + winRateAway;

  let favorite = null;
  if (homeStrength - awayStrength >= 0.05) favorite = 'home';
  else if (awayStrength - homeStrength >= 0.05) favorite = 'away';

  return {
    label,
    score,
    favorite,
    components: {
      positionScore: Math.round(positionScore * 100) / 100,
      pointsScore:   Math.round(pointsScore * 100) / 100,
      goalDiffScore: Math.round(goalDiffScore * 100) / 100,
      winRateScore:  Math.round(winRateScore * 100) / 100,
    },
  };
}

module.exports = { computeFavoriteStrength };
