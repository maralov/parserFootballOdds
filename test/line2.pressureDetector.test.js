'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPressure } = require('../src/pipeline/line2/pressureDetector');

function snap(min, raw) {
  return { matchMinute: min, raw2H: raw, score: { home: '0', away: '0' } };
}

test('insufficient snapshots → zero pressure', () => {
  const r = detectPressure([snap(78, { expectedGoalsXg: 0.5, shotsOnTarget: 2, totalShots: 5 })], { startMinute: 75, surgeRatio: 1.3 });
  assert.equal(r.pressureScore, 0);
  assert.equal(r.snapshotsInWindow, 0);
});

test('sharp surge from 75 to 88 → high pressure', () => {
  // baseline (first snap at 75): xG=0.4, SOT=2, totalShots=4 → rate xG=0.4/30=0.0133
  // late delta over 13 min: +0.6 xG → rate 0.046; ratio = 0.046/0.0133 = 3.46 (>1.3) → surging
  const snaps = [
    snap(60, { expectedGoalsXg: 0.2, shotsOnTarget: 1, bigChances: 0, touchesInOppositionBox: 8, totalShots: 3 }),
    snap(75, { expectedGoalsXg: 0.4, shotsOnTarget: 2, bigChances: 0, touchesInOppositionBox: 12, totalShots: 4 }),
    snap(80, { expectedGoalsXg: 0.7, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 15, totalShots: 6 }),
    snap(88, { expectedGoalsXg: 1.0, shotsOnTarget: 4, bigChances: 2, touchesInOppositionBox: 20, totalShots: 9 }),
  ];
  const r = detectPressure(snaps, { startMinute: 75, surgeRatio: 1.3 });
  assert.equal(r.snapshotsInWindow, 3);
  assert.equal(r.monotonic, true);
  assert.ok(r.surgingCount >= 3, `surgingCount=${r.surgingCount}`);
  assert.ok(r.pressureScore >= 0.5, `pressureScore=${r.pressureScore}`);
});

test('flat late window → low pressure', () => {
  const snaps = [
    snap(60, { expectedGoalsXg: 0.5, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 10, totalShots: 5 }),
    snap(76, { expectedGoalsXg: 0.55, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 11, totalShots: 5 }),
    snap(85, { expectedGoalsXg: 0.6, shotsOnTarget: 3, bigChances: 1, touchesInOppositionBox: 12, totalShots: 5 }),
  ];
  const r = detectPressure(snaps, { startMinute: 75, surgeRatio: 1.3 });
  assert.equal(r.snapshotsInWindow, 2);
  assert.ok(r.pressureScore < 0.6, `expected low pressure, got ${r.pressureScore}`);
});

test('non-monotonic (xG decreases) → monotonic=false', () => {
  const snaps = [
    snap(76, { expectedGoalsXg: 0.4, shotsOnTarget: 2, totalShots: 4, bigChances: 0, touchesInOppositionBox: 10 }),
    snap(82, { expectedGoalsXg: 0.6, shotsOnTarget: 3, totalShots: 5, bigChances: 0, touchesInOppositionBox: 12 }),
    snap(88, { expectedGoalsXg: 0.55, shotsOnTarget: 3, totalShots: 6, bigChances: 0, touchesInOppositionBox: 14 }),
  ];
  const r = detectPressure(snaps, { startMinute: 75, surgeRatio: 1.3 });
  assert.equal(r.monotonic, false);
});
