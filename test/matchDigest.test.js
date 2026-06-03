'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { digestMatch, matchOutcome } = require('../scripts/matchDigest');

const m = {
  homeTeam: 'A', awayTeam: 'B', league: 'L', country: 'C',
  odds: { home: 1.8, draw: 3.4, away: 4.0 },
  final: { scoreHome: 0, scoreAway: 0 },
  snapshots: [
    { observedMinute: 60, scoreHome: 0, scoreAway: 0,
      cumulative: { expectedGoalsXg: { home: 0.3, away: 0.2 }, shotsOnTarget: { home: 2, away: 1 } },
      ballPossession: { home: 55, away: 45 } },
  ],
  predictions: { tm05: { phase: 'signal', pNoGoal: 0.6, confidence: 0.7, evGate: { ev: 1.2 } }, tb05: null },
};

test('matchOutcome: tm05 0:0 final = hit', () => {
  assert.equal(matchOutcome(m, 'tm05'), 'hit');
});

test('digestMatch renders teams and a minute row', () => {
  const out = digestMatch(m);
  assert.match(out, /A vs B/);
  assert.match(out, /60/);
  assert.match(out, /signal/);
});
