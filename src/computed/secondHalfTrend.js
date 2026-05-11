'use strict';

/**
 * Rough tempo comparison mid- vs early- second half snapshots.
 *
 * @param {{
 *   window45_60?: { totals?: Record<string, *> }|null,
 *   window60_70?: { totals?: Record<string, *> }|null,
 * }} windows
 */
function buildSecondHalfTrend(windows) {
  const mid = windows?.window45_60?.totals;
  const lat = windows?.window60_70?.totals;
  if (!mid && !lat) return null;
  const sMid = mid?.totalShots ?? 0;
  const sLat = lat?.totalShots ?? 0;
  const xMid = mid?.xg ?? null;
  const xLat = lat?.xg ?? null;

  let tempo = 'flat';
  if (sLat > sMid + 2) tempo = 'up';
  else if (sLat + 2 < sMid && sMid > 0) tempo = 'down';

  let chanceTempo = 'flat';
  if (xMid != null && xLat != null) {
    if (xLat > xMid + 0.06) chanceTempo = 'up';
    else if (xLat + 0.06 < xMid) chanceTempo = 'down';
  }

  return { shotsTempoVsMid: tempo, chanceTempo, shotsMidSegment: sMid, shotsLateSegment: sLat };
}

module.exports = { buildSecondHalfTrend };
