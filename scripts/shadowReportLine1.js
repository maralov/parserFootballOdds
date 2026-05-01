#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { loadShadowEntries } = require('../src/pipeline/line1/shadowLogger');
const { loadDayMatches } = require('../src/pipeline/dailyLogger');
const { sessionDateKey, yesterday } = require('../src/helpers/date');

const argv = process.argv.slice(2);
const date = argv[0] || sessionDateKey(yesterday());

const shadow = loadShadowEntries(date);
if (shadow.length === 0) {
  console.log(`No Line1 shadow entries for ${date}`);
  process.exit(0);
}

const dayMatches = loadDayMatches(date);
const finalScoreById = new Map();
for (const m of dayMatches) {
  if (m.matchId && m.finalScore) finalScoreById.set(m.matchId, m.finalScore);
}

const signalEntries = shadow.filter((e) => e.signalEligible && e.bet === 'UNDER_0_5');
let resolved = 0, hits = 0, misses = 0, unresolved = 0;
for (const e of signalEntries) {
  const fs = finalScoreById.get(e.matchId);
  if (!fs) { unresolved++; continue; }
  const isWin = String(fs.home) === '0' && String(fs.away) === '0';
  resolved++;
  if (isWin) hits++; else misses++;
}

const hr = resolved > 0 ? (hits / resolved) : null;

console.log(`=== Line1 shadow report ${date} ===`);
console.log(`Total shadow entries: ${shadow.length}`);
console.log(`Signal-eligible (UNDER_0_5): ${signalEntries.length}`);
console.log(`Resolved: ${resolved} (hits=${hits}, misses=${misses}, unresolved=${unresolved})`);
console.log(`HR: ${hr == null ? 'n/a' : (hr * 100).toFixed(1) + '%'}`);
const buckets = { '0.62-0.65': 0, '0.65-0.70': 0, '0.70-0.75': 0, '0.75+': 0 };
for (const e of signalEntries) {
  if (!e.pDry) continue;
  if (e.pDry < 0.65) buckets['0.62-0.65']++;
  else if (e.pDry < 0.70) buckets['0.65-0.70']++;
  else if (e.pDry < 0.75) buckets['0.70-0.75']++;
  else buckets['0.75+']++;
}
console.log('P_dry distribution:', buckets);
