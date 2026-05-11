#!/usr/bin/env node
'use strict';

/**
 * Calibration check across historical prediction data.
 *
 *   node scripts/calibration-check.js [--window=N] [--since=YYYY-MM-DD] [--out=path.json]
 *
 * Reads all data/logs/<date>/matches.json files.
 * Only resolved predictions (predictionAudit.hit === true or false) are included.
 *
 * Groups results by confidence bucket and computes:
 *   n, hits, actualRate, drift (actualRate - expectedMidpoint)
 *
 * Warns when |drift| > 0.15 for any bucket with n >= 10.
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
// Confidence bucket definitions
// ---------------------------------------------------------------------------
const BUCKETS = [
  { key: 'lt0.55',    label: '<0.55',    expectedMid: 0.47, test: c => c < 0.55 },
  { key: '0.55-0.70', label: '0.55-0.70', expectedMid: 0.625, test: c => c >= 0.55 && c < 0.70 },
  { key: '0.70-0.82', label: '0.70-0.82', expectedMid: 0.76, test: c => c >= 0.70 && c < 0.82 },
  { key: 'gte0.82',   label: '0.82+',    expectedMid: 0.88, test: c => c >= 0.82 },
];

function bucketFor(confidence) {
  for (const b of BUCKETS) {
    if (b.test(confidence)) return b;
  }
  return null;
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

// ---------------------------------------------------------------------------
// Collect resolved predictions from a single matches.json store
// Returns array of { confidence, hit, createdAt }
// ---------------------------------------------------------------------------
function collectResolved(store) {
  const rows = [];
  for (const m of Object.values(store)) {
    for (const checkpoint of ['decision60', 'decision80']) {
      const p = m.predictions?.[checkpoint];
      if (!p) continue;
      const hit = p.predictionAudit?.hit;
      if (hit !== true && hit !== false) continue;
      const confidence = p.confidence;
      if (typeof confidence !== 'number') continue;
      rows.push({ confidence, hit, createdAt: p.createdAt || null });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function run() {
  const { flags } = parseArgs(process.argv);

  const window = flags.window ? parseInt(flags.window, 10) : null;
  const since = flags.since || null;

  const logsRoot = path.join(__dirname, '../data/logs');
  if (!fs.existsSync(logsRoot)) {
    console.error('Logs directory not found:', logsRoot);
    process.exit(1);
  }

  // Read all date directories
  let dateDirs = fs.readdirSync(logsRoot)
    .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort(); // ascending date order

  // Apply --since filter
  if (since) {
    dateDirs = dateDirs.filter(d => d >= since);
  }

  // Collect all resolved rows (in file order / date order)
  let allRows = [];
  for (const dir of dateDirs) {
    const filePath = path.join(logsRoot, dir, 'matches.json');
    const store = readJsonSilent(filePath);
    if (!store) continue;
    const rows = collectResolved(store);
    allRows = allRows.concat(rows);
  }

  // Apply --window filter: keep last N resolved predictions
  if (window !== null && !isNaN(window) && window > 0) {
    allRows = allRows.slice(-window);
  }

  // ---- Build calibration buckets -----------------------------------------
  const bucketData = {};
  for (const b of BUCKETS) {
    bucketData[b.key] = {
      label: b.label,
      expectedMid: b.expectedMid,
      n: 0,
      hits: 0,
      actualRate: null,
      drift: null,
    };
  }

  for (const { confidence, hit } of allRows) {
    const b = bucketFor(confidence);
    if (!b) continue;
    bucketData[b.key].n += 1;
    if (hit === true) bucketData[b.key].hits += 1;
  }

  // Compute rates and drifts
  for (const b of BUCKETS) {
    const bd = bucketData[b.key];
    bd.actualRate = bd.n > 0 ? bd.hits / bd.n : null;
    bd.drift = bd.actualRate !== null ? bd.actualRate - b.expectedMid : null;
  }

  // ---- Overall weighted drift (weight = n) --------------------------------
  let weightedDriftSum = 0;
  let totalWeight = 0;
  for (const b of BUCKETS) {
    const bd = bucketData[b.key];
    if (bd.n > 0 && bd.drift !== null) {
      weightedDriftSum += bd.drift * bd.n;
      totalWeight += bd.n;
    }
  }
  const overallDrift = totalWeight > 0 ? weightedDriftSum / totalWeight : null;

  // ---- calibrationOk and warnings ----------------------------------------
  const warnings = [];
  let calibrationOk = true;
  const DRIFT_THRESHOLD = 0.15;
  const MIN_N = 10;

  for (const b of BUCKETS) {
    const bd = bucketData[b.key];
    if (bd.n >= MIN_N && bd.drift !== null && Math.abs(bd.drift) > DRIFT_THRESHOLD) {
      calibrationOk = false;
      const direction = bd.drift > 0 ? 'over' : 'under';
      warnings.push(
        `Bucket ${bd.label}: actualRate=${bd.actualRate.toFixed(3)}, expected=${b.expectedMid}, drift=${bd.drift.toFixed(3)} (${direction}-performing, n=${bd.n})`
      );
    }
  }

  // ---- Assemble report ----------------------------------------------------
  const report = {
    generatedAt: new Date().toISOString(),
    filters: {
      since: since || null,
      window: window || null,
    },
    totalResolved: allRows.length,
    calibration: bucketData,
    overallDrift,
    calibrationOk,
    warnings,
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
