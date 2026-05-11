'use strict';

const fs   = require('fs');
const path = require('path');
const { dateKeyLocal } = require('../helpers/date');

const DATA_ROOT = path.resolve(__dirname, '../../data/logs');

function dayDir(date) {
  const key = dateKeyLocal(date);
  const dir = path.join(DATA_ROOT, key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function enrichmentPath(date) {
  return path.join(dayDir(date), 'enrichment.json');
}

/** candidates.json = enriched-only records, ready for analysis / ML */
function candidatesPath(date) {
  return path.join(dayDir(date), 'candidates.json');
}

/**
 * Read today's enrichment store (or empty object if not exists).
 * @param {Date} [date]
 * @returns {{ [matchId: string]: Object }}
 */
function readEnrichmentStore(date = new Date()) {
  const file = enrichmentPath(date);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Rebuild candidates.json from the current enrichment store.
 * Contains only items with status === 'enriched', as an array.
 * Called automatically after every saveEnrichment().
 */
function rebuildCandidates(store, date) {
  const enriched = Object.values(store).filter(item => item.status === 'enriched');
  fs.writeFileSync(
    candidatesPath(date),
    JSON.stringify(enriched, null, 2),
    'utf8',
  );
  return enriched.length;
}

/**
 * Save enrichment results (merges into existing store, deduplicates by matchId).
 * Already enriched items are NOT overwritten.
 * Items with status 'failed' or 'pending' ARE overwritten (retry logic).
 * Automatically rebuilds candidates.json.
 *
 * @param {Array<Object>} items  array of enrichment result objects
 * @param {Date} [date]
 * @returns {{ written: number, skipped: number, candidates: number }}
 */
function saveEnrichment(items, date = new Date()) {
  const file = enrichmentPath(date);
  const store = readEnrichmentStore(date);

  let written = 0;
  let skipped = 0;

  for (const item of items) {
    const existing = store[item.matchId];
    if (existing && existing.status === 'enriched') {
      skipped++;
      continue;
    }
    store[item.matchId] = item;
    written++;
  }

  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');

  const candidates = rebuildCandidates(store, date);

  return { written, skipped, candidates };
}

/**
 * Return matchIds that need retry (status: 'failed' | 'pending') for today.
 * @param {Date} [date]
 * @returns {string[]}
 */
function getPendingMatchIds(date = new Date()) {
  const store = readEnrichmentStore(date);
  return Object.values(store)
    .filter(item => item.status === 'failed' || item.status === 'pending')
    .map(item => item.matchId);
}

module.exports = { readEnrichmentStore, saveEnrichment, getPendingMatchIds, rebuildCandidates };
