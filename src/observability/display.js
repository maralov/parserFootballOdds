'use strict';

const dayjs = require('dayjs');
const { FLASHSCORE_MOBI_BASE: MOBI_BASE } = require('../config/constants');

function line(char = '─', len = 56) {
  return char.repeat(len);
}

function pad(str, width) {
  return String(str).padEnd(width);
}

/** Build a full clickable URL from a relative matchUrl or matchId. */
function matchLink(matchUrl, matchId) {
  if (matchUrl && matchUrl.startsWith('http')) return matchUrl;
  if (matchUrl) return `${MOBI_BASE}${matchUrl}`;
  if (matchId) return `${MOBI_BASE}/match/${matchId}/?s=2`;
  return '';
}

/**
 * Print a full cycle summary to stdout in human-readable format.
 *
 * @param {{
 *   cycleId: number,
 *   url: string,
 *   source: string,
 *   health: { totalRows: number, totalZeroZero: number, parseErrors: number },
 *   candidates: object[],
 *   potentialSleepers: object[],
 *   saved: { added: number, skipped: number },
 *   enrichment: { results: object[], saved: { written, skipped } }|null,
 *   sleepMs: number,
 *   sleepReason: string,
 *   nearestMatch: object|null,
 *   durationMs: number,
 *   error: string|null,
 * }} data
 */
function printCycle(data) {
  const {
    cycleId, url, source, health,
    candidates, potentialSleepers,
    saved, enrichment, sleepMs, nearestMatch,
    durationMs, error,
  } = data;

  const now = dayjs().format('HH:mm:ss');
  const sleepMin = Math.round(sleepMs / 60_000);
  const nextAt = dayjs().add(sleepMs, 'ms').format('HH:mm');

  console.log('');
  console.log(`${line()} ${now}`);
  console.log(`Run #${cycleId}  |  ${url}  [${source}, ${durationMs}ms]`);
  console.log(`Board: rows=${health.totalRows}  0:0=${health.totalZeroZero}  candidates=${candidates.length}`);

  if (error) {
    console.log(`ERROR: ${error}`);
  }

  if (candidates.length > 0) {
    console.log('');
    console.log(`Candidates (${candidates.length}):`);
    for (const c of candidates) {
      const link = matchLink(c.matchUrl, c.matchId);
      console.log(`  +  ${c.homeTeam} - ${c.awayTeam}  [${c.country}: ${c.league}]  ${c.currentStatus}`);
      console.log(`     ${link}`);
    }
    console.log(`Saved: +${saved.added} new, ${saved.skipped} skipped`);
  } else {
    console.log('No new candidates this cycle.');
  }

  if (potentialSleepers.length > 0) {
    console.log('');
    console.log(`Watching (${potentialSleepers.length} × 0:0 in 1H):`);
    for (const s of potentialSleepers) {
      console.log(`  ~  ${s.homeTeam} - ${s.awayTeam}  @ ${s.minute}'`);
    }
  }

  if (enrichment && enrichment.results && enrichment.results.length > 0) {
    console.log('');
    console.log(`Enrichment (${enrichment.results.length} new):`);
    for (const r of enrichment.results) {
      const link = matchLink(r.matchUrl, r.matchId);
      if (r.status === 'skip:no_stats') {
        console.log(`  -  ${r.matchId}  status=skip:no_stats`);
        console.log(`     ${link}`);
      } else if (r.status === 'enriched') {
        const fav = r.odds?.isOddsFavorite?.favorite
          ? `fav=${r.odds.isOddsFavorite.favorite} (${r.odds[r.odds.isOddsFavorite.favorite]})`
          : 'fav=balanced';
        const strength = r.standings?.favoriteStrength
          ? `  strength=${r.standings.favoriteStrength.label} (${r.standings.favoriteStrength.score})`
          : '';
        console.log(`  +  ${r.matchId}  level=${r.statsLevel || '?'}  ${fav}${strength}`);
        console.log(`     ${link}`);
      } else {
        console.log(`  !  ${r.matchId}  status=${r.status}`);
        console.log(`     ${link}`);
      }
    }
  }

  console.log('');
  if (nearestMatch) {
    console.log(`Next scan: ${nextAt}  (${sleepMin} min)  |  nearest: ${nearestMatch.homeTeam} - ${nearestMatch.awayTeam} @ ${nearestMatch.minute}'`);
  } else {
    console.log(`Next scan: ${nextAt}  (${sleepMin} min)`);
  }
  console.log(line());
}

/**
 * Print watch-mode header once on startup.
 */
function printWatchHeader(url, workingHours) {
  console.log(line('═'));
  console.log(`  LIVE WATCH  |  ${url}`);
  console.log(`  Hours: ${workingHours}  |  Ctrl+C to stop`);
  console.log(line('═'));
}

/**
 * Print waiting-outside-hours message.
 */
function printOutsideHours(nextCheckAt) {
  console.log(`[${dayjs().format('HH:mm')}] Outside working hours. Next check: ${nextCheckAt}`);
}

/**
 * Print shutdown message.
 */
function printShutdown() {
  console.log('\nStopped.');
}

/**
 * Print Stage 3 tracking summary for all active/recently changed tracked matches.
 *
 * @param {Object[]} trackedMatches  array of match records from matchStore
 * @param {number}   activeTimers    count from trackingScheduler.activeCount()
 */
function printTracking(trackedMatches, activeTimers) {
  if (!trackedMatches || !trackedMatches.length) return;

  const now = Date.now();

  console.log('');
  console.log(`Tracking (${activeTimers} timer${activeTimers !== 1 ? 's' : ''} active):`);

  for (const m of trackedMatches) {
    const t = m.tracking;
    const label = `${m.homeTeam} - ${m.awayTeam}`;

    if (t.status === 'discarded') {
      console.log(`  ✗  ${m.matchId}  ${label}  DISCARDED (${t.discardReason})`);
      continue;
    }

    if (t.status === 'finished') {
      const f = m.final;
      const score = f ? `${f.scoreHome}:${f.scoreAway}` : '?:?';
      const verdict = f?.resultTM05 ? 'TM✓' : 'TB✓';
      const d60Out = m.aiAnalysis?.decision60?.output;
      const p00 = d60Out?.probabilities?.p_match_ends_0_0 ?? d60Out?.p_match_ends_0_0;
      const aiSummary = p00 != null ? `  (p00=${p00})` : '';
      console.log(`  ✓  ${m.matchId}  ${label}  FINISHED ${score}  ${verdict}${aiSummary}`);
      continue;
    }

    if (t.status === 'stale') {
      console.log(`  !  ${m.matchId}  ${label}  STALE (${t.discardReason || 'unknown'})`);
      continue;
    }

    // active
    const lastSnap = m.snapshots?.[m.snapshots.length - 1];
    const minute  = lastSnap ? `@ ${lastSnap.minute}'` : 'pending';
    const score   = lastSnap ? `${lastSnap.scoreHome}:${lastSnap.scoreAway}` : '0:0';
    const valid   = t.validForPrediction ? '  valid✓' : '';

    let statsInfo = '';
    if (lastSnap?.cumulative?.totalShots) {
      const sh = lastSnap.cumulative.totalShots;
      statsInfo = `  shots:${sh.home ?? '?'}/${sh.away ?? '?'}`;
    }
    if (lastSnap?.cumulative?.expectedGoalsXg) {
      const xg = lastSnap.cumulative.expectedGoalsXg;
      if (xg.home != null) statsInfo += `  xG:${xg.home}/${xg.away}`;
    }

    let nextInfo = '  next: unscheduled';
    if (t.nextSnapshotAt) {
      const diffMs   = new Date(t.nextSnapshotAt).getTime() - now;
      const diffMins = Math.floor(Math.abs(diffMs) / 60_000);
      const diffSecs = Math.floor((Math.abs(diffMs) % 60_000) / 1000);
      const prefix   = diffMs < 0 ? 'overdue ' : '';
      nextInfo = `  next: ${prefix}${diffMins}:${String(diffSecs).padStart(2, '0')}`;
    }

    let aiInfo = '';
    if (m.aiAnalysis) {
      const tag = (checkpoint) => {
        const value = m.aiAnalysis[checkpoint];
        if (value === undefined || value === null) return '—';
        if (value.skipped) return 'skip';
        if (value.error) return 'X';
        if (value.output) return '✓';
        return '…';
      };
      aiInfo = `  AI:HT${tag('halftime')} D60${tag('decision60')} D80${tag('decision80')}`;
    }

    console.log(`  ~  ${m.matchId}  ${label}  ${minute}  ${score}${valid}${statsInfo}${aiInfo}${nextInfo}`);
  }
}

/**
 * Print a single, prominent live event line for tracker/AI activity.
 *
 * Format:
 *   [HH:MM:SS] CAT | MatchLabel | message | k=v k=v
 *
 * @param {string} category   short tag, e.g. "tracker" or "ai"
 * @param {string} label      "Home - Away" or matchId
 * @param {string} message    short status, e.g. "snapshot @50'  0:0"
 * @param {Object} [extra]    flat object of extra fields to render as k=v
 */
function printEvent(category, label, message, extra) {
  const stamp = dayjs().format('HH:mm:ss');
  let extras = '';
  if (extra && typeof extra === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null) continue;
      parts.push(`${k}=${v}`);
    }
    if (parts.length) extras = `  ${parts.join(' ')}`;
  }
  console.log(`[${stamp}] ${pad(category, 7)} | ${label} | ${message}${extras}`);
}

module.exports = { printCycle, printTracking, printEvent, printWatchHeader, printOutsideHours, printShutdown };
