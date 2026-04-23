/**
 * Сегмент між сусідніми зрізами та порівняння з середнім темпом 2H.
 * Прирости нормалізуються на фактичні Δхв між зрізами; для порівняння з «кроком» моделі
 * використовується LIVE_SEGMENT_STEP_MINUTES (опційно).
 */

const { PRESSURE_KEYS, WEIGHTS } = require('./dominanceMetrics');

function minutesIntoSecondHalf(matchMinute) {
  const m = Number(matchMinute);
  if (!Number.isFinite(m)) return 1;
  return Math.max(1, m - 45);
}

function weightedSegmentIntensity(rawDelta, deltaMinutes) {
  if (!rawDelta || !deltaMinutes || deltaMinutes < 1) return null;
  let s = 0;
  let w = 0;
  for (const key of PRESSURE_KEYS) {
    const d = rawDelta[key];
    if (d == null || !Number.isFinite(d)) continue;
    const wi = WEIGHTS[key] || 0;
    s += (d / deltaMinutes) * wi;
    w += wi;
  }
  return w > 0 ? s / w : null;
}

function weightedCumulativePerMinute(rawCum, matchMinute) {
  if (!rawCum) return null;
  const min2h = minutesIntoSecondHalf(matchMinute);
  let s = 0;
  let w = 0;
  for (const key of PRESSURE_KEYS) {
    const v = rawCum[key];
    if (v == null || !Number.isFinite(v)) continue;
    const wi = WEIGHTS[key] || 0;
    s += (v / min2h) * wi;
    w += wi;
  }
  return w > 0 ? s / w : null;
}

/**
 * Тренд за останні до 3 інтервалів: знак приросту xG + SOT.
 * @param {Array<{ matchMinute: number, raw2H: Record<string, number|null> }>} history
 */
function trendOverRecentIntervals(history) {
  if (!history || history.length < 2) return 'flat';
  const n = history.length;
  const take = Math.min(3, n - 1);
  let score = 0;
  for (let i = n - take; i < n; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    const dm = cur.matchMinute - prev.matchMinute;
    if (dm < 1) continue;
    const dxg = (cur.raw2H.expectedGoalsXg ?? 0) - (prev.raw2H.expectedGoalsXg ?? 0);
    const dsot = (cur.raw2H.shotsOnTarget ?? 0) - (prev.raw2H.shotsOnTarget ?? 0);
    const step = (dxg > 0.08 ? 1 : dxg < -0.08 ? -1 : 0) + (dsot > 0 ? 1 : dsot < 0 ? -1 : 0);
    score += step;
  }
  if (score >= 2) return 'up';
  if (score <= -2) return 'down';
  return 'flat';
}

/**
 * @param {Array<{ matchMinute: number, raw2H: Record<string, number|null> }>} history — хронологічно, останній = поточний
 * @param {number} segmentStepMinutes — для поля normalizedSegmentIntensity (× step/Δхв)
 */
function computeSegmentFeatures(history, segmentStepMinutes = 5) {
  if (!history || history.length === 0) return null;

  const cur = history[history.length - 1];
  const m = cur.matchMinute;
  const min2h = minutesIntoSecondHalf(m);

  const cumPerMin = weightedCumulativePerMinute(cur.raw2H, m);

  let prev = null;
  let deltaM = null;
  let rawDelta = null;
  if (history.length >= 2) {
    prev = history[history.length - 2];
    deltaM = Math.max(1, cur.matchMinute - prev.matchMinute);
    rawDelta = {};
    for (const key of PRESSURE_KEYS) {
      const a = prev.raw2H[key];
      const b = cur.raw2H[key];
      if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) {
        rawDelta[key] = Number((b - a).toFixed(6));
      } else {
        rawDelta[key] = null;
      }
    }
  }

  const segPerMin = rawDelta && deltaM ? weightedSegmentIntensity(rawDelta, deltaM) : null;
  const normalizedSegmentIntensity =
    segPerMin != null && deltaM && segmentStepMinutes
      ? Number((segPerMin * (segmentStepMinutes / deltaM)).toFixed(6))
      : null;

  let vsSecondHalfRatio = null;
  if (segPerMin != null && cumPerMin != null && cumPerMin > 1e-6) {
    vsSecondHalfRatio = Number((segPerMin / cumPerMin).toFixed(4));
  }

  const trendDirection = trendOverRecentIntervals(history);

  let comparisonLabel = 'unknown';
  if (vsSecondHalfRatio != null) {
    if (vsSecondHalfRatio >= 1.2) comparisonLabel = 'stronger_than_2h_avg';
    else if (vsSecondHalfRatio <= 0.82) comparisonLabel = 'weaker_than_2h_avg';
    else if (vsSecondHalfRatio > 1.05) comparisonLabel = 'slightly_stronger';
    else if (vsSecondHalfRatio < 0.95) comparisonLabel = 'slightly_weaker';
    else comparisonLabel = 'in_line_with_2h';
  }

  return {
    currentMinute: m,
    minutesIntoSecondHalf: min2h,
    segmentDeltaMinutes: deltaM,
    cumulativePerMinute2H: cumPerMin,
    segmentPerMinute: segPerMin,
    normalizedSegmentIntensity,
    vsSecondHalfRatio,
    comparisonLabel,
    trendDirection,
    rawDeltaLastInterval: rawDelta,
  };
}

/**
 * Аналізує всі зрізи з warmup-фази (52+) і класифікує послідовність активності.
 * Кожен інтервал між сусідніми зрізами вважається QUIET (dxg<=0.08 і dsot<=0)
 * або ACTIVE (хоча б один із показників зріс).
 *
 * @param {Array<{ matchMinute: number, raw2H: Record<string,number|null> }>} history
 * @returns {{ label: 'consistently_dry'|'mixed'|'heating_up', dryRatio: number,
 *             totalIntervals: number, quietIntervals: number, activeIntervals: number }|null}
 */
function computeActivityConsistency(history) {
  if (!history || history.length < 3) return null;
  let quiet = 0;
  let active = 0;
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur  = history[i];
    const dxg  = (cur.raw2H?.expectedGoalsXg  ?? 0) - (prev.raw2H?.expectedGoalsXg  ?? 0);
    const dsot = (cur.raw2H?.shotsOnTarget ?? 0) - (prev.raw2H?.shotsOnTarget ?? 0);
    const score = (dxg > 0.08 ? 1 : 0) + (dsot > 0 ? 1 : 0);
    if (score === 0) quiet++; else active++;
  }
  const total    = quiet + active;
  const dryRatio = Number((quiet / total).toFixed(3));
  const label    = dryRatio >= 0.67 ? 'consistently_dry'
                 : dryRatio <= 0.33 ? 'heating_up'
                 : 'mixed';
  return { label, dryRatio, totalIntervals: total, quietIntervals: quiet, activeIntervals: active };
}

module.exports = {
  computeSegmentFeatures,
  computeActivityConsistency,
  minutesIntoSecondHalf,
  weightedSegmentIntensity,
  weightedCumulativePerMinute,
  trendOverRecentIntervals,
};
