'use strict';

const env = require('../config/env');
const { fetchResilient } = require('../fetcher/resilientFetcher');
const { parseLiveBoard } = require('../parser/liveBoardParser');
const { selectCandidates } = require('../parser/candidateSelector');
const { appendCandidates } = require('../store/datasetStore');
const { writeCycle } = require('../store/cycleLog');
const { writeAlert } = require('../store/alertLog');
const { emit: emitAlert } = require('../observability/domAlerts');
const { computeSleep } = require('./computeSleep');
const { printCycle, printTracking } = require('../observability/display');
const matchStore = require('../store/matchStore');
const metrics = require('../observability/metrics');
const logger = require('../observability/logger');
const { enrichBatch } = require('../enrichment/enrichBatch');
const { saveEnrichment } = require('../store/enrichmentStore');
const trackingScheduler = require('../tracker/trackingScheduler');

let _cycleId = 0;

async function runOnce() {
  const cycleId = ++_cycleId;
  const cycleStart = Date.now();

  const result = {
    cycleId,
    candidates: [],
    potentialSleepers: [],
    health: { totalRows: 0, totalZeroZero: 0, parseErrors: 0 },
    sleepMs: env.LIVE_FALLBACK_SLEEP_MS,
    sleepReason: 'not yet computed',
    nearestMatch: null,
    source: 'unknown',
    saved: { added: 0, skipped: 0, addedIds: [] },
    enrichment: null,
    durationMs: 0,
    error: null,
  };

  try {
    const { html, status, source } = await fetchResilient(env.LIVE_BASE_URL);
    result.source = source;

    let parsed;
    try {
      parsed = parseLiveBoard(html);
    } catch (parseErr) {
      const alertEvent = emitAlert('parseThrew', { err: parseErr.message });
      writeAlert(alertEvent);
      metrics.incrementErrors();
      result.error = parseErr.message;
      return finalize(result, cycleStart);
    }

    const { matches, health } = parsed;
    result.health = health;

    if (health.totalRows === 0) {
      const alertEvent = emitAlert('noScoreData', { source, htmlLength: html.length });
      writeAlert(alertEvent);
      metrics.incrementErrors();
      return finalize(result, cycleStart);
    }

    const { candidates, potentialSleepers } = selectCandidates(matches, cycleId);
    result.candidates = candidates;
    result.potentialSleepers = potentialSleepers;

    if (candidates.length > 0) {
      const saveResult = appendCandidates(candidates);
      result.saved = saveResult;
      metrics.incrementCandidates(saveResult.added);

      if (env.LIVE_ENRICHMENT_ENABLED && saveResult.added > 0) {
        const newCandidates = candidates.filter(c => saveResult.addedIds.includes(c.matchId));
        try {
          const enrichResults = await enrichBatch(newCandidates, cycleId);
          const enrichSave = saveEnrichment(enrichResults);
          result.enrichment = { results: enrichResults, saved: enrichSave };

          // Stage 3: register newly enriched candidates for snapshot tracking
          if (env.LIVE_TRACKER_ENABLED) {
            const enrichedItems = enrichResults.filter(r => r.status === 'enriched');
            for (const item of enrichedItems) {
              try {
                // Attach discoveredAt from the original candidate
                const candidate = newCandidates.find(c => c.matchId === item.matchId);
                if (candidate?.discoveredAt) {
                  item.discoveredAt = candidate.discoveredAt;
                }
                if (env.LIVE_REQUIRE_DETAILED_STATS && item.statsLevel === 'basic') {
                  logger.info('runOnce: skipping basic-stats match — no xG available', { matchId: item.matchId, statsLevel: item.statsLevel });
                  item.status = 'skipped:no_detailed_stats';
                  continue;
                }
                trackingScheduler.register(item);
              } catch (regErr) {
                logger.warn('Tracker register error', { matchId: item.matchId, err: regErr.message });
              }
            }
          }
        } catch (err) {
          logger.error('Enrichment batch error', { err: err.message });
          result.enrichment = { results: [], saved: { written: 0, skipped: 0 } };
        }
      }
    }

    const { sleepMs, reason, nearestMatch } = computeSleep(potentialSleepers, candidates.length > 0);
    result.sleepMs = sleepMs;
    result.sleepReason = reason;
    result.nearestMatch = nearestMatch;

  } catch (err) {
    logger.error('Cycle error', { err: err.message });
    metrics.incrementErrors();
    result.error = err.message;
  }

  return finalize(result, cycleStart);
}

function finalize(result, cycleStart) {
  result.durationMs = Date.now() - cycleStart;
  metrics.incrementCycles();

  writeCycle({
    cycleId: result.cycleId,
    totalRows: result.health.totalRows,
    zeroZero: result.health.totalZeroZero,
    candidates: result.candidates.length,
    sleepers: result.potentialSleepers.length,
    sleepMs: result.sleepMs,
    sleepReason: result.sleepReason,
    source: result.source,
    durationMs: result.durationMs,
    error: result.error,
  });

  printCycle({
    cycleId: result.cycleId,
    url: env.LIVE_BASE_URL,
    source: result.source,
    health: result.health,
    candidates: result.candidates,
    potentialSleepers: result.potentialSleepers,
    saved: result.saved,
    enrichment: result.enrichment,
    sleepMs: result.sleepMs,
    sleepReason: result.sleepReason,
    nearestMatch: result.nearestMatch,
    durationMs: result.durationMs,
    error: result.error,
  });

  // Stage 3: print snapshot tracking status
  if (env.LIVE_TRACKER_ENABLED) {
    try {
      const allMatches = Object.values(matchStore.readStore());
      // Show matches updated in last 90 min or still active
      const recent = allMatches.filter(m => {
        if (m.tracking?.status === 'active') return true;
        const last = m.snapshots?.[m.snapshots.length - 1]?.capturedAt;
        if (!last) return false;
        return Date.now() - new Date(last).getTime() < 90 * 60_000;
      });
      if (recent.length > 0) {
        printTracking(recent, trackingScheduler.activeCount());
      }
    } catch (_) {
      // non-critical, don't break cycle
    }
  }

  return result;
}

module.exports = { runOnce };
