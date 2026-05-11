#!/usr/bin/env node
'use strict';

/**
 * Daily stats summary for a single day's matches and Telegram outbox.
 *
 *   node scripts/daily-stats.js [--date=YYYY-MM-DD] [--out=path.json]
 *
 * Reads:
 *   data/logs/<date>/matches.json
 *   data/logs/<date>/tg-outbox.json  (optional)
 *
 * Outputs a JSON report with match counts, prediction stats, confidence,
 * Telegram delivery status, and simple ROI estimates.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Arg parsing (same pattern as predictionReplay.js)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else flags[a.slice(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readJsonSilent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function confidenceStats(values) {
  if (!values.length) return { avg: null, min: null, max: null };
  return {
    avg: avg(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function run() {
  const { flags } = parseArgs(process.argv);

  const date = flags.date || new Date().toISOString().slice(0, 10);
  const logsDir = path.join(__dirname, '../data/logs', date);
  const matchesPath = path.join(logsDir, 'matches.json');
  const tgOutboxPath = path.join(logsDir, 'tg-outbox.json');

  // ---- matches.json -------------------------------------------------------
  const store = readJsonSilent(matchesPath) || {};
  const matches = Object.values(store);

  // Match counts by tracking.status
  const statusCounts = { total: matches.length, active: 0, finished: 0, discarded: 0, stale: 0 };
  for (const m of matches) {
    const s = m.tracking?.status;
    if (s === 'active') statusCounts.active += 1;
    else if (s === 'finished') statusCounts.finished += 1;
    else if (s === 'discarded') statusCounts.discarded += 1;
    else if (s === 'stale') statusCounts.stale += 1;
  }

  // ---- Prediction helpers -------------------------------------------------
  // decision60 actionable types (not NO_BET, not FT_TM05_RISK which is also non-actionable)
  const D60_PRIMARY = 'FT_TM05_FROM_60_75';
  const D60_LEAN = 'LEAN_FT_TM05_FROM_60_75';
  const D80_PRIMARY = 'TB05_80_PLUS';
  const D80_LEAN = 'LEAN_TB05_80_PLUS';
  const D80_PROTECT = 'PROTECT_UNDER';

  function predStats(predictions, primaryType, leanType, extraTypes) {
    let total = 0;
    let primary = 0;
    let lean = 0;
    let extra = {};
    for (const t of (extraTypes || [])) extra[t] = 0;
    let hits = 0;
    let misses = 0;
    let pending = 0;
    const confidences = [];

    for (const p of predictions) {
      const type = p.predictionType;
      // Actionable = not NO_BET, not FT_TM05_RISK (risk-only, non-actionable)
      if (type === 'NO_BET' || type === 'FT_TM05_RISK') continue;
      total += 1;
      if (type === primaryType) primary += 1;
      if (leanType && type === leanType) lean += 1;
      for (const t of (extraTypes || [])) {
        if (type === t) extra[t] += 1;
      }

      const hit = p.predictionAudit?.hit;
      if (hit === true) hits += 1;
      else if (hit === false) misses += 1;
      else pending += 1;

      if (typeof p.confidence === 'number') confidences.push(p.confidence);
    }

    const resolved = hits + misses;
    return {
      stats: {
        total,
        primary,
        lean,
        ...extra,
        hits,
        misses,
        pending,
        hitRate: resolved > 0 ? hits / resolved : null,
      },
      confidences,
    };
  }

  const preds60 = matches
    .map(m => m.predictions?.decision60)
    .filter(Boolean);
  const preds80 = matches
    .map(m => m.predictions?.decision80)
    .filter(Boolean);

  const { stats: stats60, confidences: conf60 } = predStats(preds60, D60_PRIMARY, D60_LEAN, []);
  const { stats: stats80, confidences: conf80 } = predStats(preds80, D80_PRIMARY, D80_LEAN, [D80_PROTECT]);

  // Rename extra field in stats80
  const protectUnder = stats80[D80_PROTECT];
  delete stats80[D80_PROTECT];
  stats80.protectUnder = protectUnder;

  // ---- Confidence stats ---------------------------------------------------
  const confidence60 = confidenceStats(conf60);
  const confidence80 = confidenceStats(conf80);

  // ---- Telegram -----------------------------------------------------------
  const tgStore = readJsonSilent(tgOutboxPath) || {};
  const tgEntries = Object.values(tgStore);

  let entriesSent = 0;
  let resultsSent = 0;
  let queued = 0;
  let failed = 0;

  for (const e of tgEntries) {
    if (e.entry?.messageId != null) entriesSent += 1;
    if (e.result?.messageId != null) resultsSent += 1;
    if (e.status === 'queued') queued += 1;
    if (e.status === 'failed') failed += 1;
  }

  // ---- ROI estimates ------------------------------------------------------
  // decision60: odds 1.75 (TM0.5 under)
  const bets60 = stats60.hits + stats60.misses;
  const stake60 = bets60 * 1;
  const returns60 = stats60.hits * 1.75;
  const roi60 = stake60 > 0 ? (returns60 - stake60) / stake60 : null;

  // decision80: odds 2.20 (TB0.5 over)
  const bets80 = stats80.hits + stats80.misses;
  const stake80 = bets80 * 1;
  const returns80 = stats80.hits * 2.20;
  const roi80 = stake80 > 0 ? (returns80 - stake80) / stake80 : null;

  // ---- Assemble report ----------------------------------------------------
  const report = {
    generatedAt: new Date().toISOString(),
    date,
    matches: statusCounts,
    predictions: {
      decision60: stats60,
      decision80: stats80,
    },
    confidence: {
      decision60: confidence60,
      decision80: confidence80,
    },
    telegram: {
      entriesSent,
      resultsSent,
      queued,
      failed,
    },
    roi: {
      decision60: { bets: bets60, stake: stake60, returns: returns60, roi: roi60 },
      decision80: { bets: bets80, stake: stake80, returns: returns80, roi: roi80 },
    },
  };

  const json = JSON.stringify(report, null, 2);
  if (flags.out) {
    fs.mkdirSync(path.dirname(flags.out), { recursive: true });
    fs.writeFileSync(flags.out, json, 'utf8');
    console.log(`Wrote report to ${flags.out}`);
  } else {
    console.log(json);
  }
}

run();
