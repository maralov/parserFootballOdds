'use strict';

// Day-level tally + summary for the 1HUNDER (ТМ 0,5 першого тайму) line.
// Reads the day's tg-outbox records (status/result.hit) and produces:
//   • a one-line running tally appended to each HT result reply
//   • a full end-of-day summary message
// Pure functions — the dispatcher supplies the records and sends the text.

const { escapeMarkdownV2 } = require('./markdown');

/**
 * Tally the day's 1HUNDER outcomes from outbox records.
 * @param {Array} records  tg-outbox entries
 * @param {{matchId?:string, hit?:boolean}} [override]  treat this match as just
 *   settled with `hit` (used while resolving the current match, still 'pending').
 * @returns {{signals:number,hits:number,misses:number,pending:number,settled:number,dryRate:(number|null)}}
 */
function tally1H(records, override = {}) {
  let signals = 0;
  let hits = 0;
  let misses = 0;
  let pending = 0;

  for (const r of records || []) {
    if (r?.decisionKey !== 'tm05_1h') continue;
    signals += 1;

    let hit = r?.result?.hit;
    let resolved = r?.status === 'resolved' && typeof hit === 'boolean';
    if (override.matchId && r.matchId === override.matchId) {
      hit = override.hit;
      resolved = typeof override.hit === 'boolean';
    }

    if (resolved) {
      if (hit) hits += 1; else misses += 1;
    } else {
      pending += 1;
    }
  }

  const settled = hits + misses;
  const dryRate = settled > 0 ? hits / settled : null;
  return { signals, hits, misses, pending, settled, dryRate };
}

/** "Сьогодні: 2W/1L · dry 67%" — chars here are MarkdownV2-safe (no escaping). */
function formatDayTallyLine(stats) {
  const pct = stats.dryRate != null ? `${Math.round(stats.dryRate * 100)}%` : '—';
  return `Сьогодні: ${stats.hits}W/${stats.misses}L · dry ${pct}`;
}

/** ROI as a percentage for a flat stake at fixed odds (default 2.0). */
function roiPct(dryRate, odds = 2.0) {
  if (dryRate == null) return null;
  return Math.round((dryRate * odds - 1) * 100);
}

/**
 * Full end-of-day summary message (MarkdownV2).
 * @param {Object} stats   output of tally1H
 * @param {string} dateLabel  e.g. "2026-06-14"
 */
function formatDaySummary1H(stats, dateLabel) {
  const lines = [
    `📊 *Підсумок 1HUNDER* · ${escapeMarkdownV2(String(dateLabel))}`,
    `Сигналів: ${stats.signals}  ·  розіграно: ${stats.settled}`,
    `✅ HIT: ${stats.hits}   ❌ MISS: ${stats.misses}`,
  ];

  if (stats.settled > 0) {
    lines.push(`Сухих: ${Math.round(stats.dryRate * 100)}%`);
    const roi = roiPct(stats.dryRate);
    lines.push(`ROI при 2,0: ${escapeMarkdownV2((roi >= 0 ? '+' : '') + roi + '%')}`);
  } else {
    lines.push('Сухих: —');
  }

  if (stats.pending > 0) {
    lines.push(`Очікують: ${stats.pending}`);
  }

  return lines.join('\n');
}

module.exports = { tally1H, formatDayTallyLine, formatDaySummary1H, roiPct };
