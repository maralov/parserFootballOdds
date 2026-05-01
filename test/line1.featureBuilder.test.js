'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFeatures } = require('../src/pipeline/featureBuilder');

const mkStats = (sumObj) => ({ home: {}, away: {}, sum: sumObj });

test('buildFeatures повертає raw1H коли firstHalf наданий', () => {
  const match = { id: 'M1', league: 'Test', minute: 55, score: { home: '0', away: '0' } };
  const statsResult = {
    overall: mkStats({ shotsOnTarget: 5, expectedGoalsXg: 1.2, bigChances: 1, touchesInOppositionBox: 30, cornerKicks: 6, goalkeeperSaves: 2 }),
    firstHalf: mkStats({ shotsOnTarget: 3, expectedGoalsXg: 0.7, bigChances: 1, touchesInOppositionBox: 18, cornerKicks: 4, goalkeeperSaves: 1 }),
    secondHalf: mkStats({ shotsOnTarget: 2, expectedGoalsXg: 0.5, bigChances: 0, touchesInOppositionBox: 12, cornerKicks: 2, goalkeeperSaves: 1 }),
    statsStatus: 'both',
  };
  const f = buildFeatures(match, statsResult);
  assert.ok(f.raw1H, 'raw1H повинен існувати');
  assert.equal(f.raw1H.shotsOnTarget, 3);
  assert.equal(f.raw1H.expectedGoalsXg, 0.7);
});

test('buildFeatures: raw1H = null коли firstHalf відсутній', () => {
  const match = { id: 'M2', league: 'Test', minute: 65, score: { home: '0', away: '0' } };
  const statsResult = {
    overall: mkStats({ shotsOnTarget: 4, expectedGoalsXg: 1.0 }),
    firstHalf: null,
    secondHalf: mkStats({ shotsOnTarget: 2, expectedGoalsXg: 0.5 }),
    statsStatus: 'both',
  };
  const f = buildFeatures(match, statsResult);
  assert.equal(f.raw1H, null);
});

test('buildFeatures: raw1H присутній у early-return (no primary stats)', () => {
  const match = { id: 'M3', league: 'Test', minute: 50, score: { home: '0', away: '0' } };
  const statsResult = {
    overall: null,
    firstHalf: null,
    secondHalf: null,
    statsStatus: 'unavailable',
  };
  const f = buildFeatures(match, statsResult);
  assert.equal(f.raw1H, null, 'raw1H = null у early-return');
});
