'use strict';

/**
 * @param {{
 *   shots?: number,
 *   shotsOnTarget?: number,
 *   corners?: number,
 *   xg?: number|null,
 *   yellowCards?: number,
 *   redCards?: number,
 * }} stats — totals (both teams). Omit xg when unknown.
 * @returns {number}
 */
function calculateDangerScore(stats) {
  const shots = Number(stats.shots) || 0;
  const shotsOnTarget = Number(stats.shotsOnTarget) || 0;
  const corners = Number(stats.corners) || 0;
  const yellowCards = Number(stats.yellowCards) || 0;
  const redCards = Number(stats.redCards) || 0;

  let xgTerm = 0;
  if (stats.xg != null && Number.isFinite(Number(stats.xg))) {
    xgTerm = Number(stats.xg) * 10;
  }

  return (
    shots * 1
    + shotsOnTarget * 3
    + corners * 1.2
    + xgTerm
    + yellowCards * 0.3
    + redCards * 2
  );
}

module.exports = { calculateDangerScore };
