'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isLockedPhase } = require('../src/prediction/lockPolicy');

test('signal phase is locked', () => assert.equal(isLockedPhase('signal'), true));
test('goal_during_decision is locked', () => assert.equal(isLockedPhase('goal_during_decision'), true));
test('skipped_by_ds is NOT locked', () => assert.equal(isLockedPhase('skipped_by_ds'), false));
test('gate_blocked is NOT locked', () => assert.equal(isLockedPhase('gate_blocked'), false));
test('null phase is NOT locked', () => assert.equal(isLockedPhase(null), false));

// Fix 4: 3 new terminal phases introduced in P1–P2 gates
test('skipped_by_consensus is locked', () => assert.equal(isLockedPhase('skipped_by_consensus'), true));
test('skipped_by_min_p is locked', () => assert.equal(isLockedPhase('skipped_by_min_p'), true));
test('flipped_away is locked', () => assert.equal(isLockedPhase('flipped_away'), true));
