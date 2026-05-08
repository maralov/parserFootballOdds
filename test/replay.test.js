'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

test('predictionReplay smoke test on synthetic matches', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  const matchesPath = path.join(tmpDir, 'matches.json');
  const synth = {
    m1: {
      league: 'Premier',
      statsLevel: 'detailed',
      predictions: {
        decision60: {
          predictionType: 'FT_TM05_FROM_60_75',
          mode: 'detailed_ai',
          modelMode: 'detailed_ai',
          finalScore: 85,
          confidence: 0.75,
          riskFlags: ['low_snapshot_count'],
          predictionAudit: { hit: true },
        },
      },
    },
    m2: {
      league: 'Bundesliga',
      statsLevel: 'detailed',
      predictions: {
        decision60: {
          predictionType: 'LEAN_FT_TM05_FROM_60_75',
          mode: 'detailed',
          modelMode: 'detailed',
          finalScore: 65,
          confidence: 0.62,
          riskFlags: ['red_card'],
          predictionAudit: { hit: false },
        },
      },
    },
  };
  fs.writeFileSync(matchesPath, JSON.stringify(synth));

  const outPath = path.join(tmpDir, 'report.json');
  const script = path.join(__dirname, '..', 'scripts', 'predictionReplay.js');
  execSync(`node "${script}" "${matchesPath}" --out="${outPath}"`, { stdio: 'pipe' });

  const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(report.totals.n, 2);
  assert.equal(report.totals.hits, 1);
  assert.equal(report.byMode['detailed_ai'].n, 1);
  assert.equal(report.byScoreBand['85+'].n, 1);
  assert.equal(report.byConfidenceBand['0.70-0.82'].n, 1);
  assert.ok(report.riskFlagImpact.red_card);
  assert.equal(report.riskFlagImpact.red_card.with.n, 1);
  assert.equal(report.riskFlagImpact.red_card.with.hits, 0);
  assert.equal(report.riskFlagImpact.red_card.without.n, 1);
  assert.equal(report.riskFlagImpact.red_card.without.hits, 1);
});
