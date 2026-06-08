'use strict';
process.env.MATCHSTORE_DEBOUNCE_MS = '0'; // flush synchronously for the test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const matchStore = require('../src/store/matchStore');

const DATE = new Date('2099-09-02T12:00:00Z');
const MATCH_ID = 'backfill-test-1';

function cleanup() {
  try {
    matchStore.flushSync(DATE); // clear dirty so the exit handler won't rewrite the file
    const dir = matchStore.dayLogsAbsolute(DATE);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

test('backfill baseline1H preserves snapshots and predictions', () => {
  cleanup();

  // 1) 1H worker registers at ~15' — no clean baseline1H yet.
  const early = {
    matchId: MATCH_ID,
    status: 'enriched',
    homeTeam: 'H', awayTeam: 'A',
    odds: { isOddsFavorite: { favorite: 'home' } },
    statsLevel: 'detailed',
    statistics: null,
  };
  const rec1 = matchStore.upsertFromEnrichment(early, DATE);
  assert.equal(rec1.baseline1H, null);
  assert.equal(rec1.tracking.discardReason, 'missing_baseline_1h');

  // The 1H worker keeps the record active and accrues snapshots + a decision.
  const store = matchStore.readStore(DATE);
  store[MATCH_ID].tracking.status = 'active';
  store[MATCH_ID].tracking.discardReason = null;
  matchStore.writeStore(store, DATE);

  matchStore.appendSnapshot(MATCH_ID, {
    phase: '1H', minute: 24, observedMinute: 24, capturedAt: new Date().toISOString(),
    scoreHome: 0, scoreAway: 0, cumulative: { expectedGoalsXg: { home: 0.1, away: 0.1 } },
  }, null, DATE);
  matchStore.setTm05_1hDecision(MATCH_ID, { phase: 'signal', dsScore: 82 }, DATE);

  // 2) At halftime the match is re-enriched with full 1H stats → backfill.
  const atHt = {
    matchId: MATCH_ID,
    status: 'enriched',
    homeTeam: 'H', awayTeam: 'A',
    odds: { isOddsFavorite: { favorite: 'home' } },
    statsLevel: 'detailed',
    statistics: {
      '1half': {
        home: { totalShots: 5, shotsOnTarget: 1, expectedGoalsXg: 0.3 },
        away: { totalShots: 2, shotsOnTarget: 0, expectedGoalsXg: 0.1 },
      },
    },
  };
  const rec2 = matchStore.upsertFromEnrichment(atHt, DATE);

  assert.ok(rec2.baseline1H, 'baseline1H should be backfilled');
  assert.equal(rec2.baseline1H.totalShots.home, 5);
  assert.equal(rec2.tracking.status, 'active');
  // Preserved across backfill:
  assert.equal(rec2.snapshots.length, 1);
  assert.equal(rec2.predictions.tm05_1h.phase, 'signal');
  assert.equal(rec2.predictions.tm05_1h.dsScore, 82);

  cleanup();
});
