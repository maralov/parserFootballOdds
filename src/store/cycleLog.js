'use strict';

const fs = require('fs');
const path = require('path');
const { dateKeyLocal } = require('../helpers/date');
const logger = require('../observability/logger');

const DATA_ROOT = path.resolve(__dirname, '../../data/logs');

function cycleFile(date) {
  const dir = path.join(DATA_ROOT, dateKeyLocal(date));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'cycles.ndjson');
}

/**
 * Append one cycle record (JSON line) to cycles.ndjson.
 *
 * @param {object} record
 * @param {Date} [date]
 */
function writeCycle(record, date = new Date()) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...record }) + '\n';
  try {
    fs.appendFileSync(cycleFile(date), line, 'utf8');
  } catch (e) {
    logger.warn('cycleLog: write failed', { err: e.message });
  }
}

module.exports = { writeCycle };
