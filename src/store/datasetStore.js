'use strict';

const fs = require('fs');
const path = require('path');
const { dateKeyLocal, toISO } = require('../helpers/date');
const logger = require('../observability/logger');

const DATA_ROOT = path.resolve(__dirname, '../../data/logs');

function dayDir(date) {
  return path.join(DATA_ROOT, dateKeyLocal(date));
}

function candidatesFile(date) {
  return path.join(dayDir(date), 'raw_candidates.json');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Read today's candidate store (returns empty structure if file missing).
 * @param {Date} [date]
 * @returns {{ date: string, updatedAt: string, candidates: object[] }}
 */
function readStore(date = new Date()) {
  const file = candidatesFile(date);
  if (!fs.existsSync(file)) {
    return { date: dateKeyLocal(date), updatedAt: toISO(), candidates: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    logger.warn('datasetStore: failed to parse existing file, starting fresh', { file, err: e.message });
    return { date: dateKeyLocal(date), updatedAt: toISO(), candidates: [] };
  }
}

/**
 * Append new candidates to today's JSON file.
 * Dedup by matchId — existing entries are preserved unchanged.
 *
 * @param {import('../parser/candidateSelector').Candidate[]} candidates
 * @param {Date} [date]
 * @returns {{ added: number, skipped: number }}
 */
function appendCandidates(candidates, date = new Date()) {
  if (!candidates || candidates.length === 0) return { added: 0, skipped: 0 };

  ensureDir(dayDir(date));

  const store = readStore(date);
  const existingIds = new Set(store.candidates.map((c) => c.matchId));

  let added = 0;
  let skipped = 0;
  const addedIds = [];

  for (const c of candidates) {
    if (existingIds.has(c.matchId)) {
      skipped++;
    } else {
      store.candidates.push(c);
      existingIds.add(c.matchId);
      addedIds.push(c.matchId);
      added++;
    }
  }

  store.updatedAt = toISO();

  try {
    fs.writeFileSync(candidatesFile(date), JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    logger.warn('datasetStore: write failed', { err: e.message });
  }

  return { added, skipped, addedIds };
}

module.exports = { appendCandidates, readStore };
