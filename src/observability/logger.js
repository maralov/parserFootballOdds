'use strict';

const { LOG_LEVEL } = require('../config/env');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

function log(level, msg, data) {
  if ((LEVELS[level] ?? 0) < minLevel) return;
  const line = {
    time: new Date().toISOString(),
    level,
    msg: String(msg),
  };
  if (data !== undefined) line.data = data;
  const out = JSON.stringify(line);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(out + '\n');
  } else {
    process.stdout.write(out + '\n');
  }
}

module.exports = {
  debug: (msg, data) => log('debug', msg, data),
  info:  (msg, data) => log('info',  msg, data),
  warn:  (msg, data) => log('warn',  msg, data),
  error: (msg, data) => log('error', msg, data),
};
