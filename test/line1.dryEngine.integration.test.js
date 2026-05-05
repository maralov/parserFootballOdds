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

// 13 знімків (>11) для проходження LINE1_MIN_SNAPSHOTS gate.
const drySnapshots = [
  { matchMinute: 53, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.02, bigChances: 0, touchesInOppositionBox: 1, totalShots: 1 } },
  { matchMinute: 54, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.03, bigChances: 0, touchesInOppositionBox: 2, totalShots: 1 } },
  { matchMinute: 55, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.04, bigChances: 0, touchesInOppositionBox: 2, totalShots: 1 } },
  { matchMinute: 56, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.05, bigChances: 0, touchesInOppositionBox: 2, totalShots: 1 } },
  { matchMinute: 57, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.06, bigChances: 0, touchesInOppositionBox: 2, totalShots: 1 } },
  { matchMinute: 58, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.07, bigChances: 0, touchesInOppositionBox: 3, totalShots: 2 } },
  { matchMinute: 59, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.07, bigChances: 0, touchesInOppositionBox: 3, totalShots: 2 } },
  { matchMinute: 60, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.08, bigChances: 0, touchesInOppositionBox: 3, totalShots: 2 } },
  { matchMinute: 61, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.09, bigChances: 0, touchesInOppositionBox: 4, totalShots: 2 } },
  { matchMinute: 62, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.10, bigChances: 0, touchesInOppositionBox: 4, totalShots: 2 } },
  { matchMinute: 63, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.11, bigChances: 0, touchesInOppositionBox: 4, totalShots: 2 } },
  { matchMinute: 64, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.11, bigChances: 0, touchesInOppositionBox: 5, totalShots: 2 } },
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

test('evaluateLine1Dry: Dry→Burst → OVER_0_5', () => {
  // Перші 2 snapshot: тихий матч (низький xG). Останній: різкий burst
  // raw1H xG=0.4 → pace1H=0.00889/min
  // raw2H xG=0.12 at 68' (23 хв) → overall ratio=0.587 < 0.85 (матч тихий загалом)
  // last 3min delta xG=0.07 → ratio=2.6x burst
  const burstFeatures = {
    ...baseFeatures,
    minute: 68,
    raw1H: { shotsOnTarget: 2, expectedGoalsXg: 0.4, bigChances: 0, touchesInOppositionBox: 12, totalShots: 5 },
    raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.12, bigChances: 0, touchesInOppositionBox: 5, totalShots: 3 },
  };
  const burstSnapshots = [
    { matchMinute: 60, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.03, bigChances: 0, touchesInOppositionBox: 2, totalShots: 1 } },
    { matchMinute: 65, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 0, expectedGoalsXg: 0.05, bigChances: 0, touchesInOppositionBox: 3, totalShots: 2 } },
    { matchMinute: 68, score: { home: '0', away: '0' }, raw2H: { shotsOnTarget: 1, expectedGoalsXg: 0.12, bigChances: 0, touchesInOppositionBox: 5, totalShots: 3 } },
  ];
  const result = evaluateLine1Dry({
    match: { score: { home: '0', away: '0' } },
    features: burstFeatures,
    snapshots: burstSnapshots,
    incidents: { homeRedCards: 0, awayRedCards: 0 },
    preMatchAggregates: null,
  });
  assert.equal(result.bet, 'OVER_0_5', `expected OVER_0_5, got ${result.bet}: ${result.reason}`);
  assert.equal(result.signalEligible, true);
  assert.ok(result.reason.includes('Dry→Burst'));
});
