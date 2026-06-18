'use strict';
const TERMINAL_PHASES = new Set([
  'signal',
  'goal_during_decision',
  'skipped_by_consensus',
  'skipped_by_min_p',
  'flipped_away',
]);
function isLockedPhase(phase) {
  return TERMINAL_PHASES.has(phase);
}
module.exports = { isLockedPhase, TERMINAL_PHASES };
