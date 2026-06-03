'use strict';

// Each sample: { p: number(0..1), outcome: 0|1, odds?: number }
function brier(samples) {
  if (!samples.length) return null;
  const sum = samples.reduce((acc, s) => acc + (s.p - s.outcome) ** 2, 0);
  return +(sum / samples.length).toFixed(6);
}

function logLoss(samples) {
  if (!samples.length) return null;
  const eps = 1e-15;
  const sum = samples.reduce((acc, s) => {
    const p = Math.min(1 - eps, Math.max(eps, s.p));
    return acc + (s.outcome ? -Math.log(p) : -Math.log(1 - p));
  }, 0);
  return +(sum / samples.length).toFixed(6);
}

// Flat stake 1 unit per bet. ROI = net profit / total staked.
function roiFlat(bets) {
  if (!bets.length) return null;
  let staked = 0; let net = 0;
  for (const b of bets) {
    staked += 1;
    net += b.outcome ? (b.odds - 1) : -1;
  }
  return +(net / staked).toFixed(6);
}

// Fractional Kelly (half-Kelly) staking. ROI = net profit / total staked.
function roiKelly(bets, fraction = 0.5) {
  if (!bets.length) return null;
  let staked = 0; let net = 0;
  for (const b of bets) {
    const edge = b.p * b.odds - 1;
    const f = edge > 0 ? fraction * (edge / (b.odds - 1)) : 0;
    if (f <= 0) continue;
    staked += f;
    net += b.outcome ? f * (b.odds - 1) : -f;
  }
  return staked > 0 ? +(net / staked).toFixed(6) : null;
}

module.exports = { brier, logLoss, roiFlat, roiKelly };
