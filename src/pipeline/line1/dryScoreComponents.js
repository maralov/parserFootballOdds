'use strict';

function n01(v, max) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const c = Math.max(0, Math.min(Number(v), max));
  return c / max;
}

/**
 * dry score for a half based on raw stats intensity.
 * Returns [0..1], 1 = fully dry (no pressure), 0 = high pressure.
 */
function dryFromIntensity(raw) {
  if (!raw) return 0.5;

  const sot   = n01(raw.shotsOnTarget, 8);
  const xg    = n01(raw.expectedGoalsXg, 2.0);
  const bc    = n01(raw.bigChances, 4);
  const touch = n01(raw.touchesInOppositionBox, 25);

  const parts = [];
  if (sot   !== null) parts.push({ v: sot,   w: 0.40 });
  if (xg    !== null) parts.push({ v: xg,    w: 0.30 });
  if (bc    !== null) parts.push({ v: bc,    w: 0.20 });
  if (touch !== null) parts.push({ v: touch, w: 0.10 });

  if (parts.length === 0) return 0.5;

  const totalW    = parts.reduce((s, p) => s + p.w, 0);
  const intensity = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;

  return Number(Math.max(0, Math.min(1, 1 - intensity)).toFixed(4));
}

module.exports = { dryFromIntensity, n01 };
