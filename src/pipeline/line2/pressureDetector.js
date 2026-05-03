'use strict';

const { computePace, PACE_METRICS } = require('../line1/paceNormalizer');

const SURGE_WEIGHTS = {
  expectedGoalsXg: 0.35,
  shotsOnTarget: 0.30,
  bigChances: 0.15,
  touchesInOppositionBox: 0.12,
  totalShots: 0.08,
};

/**
 * Виявляє прогресивний ріст тиску у фіналі матчу.
 *
 * Підхід:
 *   - "lateWindow" = знімки з matchMinute >= startMinute (наприклад 75')
 *   - lateRate[k] = різниця stat між останнім і першим знімком вікна / minutesSpan
 *   - baselineRate[k] = stat[firstSnap] / firstSnap.matchMinute (середня інтенсивність до 75')
 *   - ratio[k] = lateRate / baselineRate; ratio >= surgeRatio → метрика surging
 *   - pressureScore = зважена сума surge-сигналів (0..1)
 *   - monotonic = чи всі сусідні rate-кроки в lateWindow зростають (для ≥3 знімків)
 *
 * @param {Array} snapshots — повна історія знімків матчу (sorted by matchMinute asc)
 * @param {{startMinute:number, surgeRatio:number}} cfg
 * @returns {{
 *   pressureScore:number,
 *   surgingCount:number,
 *   surgeMetrics:object,
 *   monotonic:boolean,
 *   snapshotsInWindow:number,
 *   lateRates:object,
 *   baselineRates:object
 * }}
 */
function detectPressure(snapshots, { startMinute, surgeRatio }) {
  const result = {
    pressureScore: 0,
    surgingCount: 0,
    surgeMetrics: {},
    monotonic: false,
    snapshotsInWindow: 0,
    lateRates: {},
    baselineRates: {},
  };
  if (!Array.isArray(snapshots) || snapshots.length < 2) return result;

  const sorted = [...snapshots].sort((a, b) => (a.matchMinute || 0) - (b.matchMinute || 0));
  const inWindow = sorted.filter((s) => Number(s.matchMinute) >= startMinute);
  result.snapshotsInWindow = inWindow.length;
  if (inWindow.length < 2) return result;

  const first = inWindow[0];
  const last  = inWindow[inWindow.length - 1];
  const minutesSpan = Math.max(1, (last.matchMinute || 0) - (first.matchMinute || 0));

  // baseline = темп до lateWindow (ліве ребро = first snap у вікні)
  const baselineMinutes = Math.max(1, first.matchMinute || 0);
  const baselinePace = computePace(first.raw2H, baselineMinutes);

  // late rate = (last - first) / minutesSpan по metric
  const lateRate = {};
  for (const k of PACE_METRICS) {
    const a = first.raw2H?.[k];
    const b = last.raw2H?.[k];
    if (Number.isFinite(a) && Number.isFinite(b)) {
      lateRate[k] = (b - a) / minutesSpan;
    } else {
      lateRate[k] = null;
    }
  }
  result.lateRates = lateRate;
  result.baselineRates = baselinePace || {};

  // surge ratios
  let weightedSum = 0;
  let weightTotal = 0;
  for (const k of PACE_METRICS) {
    const w = SURGE_WEIGHTS[k] || 0;
    if (!w) continue;
    const lr = lateRate[k];
    const br = baselinePace ? baselinePace[k] : null;
    if (!Number.isFinite(lr) || !Number.isFinite(br) || br <= 0) continue;
    const ratio = Number((lr / br).toFixed(4));
    result.surgeMetrics[k] = ratio;
    weightTotal += w;
    if (ratio >= surgeRatio) {
      result.surgingCount += 1;
      weightedSum += w * Math.min(1, (ratio - 1) / (surgeRatio - 1 + 0.5));
    }
  }
  if (weightTotal > 0) {
    result.pressureScore = Number(Math.max(0, Math.min(1, weightedSum / weightTotal)).toFixed(4));
  }

  // monotonic: для трьох і більше знімків — кожен крок має давати додатній сумарний приріст
  // використовуємо xG як головний індикатор; fallback на shotsOnTarget
  if (inWindow.length >= 3) {
    let monoXg = true;
    let monoSot = true;
    for (let i = 1; i < inWindow.length; i++) {
      const prev = inWindow[i - 1].raw2H || {};
      const cur  = inWindow[i].raw2H || {};
      if (Number.isFinite(prev.expectedGoalsXg) && Number.isFinite(cur.expectedGoalsXg)) {
        if (cur.expectedGoalsXg < prev.expectedGoalsXg - 1e-6) monoXg = false;
      }
      if (Number.isFinite(prev.shotsOnTarget) && Number.isFinite(cur.shotsOnTarget)) {
        if (cur.shotsOnTarget < prev.shotsOnTarget - 1e-6) monoSot = false;
      }
    }
    result.monotonic = monoXg && monoSot;
  } else {
    // 2 знімки: монотонність вважаємо true, якщо є приріст хоча б у xG або SOT
    const a = inWindow[0].raw2H || {};
    const b = inWindow[1].raw2H || {};
    const xgDelta = (Number(b.expectedGoalsXg) || 0) - (Number(a.expectedGoalsXg) || 0);
    const sotDelta = (Number(b.shotsOnTarget) || 0) - (Number(a.shotsOnTarget) || 0);
    result.monotonic = xgDelta > 0 || sotDelta > 0;
  }

  return result;
}

module.exports = { detectPressure, SURGE_WEIGHTS };
