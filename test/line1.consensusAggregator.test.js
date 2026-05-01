'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregatePDry } = require('../src/pipeline/line1/consensusAggregator');

const allDry    = { dry_1H: 0.9, dry_2H: 0.9, trajectory: 0.9, odds: 0.7, prematch: 1.0 };
const allActive = { dry_1H: 0.1, dry_2H: 0.1, trajectory: 0.1, odds: 0.2, prematch: 0.0 };

test('aggregatePDry: всі dry → P_dry≥0.85, signalEligible=true, consensusCount=5', () => {
  const r = aggregatePDry({ components: allDry, leagueBaseline: 0.50, snapshotsCount: 3 });
  assert.ok(r.pDry >= 0.85, `got ${r.pDry}`);
  assert.equal(r.signalEligible, true);
  assert.equal(r.consensusCount, 5);
});

test('aggregatePDry: всі active → P_dry≤0.562, signalEligible=false', () => {
  const r = aggregatePDry({ components: allActive, leagueBaseline: 0.50, snapshotsCount: 3 });
  assert.ok(r.pDry <= 0.562, `got ${r.pDry}`);
  assert.equal(r.signalEligible, false);
});

test('aggregatePDry: trajectory<0.4 → signalEligible=false', () => {
  const comps = { dry_1H: 0.9, dry_2H: 0.9, trajectory: 0.3, odds: 0.7, prematch: 1.0 };
  const r = aggregatePDry({ components: comps, leagueBaseline: 0.50, snapshotsCount: 3 });
  assert.equal(r.signalEligible, false);
  assert.ok(r.skipReason && r.skipReason.toLowerCase().includes('trajectory'));
});

test('aggregatePDry: snapshotsCount<2 → signalEligible=false', () => {
  const r = aggregatePDry({ components: allDry, leagueBaseline: 0.50, snapshotsCount: 1 });
  assert.equal(r.signalEligible, false);
  assert.ok(r.skipReason && r.skipReason.toLowerCase().includes('snapshot'));
});

test('aggregatePDry: consensus=3 (only 3 of 5 ≥0.5) → signalEligible=false', () => {
  const comps = { dry_1H: 0.6, dry_2H: 0.6, trajectory: 0.6, odds: 0.3, prematch: 0.2 };
  const r = aggregatePDry({ components: comps, leagueBaseline: 0.50, snapshotsCount: 3 });
  assert.equal(r.consensusCount, 3);
  assert.equal(r.signalEligible, false);
});

test('aggregatePDry: P_dry clipped to [0.10, 0.92]', () => {
  const rHigh = aggregatePDry({ components: allDry, leagueBaseline: 0.65, snapshotsCount: 3 });
  assert.ok(rHigh.pDry <= 0.92);
  const rLow = aggregatePDry({ components: allActive, leagueBaseline: 0.20, snapshotsCount: 3 });
  assert.ok(rLow.pDry >= 0.10);
});

test('aggregatePDry: повертає weightedSum, consensusCount, skipReason', () => {
  const r = aggregatePDry({ components: allDry, leagueBaseline: 0.50, snapshotsCount: 3 });
  assert.ok(Number.isFinite(r.weightedSum));
  assert.ok(Number.isFinite(r.consensusCount));
});
