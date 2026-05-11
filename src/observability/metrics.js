'use strict';

const state = {
  cycles: 0,
  totalCandidates: 0,
  totalErrors: 0,
  sessionStart: new Date().toISOString(),
};

function incrementCycles() { state.cycles++; }
function incrementCandidates(n = 1) { state.totalCandidates += n; }
function incrementErrors(n = 1) { state.totalErrors += n; }

function snapshot() {
  return { ...state, uptime: Date.now() - new Date(state.sessionStart).getTime() };
}

module.exports = { incrementCycles, incrementCandidates, incrementErrors, snapshot };
