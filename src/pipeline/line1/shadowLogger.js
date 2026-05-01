'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = path.join(__dirname, '..', '..', '..', 'data', 'logs');

function getDir(date) {
  const base = process.env.LINE1_SHADOW_DIR_OVERRIDE || DEFAULT_BASE;
  const dir = path.join(base, date);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFile(date) {
  return path.join(getDir(date), 'line1_shadow.json');
}

function loadShadowEntries(date) {
  const fp = getFile(date);
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')) || []; } catch { return []; }
}

function appendShadowEntry(date, entry) {
  const list = loadShadowEntries(date);
  const idx = list.findIndex((e) => e.matchId === entry.matchId && e.minute === entry.minute);
  if (idx === -1) list.push(entry);
  else list[idx] = entry;
  fs.writeFileSync(getFile(date), JSON.stringify(list, null, 2), 'utf8');
}

module.exports = { appendShadowEntry, loadShadowEntries };
