'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScoreContext } = require('../src/pipeline/scoreContext');
const { computeSegmentFeatures } = require('../src/pipeline/segmentMetrics');
const { getLiveTimeWindow } = require('../src/pipeline/liveModelV2');

const RAW = (over) => ({
  shotsOnTarget: 0,
  shotsInsideTheBox: 0,
  bigChances: 0,
  touchesInOppositionBox: 0,
  cornerKicks: 0,
  expectedGoalsXg: 0,
  ...over,
});

test('buildScoreContext 0-0', () => {
  const c = buildScoreContext({ home: '0', away: '0' });
  assert.equal(c.isZeroZero, true);
  assert.equal(c.scoreStateType, '0-0');
  assert.equal(c.leadingSide, null);
});

test('buildScoreContext 1-0', () => {
  const c = buildScoreContext({ home: '1', away: '0' });
  assert.equal(c.isOneGoalGame, true);
  assert.equal(c.leadingSide, 'home');
  assert.equal(c.trailingSide, 'away');
});

test('segment trend up when xG and SOT increase', () => {
  const h = [
    { matchMinute: 60, raw2H: RAW({ shotsOnTarget: 1, expectedGoalsXg: 0.2 }) },
    { matchMinute: 63, raw2H: RAW({ shotsOnTarget: 3, expectedGoalsXg: 0.5 }) },
    { matchMinute: 66, raw2H: RAW({ shotsOnTarget: 5, expectedGoalsXg: 0.9, bigChances: 1 }) },
  ];
  const seg = computeSegmentFeatures(h, 5);
  assert.equal(seg.trendDirection, 'up');
  assert.ok(seg.vsSecondHalfRatio > 1);
});

test('getLiveTimeWindow buckets', () => {
  assert.equal(getLiveTimeWindow(65), '60-70');
  assert.equal(getLiveTimeWindow(75), '70-80');
  assert.equal(getLiveTimeWindow(85), '80-90+');
});
