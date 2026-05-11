'use strict';

const fs = require('fs');
const path = require('path');
const { dateKeyLocal } = require('../helpers/date');
const logger = require('../observability/logger');

const DATA_ROOT = path.resolve(__dirname, '../../data/logs');

function alertFile(date) {
  const dir = path.join(DATA_ROOT, dateKeyLocal(date));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'alerts.ndjson');
}

/**
 * Append one alert record (JSON line) to alerts.ndjson.
 *
 * @param {object} event
 * @param {Date} [date]
 */
function writeAlert(event, date = new Date()) {
  const line = JSON.stringify(event) + '\n';
  try {
    fs.appendFileSync(alertFile(date), line, 'utf8');
  } catch (e) {
    logger.warn('alertLog: write failed', { err: e.message });
  }
}

module.exports = { writeAlert };
