'use strict';

const { calculateDangerScore } = require('./calculateDangerScore');

/**
 * Classify tempo trend from two danger scores (later window vs earlier).
 * @param {number|null} earlier
 * @param {number|null} later
 * @returns {'falling'|'flat'|'growing'|'explosive'}
 */
function tempoTrendFromScores(earlier, later) {
  if (earlier == null || later == null || !Number.isFinite(earlier) || !Number.isFinite(later)) {
    return 'flat';
  }
  const d = later - earlier;
  if (d >= 3) return 'explosive';
  if (d >= 0.75) return 'growing';
  if (d <= -0.75) return 'falling';
  return 'flat';
}

/**
 * Attacking trend label for 45–60' comparison (two consecutive windows).
 */
function attackingTrendFromScores(earlier, later) {
  if (earlier == null || later == null || !Number.isFinite(earlier) || !Number.isFinite(later)) {
    return 'flat';
  }
  const d = later - earlier;
  if (d >= 1.5) return 'up';
  if (d <= -1.5) return 'down';
  return 'flat';
}

/**
 * Aggregate per-snapshot deltas with minute in (minExclusive, maxInclusive].
 *
 * @param {Array<{ minute?: number, delta?: object }>} snapshots
 * @param {number} minExclusive
 * @param {number} maxInclusive
 */
function aggregateDeltaRange(snapshots, minExclusive, maxInclusive) {
  const base = {
    shots: 0,
    shots_home: 0,
    shots_away: 0,
    shotsOnTarget: 0,
    shots_on_target_home: 0,
    shots_on_target_away: 0,
    corners: 0,
    xg: null,
    yellowCards: 0,
    redCards: 0,
  };

  for (const s of snapshots || []) {
    const m = s.minute;
    if (m == null || m <= minExclusive || m > maxInclusive) continue;
    const d = s.delta;
    const ts = d?.totalShots;
    const sot = d?.shotsOnTarget;
    const ck = d?.cornerKicks;
    const xg = d?.expectedGoalsXg;
    const y = d?.yellowCards;
    const r = d?.redCards;

    if (ts) {
      const h = ts.home || 0;
      const a = ts.away || 0;
      base.shots_home += h;
      base.shots_away += a;
      base.shots += h + a;
    }
    if (sot) {
      base.shots_on_target_home += sot.home || 0;
      base.shots_on_target_away += sot.away || 0;
      base.shotsOnTarget += (sot.home || 0) + (sot.away || 0);
    }
    if (ck) base.corners += (ck.home || 0) + (ck.away || 0);
    if (y) base.yellowCards += (y.home || 0) + (y.away || 0);
    if (r) base.redCards += (r.home || 0) + (r.away || 0);
    if (xg?.home != null && xg?.away != null) {
      base.xg = (base.xg || 0) + xg.home + xg.away;
    }
  }

  return base;
}

function dangerFromAggregate(agg) {
  const xg = agg.xg != null ? agg.xg : null;
  return calculateDangerScore({
    shots: agg.shots,
    shotsOnTarget: agg.shotsOnTarget,
    corners: agg.corners,
    xg,
    yellowCards: agg.yellowCards,
    redCards: agg.redCards,
  });
}

/**
 * Trend hints for Decision 60 (50–55 vs 55–60 danger).
 *
 * @param {Array<{ minute?: number, delta?: object }>} snapshots
 * @returns {{
 *   delta_45_60: object,
 *   danger_50_55: number|null,
 *   danger_55_60: number|null,
 *   tempo_trend_hint: string,
 *   attacking_trend_hint: string,
 * }}
 */
function computeTrendHints45to60(snapshots) {
  const agg5055 = aggregateDeltaRange(snapshots, 50, 55);
  const agg5560 = aggregateDeltaRange(snapshots, 55, 60);
  const agg4560 = aggregateDeltaRange(snapshots, 45, 60);

  const d5055 = dangerFromAggregate(agg5055);
  const d5560 = dangerFromAggregate(agg5560);

  return {
    delta_45_60: {
      shots: agg4560.shots,
      shots_home: agg4560.shots_home,
      shots_away: agg4560.shots_away,
      shots_on_target: agg4560.shotsOnTarget,
      corners: agg4560.corners,
      xg: agg4560.xg,
      yellow_cards: agg4560.yellowCards,
      red_cards: agg4560.redCards,
      danger_score: Math.round(dangerFromAggregate(agg4560) * 1000) / 1000,
      missing_xg_window: agg4560.xg == null,
    },
    danger_50_55: Math.round(d5055 * 1000) / 1000,
    danger_55_60: Math.round(d5560 * 1000) / 1000,
    tempo_trend_hint: tempoTrendFromScores(d5055, d5560),
    attacking_trend_hint: attackingTrendFromScores(d5055, d5560),
    pressure_direction_hint_45_60: pressureDirectionFromAggTotals(agg4560),
  };
}

/**
 * Pressure direction from aggregated shot split in a window.
 */
function pressureDirectionFromAggTotals(agg) {
  if (!agg || agg.shots === 0) return 'none';
  const dh = (agg.shots_home || 0) - (agg.shots_away || 0);
  const ratio = dh / Math.max(agg.shots, 1);
  if (ratio > 0.28) return 'home';
  if (ratio < -0.28) return 'away';
  if (agg.shots >= 3) return 'both';
  return 'none';
}

module.exports = {
  aggregateDeltaRange,
  tempoTrendFromScores,
  attackingTrendFromScores,
  computeTrendHints45to60,
  dangerFromAggregate,
  pressureDirectionFromAggTotals,
};
