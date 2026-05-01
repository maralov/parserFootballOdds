'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLine1Dry } = require('../src/pipeline/line1/dryEngine');

const baseFeatures = {
  matchId: 'M1',
  league: 'Італія: Серія А',
  minute: 65,
  raw1H: { shotsOnTarget: 2, expectedGoalsXg: 0.4, bigChances: 0, touchesInOppositionBox: 12, totalShots: 5 },
  raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.12, bigChances: 0, touchesInOppositionBox: 5, totalShots: 2 },
  rawOverall: { shotsOnTarget: 3, expectedGoalsXg: 0.52, bigChances: 0, touchesInOppositionBox: 17, totalShots: 7 },
  odds1X2: { home: 2.6, draw: 3.0, away: 2.7 },
  statsStatus: 'both',
};

const drySnapshots = [
  { matchMinute: 55, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.04, bigChances: 0, touchesInOppositionBox: 2, totalShots: 1 } },
  { matchMinute: 60, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.08, bigChances: 0, touchesInOppositionBox: 3, totalShots: 2 } },
  { matchMinute: 65, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.12, bigChances: 0, touchesInOppositionBox: 5, totalShots: 2 } },
];

const lowAggregates = {
  home: { n: 5, avgTotalGoals: 1.8 },
  away: { n: 5, avgTotalGoals: 1.7 },
  mutual: { n: 3, avgTotalGoals: 2.0 },
};

const cleanIncidents = { homeRedCards: 0, awayRedCards: 0 };

test('evaluateLine1Dry: dry scenario → UNDER_0_5, signalEligible=true', () => {
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures,
    snapshots: drySnapshots,
    incidents: cleanIncidents,
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'UNDER_0_5');
  assert.equal(result.signalEligible, true);
  assert.ok(result.pDry >= 0.62);
  assert.ok(result.consensusCount >= 4);
});

test('evaluateLine1Dry: score not 0:0 → SKIP', () => {
  const result = evaluateLine1Dry({
    match: { score: { home: '1', away: '0' } },
    features: baseFeatures,
    snapshots: drySnapshots,
    incidents: cleanIncidents,
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
  assert.ok(result.reason.toLowerCase().includes('0:0') || result.reason.toLowerCase().includes('not'));
});

test('evaluateLine1Dry: minute<60 → SKIP (outside window)', () => {
  const f = { ...baseFeatures, minute: 55 };
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: f,
    snapshots: drySnapshots,
    incidents: cleanIncidents,
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
});

test('evaluateLine1Dry: minute>75 → SKIP (outside window)', () => {
  const f = { ...baseFeatures, minute: 78 };
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: f,
    snapshots: drySnapshots,
    incidents: cleanIncidents,
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
});

test('evaluateLine1Dry: red card → SKIP', () => {
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures,
    snapshots: drySnapshots,
    incidents: { homeRedCards: 1, awayRedCards: 0 },
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
  assert.ok(result.reason.toLowerCase().includes('red'));
});

test('evaluateLine1Dry: null raw1H → SKIP', () => {
  const f = { ...baseFeatures, raw1H: null };
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: f,
    snapshots: drySnapshots,
    incidents: cleanIncidents,
    preMatchAggregates: lowAggregates,
  });
  assert.equal(result.bet, 'SKIP');
  assert.ok(result.reason.toLowerCase().includes('raw1h') || result.reason.toLowerCase().includes('1h'));
});

test('evaluateLine1Dry: result contains components object', () => {
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: baseFeatures,
    snapshots: drySnapshots,
    incidents: cleanIncidents,
    preMatchAggregates: lowAggregates,
  });
  assert.ok(result.components);
  assert.ok(Number.isFinite(result.components.dry_1H));
  assert.ok(Number.isFinite(result.components.dry_2H));
  assert.ok(Number.isFinite(result.components.trajectory));
  assert.ok(Number.isFinite(result.components.odds));
  assert.ok(Number.isFinite(result.components.prematch));
});
