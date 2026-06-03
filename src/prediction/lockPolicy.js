'use strict';
const TERMINAL_PHASES = new Set(['signal', 'goal_during_decision']);
function isLockedPhase(phase) {
  return TERMINAL_PHASES.has(phase);
}
module.exports = { isLockedPhase, TERMINAL_PHASES };
