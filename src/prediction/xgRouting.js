'use strict';

/**
 * routeByXg - Route prediction direction based on live cumulative xG
 * Pure function with no side effects.
 *
 * @param {number|null|undefined} liveXg - Cumulative xG for both teams
 * @param {Object} cfg - Configuration object
 * @param {number} [cfg.LIVE_1H_XG_UNDER_MAX=0.15] - Upper threshold for 'under' route
 * @param {number} [cfg.LIVE_1H_XG_OVER_MAX=0.50] - Upper threshold for 'over' route
 * @returns {'under' | 'over' | 'skip'} Routing decision
 */
function routeByXg(liveXg, cfg = {}) {
  const LIVE_1H_XG_UNDER_MAX = cfg.LIVE_1H_XG_UNDER_MAX ?? 0.15;
  const LIVE_1H_XG_OVER_MAX = cfg.LIVE_1H_XG_OVER_MAX ?? 0.50;

  if (liveXg == null) {
    return 'skip';
  }

  if (liveXg <= LIVE_1H_XG_UNDER_MAX) {
    return 'under';
  }

  if (liveXg <= LIVE_1H_XG_OVER_MAX) {
    return 'over';
  }

  return 'skip';
}

module.exports = { routeByXg };
