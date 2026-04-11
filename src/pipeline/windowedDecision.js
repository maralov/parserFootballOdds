/**
 * Скелет windowedDecision — контракт рішення для dynamic time-windowed моделі.
 * Наразі тільки контракт + валідатор. Логіка наповниться після аналізу research-артефактів.
 * НЕ інтегрований у worker.js — окремий модуль для дослідження.
 */

const WINDOWS = ['60-70', '70-80', '80-90+'];
const BETS = ['TOTAL_UNDER_0_5', 'TOTAL_OVER_0_5', 'SKIP'];
const CONFIDENCES = ['high', 'medium', 'low', 'none'];

function createDecision(overrides = {}) {
  return {
    timeWindow: overrides.timeWindow || '60-70',
    bet: overrides.bet || 'SKIP',
    confidence: overrides.confidence || 'none',
    probabilities: {
      pGoal: overrides.pGoal ?? null,
      pDry: overrides.pDry ?? null,
      edge: overrides.edge ?? null,
    },
    reason: overrides.reason || '',
    indices: {
      pressure: overrides.pressure ?? null,
      dryness: overrides.dryness ?? null,
      momentum: overrides.momentum ?? null,
      imbalance: overrides.imbalance ?? null,
      conversionPressure: overrides.conversionPressure ?? null,
      chaos: overrides.chaos ?? null,
    },
    stateChanged: overrides.stateChanged === true,
    previousSignal: overrides.previousSignal || null,
    currentSignal: overrides.currentSignal || null,
  };
}

function validateDecision(d) {
  const errors = [];
  if (!WINDOWS.includes(d.timeWindow)) errors.push(`invalid timeWindow: ${d.timeWindow}`);
  if (!BETS.includes(d.bet)) errors.push(`invalid bet: ${d.bet}`);
  if (!CONFIDENCES.includes(d.confidence)) errors.push(`invalid confidence: ${d.confidence}`);
  if (d.stateChanged && !d.previousSignal) errors.push('stateChanged=true but no previousSignal');
  return { valid: errors.length === 0, errors };
}

/**
 * Placeholder: приймає match snapshot + derived індекси → масив рішень по кожному вікну.
 * Заглушка повертає SKIP для кожного вікна.
 */
function evaluateWindows(/* snapshot, derivedIndices */) {
  return WINDOWS.map(w => createDecision({ timeWindow: w }));
}

module.exports = {
  WINDOWS, BETS, CONFIDENCES,
  createDecision, validateDecision, evaluateWindows,
};
