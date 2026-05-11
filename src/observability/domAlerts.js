'use strict';

const logger = require('./logger');

/**
 * Three alert types:
 *   noScoreData   — #score-data element not found in HTML
 *   zeroCandidates — totalZeroZero > 0 but 0 candidates after filter
 *   parseThrew    — parser threw an unexpected error
 */

/**
 * @param {'noScoreData'|'zeroCandidates'|'parseThrew'} type
 * @param {object} [detail]
 */
function emit(type, detail = {}) {
  const event = { type, timestamp: new Date().toISOString(), ...detail };
  logger.warn(`DOM alert: ${type}`, event);
  return event;
}

module.exports = { emit };
