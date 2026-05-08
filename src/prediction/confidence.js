'use strict';

const { clamp } = require('../computed/helpers');

/**
 * RFC confidence: base score + explicit penalties + mode-specific cap.
 *
 * @param {{
 *   finalScore: number,
 *   activationThreshold: number,
 *   dataQuality: number,            // 0..1
 *   reasonsCount?: number,
 *   lateActivationRisk?: number,    // 0..100
 *   realPressureScore?: number,     // 0..100
 *   isHotButNoGoal?: boolean,
 *   hasRedCard?: boolean,
 *   statsLevel?: 'basic' | 'detailed',
 *   lowSnapshotCount?: boolean,
 *   modelMode?: 'basic' | 'detailed' | 'detailed_ai',
 *   extraPenalty?: number,          // 0..1, legacy (e.g. ftTmModelSignals)
 * }} opts
 */
function buildConfidence(opts) {
  const {
    finalScore,
    activationThreshold,
    dataQuality,
    reasonsCount = 0,
    lateActivationRisk = 0,
    realPressureScore = 0,
    isHotButNoGoal = false,
    hasRedCard = false,
    statsLevel = 'basic',
    lowSnapshotCount = false,
    modelMode = 'detailed',
    extraPenalty = 0,
  } = opts;

  const span = Math.max(1e-9, 100 - activationThreshold);
  const thresholdDistance = clamp((finalScore - activationThreshold) / span, 0, 1);
  const reasonsStrength = clamp(reasonsCount / 5, 0, 1);

  let base = 0.45
    + thresholdDistance * 0.25
    + dataQuality * 0.20
    + reasonsStrength * 0.10;

  base -= extraPenalty || 0;

  if (lateActivationRisk > 40) base -= 0.08;
  if (realPressureScore > 40) base -= 0.08;
  if (isHotButNoGoal === true) base -= 0.08;
  if (hasRedCard === true) base -= 0.20;
  if (statsLevel === 'basic') base -= 0.06;
  if (lowSnapshotCount === true) base -= 0.08;

  const cap = modelMode === 'basic' ? 0.68
    : modelMode === 'detailed_ai' ? 0.86
    : 0.82;

  return clamp(base, 0.35, cap);
}

function dataQualityTier({ statsLevel, hasNg, hasNxgot }) {
  if (statsLevel === 'detailed' && hasNg && hasNxgot) return 1;
  if (statsLevel === 'detailed') return 0.75;
  return 0.6;
}

module.exports = { buildConfidence, dataQualityTier };
