/**
 * Домінування по сторонах з home/away сум 2H (ТЗ §8).
 */

const PRESSURE_KEYS = [
  'shotsOnTarget',
  'shotsInsideTheBox',
  'bigChances',
  'touchesInOppositionBox',
  'cornerKicks',
  'expectedGoalsXg',
];

const WEIGHTS = {
  shotsOnTarget: 0.22,
  shotsInsideTheBox: 0.18,
  bigChances: 0.2,
  touchesInOppositionBox: 0.15,
  cornerKicks: 0.08,
  expectedGoalsXg: 0.17,
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {{ home?: Record<string, unknown>, away?: Record<string, unknown> }} sideStats — secondHalf.home / .away
 */
function buildDominanceMetrics(sideStats) {
  const h = sideStats?.home || {};
  const a = sideStats?.away || {};

  const hasAny = PRESSURE_KEYS.some((key) => num(h[key]) + num(a[key]) > 0);
  if (!hasAny) {
    return {
      homePressureShare: 0.5,
      awayPressureShare: 0.5,
      dominanceSide: 'balanced',
      dominanceStrength: 0.5,
      oneSidedPressure: false,
      balancedMatch: true,
    };
  }

  let hScore = 0;
  let aScore = 0;
  let wSum = 0;

  for (const key of PRESSURE_KEYS) {
    const w = WEIGHTS[key] || 0;
    const hv = num(h[key]);
    const av = num(a[key]);
    hScore += hv * w;
    aScore += av * w;
    wSum += w;
  }

  const total = hScore + aScore;
  const homePressureShare = total > 0 ? Number((hScore / total).toFixed(4)) : 0.5;
  const awayPressureShare = total > 0 ? Number((aScore / total).toFixed(4)) : 0.5;

  let dominanceSide = 'balanced';
  const diff = Math.abs(homePressureShare - 0.5);
  if (homePressureShare >= 0.58) dominanceSide = 'home';
  else if (awayPressureShare >= 0.58) dominanceSide = 'away';

  const dominanceStrength = Number((Math.max(homePressureShare, awayPressureShare)).toFixed(4));

  const oneSidedPressure = diff >= 0.12;
  const balancedMatch = diff < 0.08;

  return {
    homePressureShare,
    awayPressureShare,
    dominanceSide,
    dominanceStrength,
    oneSidedPressure,
    balancedMatch,
  };
}

module.exports = { buildDominanceMetrics, PRESSURE_KEYS, WEIGHTS };
