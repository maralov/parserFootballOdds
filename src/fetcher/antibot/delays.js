'use strict';

/**
 * Sleep for a random duration between minMs and maxMs.
 * @param {number} minMs
 * @param {number} maxMs
 * @returns {Promise<void>}
 */
function randomDelay(minMs = 1500, maxMs = 4000) {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff sleep for retry logic.
 * @param {number} attempt - 0-based attempt index
 * @param {number} baseMs
 * @returns {Promise<void>}
 */
function backoffDelay(attempt, baseMs = 1000) {
  const ms = baseMs * Math.pow(3, attempt);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { randomDelay, backoffDelay };
