'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../observability/logger');

const DATA_ROOT = path.resolve(__dirname, '../../data/logs');

function logDateDir(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return path.join(DATA_ROOT, `${y}-${m}-${d}`);
}

function auditPath(date = new Date()) {
  return path.join(logDateDir(date), 'ai_halftime_audit.json');
}

function appendHalftimeAudit(matchId, auditEntry, date = new Date()) {
  try {
    const dir = logDateDir(date);
    fs.mkdirSync(dir, { recursive: true });
    const fp = auditPath(date);
    let blob = {};
    if (fs.existsSync(fp)) {
      try {
        blob = JSON.parse(fs.readFileSync(fp, 'utf8'));
      } catch {
        blob = {};
      }
    }
    blob[matchId] = auditEntry;
    fs.writeFileSync(fp, `${JSON.stringify(blob, null, 2)}\n`, 'utf8');
  } catch (err) {
    logger.warn('aiHalftimeAudit: write failed', { matchId, error: err.message });
  }
}

module.exports = { appendHalftimeAudit, auditPath, logDateDir };
