'use strict';

// Day-level tally + summary for the 1HUNDER (ТМ 0,5 першого тайму) line.
// Reads the day's tg-outbox records (status/result.hit) and produces:
//   • a one-line running tally appended to each HT result reply
//   • a full end-of-day summary message
// Pure functions — the dispatcher supplies the records and sends the text.

const { escapeMarkdownV2 } = require('./markdown');

/**
 * Tally the day's 1HUNDER outcomes from outbox records.
 * Counts both tm05_1h (UNDER) and tb05_1h (OVER) records.
 * @param {Array} records  tg-outbox entries
 * @param {{matchId?:string, hit?:boolean, decisionKey?:string}} [override]  treat this match as just
 *   settled with `hit` (used while resolving the current match, still 'pending').
 *   `decisionKey` in override defaults to 'tm05_1h' for backward compat.
 * @returns {{signals:number,hits:number,misses:number,pending:number,settled:number,dryRate:(number|null),under:Object,over:Object,byAvailability:Object}}
 */
function tally1H(records, override = {}) {
  const total = { signals: 0, hits: 0, misses: 0, pending: 0 };
  const under = { signals: 0, hits: 0, misses: 0, pending: 0 };
  const over  = { signals: 0, hits: 0, misses: 0, pending: 0 };
  const avail = {
    rich:    { signals: 0, hits: 0, misses: 0 },
    partial: { signals: 0, hits: 0, misses: 0 },
    none:    { signals: 0, hits: 0, misses: 0 },
  };

  for (const r of records || []) {
    const dk = r?.decisionKey;
    if (dk !== 'tm05_1h' && dk !== 'tb05_1h') continue;
    const bucket = dk === 'tb05_1h' ? over : under;
    total.signals += 1;
    bucket.signals += 1;

    let hit = r?.result?.hit;
    let resolved = r?.status === 'resolved' && typeof hit === 'boolean';
    if (override.matchId && r.matchId === override.matchId) {
      // Default override decisionKey to tm05_1h for backward compat
      const overrideDk = override.decisionKey || 'tm05_1h';
      if (dk === overrideDk) {
        hit = override.hit;
        resolved = typeof override.hit === 'boolean';
      }
    }

    if (resolved) {
      if (hit) { total.hits += 1; bucket.hits += 1; }
      else { total.misses += 1; bucket.misses += 1; }

      // data_availability split (from outbox entry, added in dispatcher buildOutboxPayload)
      const da = r?.dataAvailability;
      const daKey = avail[da] ? da : 'none';
      avail[daKey].signals += 1;
      if (hit) avail[daKey].hits += 1;
      else avail[daKey].misses += 1;
    } else {
      total.pending += 1;
      bucket.pending += 1;
    }
  }

  function rate(s) {
    const settled = s.hits + s.misses;
    return settled > 0 ? s.hits / settled : null;
  }

  return {
    signals: total.signals,
    hits: total.hits,
    misses: total.misses,
    pending: total.pending,
    settled: total.hits + total.misses,
    dryRate: rate(total),   // backward compat name
    under: { ...under, settled: under.hits + under.misses, rate: rate(under) },
    over:  { ...over,  settled: over.hits  + over.misses,  rate: rate(over) },
    byAvailability: {
      rich:    { ...avail.rich,    settled: avail.rich.hits    + avail.rich.misses,    rate: rate(avail.rich) },
      partial: { ...avail.partial, settled: avail.partial.hits + avail.partial.misses, rate: rate(avail.partial) },
      none:    { ...avail.none,    settled: avail.none.hits    + avail.none.misses,    rate: rate(avail.none) },
    },
  };
}

/** "Сьогодні: 2W/1L · HR 67%" — chars here are MarkdownV2-safe (no escaping). */
function formatDayTallyLine(stats) {
  const pct = stats.dryRate != null ? `${Math.round(stats.dryRate * 100)}%` : '—';
  return `Сьогодні: ${stats.hits}W/${stats.misses}L · HR ${pct}`;
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
  const pct = (r) => r != null ? `${Math.round(r * 100)}%` : '—';

  const lines = [
    `📊 *Підсумок 1H AI* · ${escapeMarkdownV2(String(dateLabel))}`,
    `Сигналів: ${stats.signals}  ·  розіграно: ${stats.settled}`,
    `✅ HIT: ${stats.hits}   ❌ MISS: ${stats.misses}  · HR: ${escapeMarkdownV2(pct(stats.dryRate))}`,
  ];

  // Direction breakdown
  if (stats.signals > 0) {
    const u = stats.under;
    const o = stats.over;
    if (u.signals > 0 || o.signals > 0) {
      lines.push('');
      if (u.signals > 0) {
        lines.push(`🟡 UNDER: ${u.hits}W/${u.misses}L · ${escapeMarkdownV2(pct(u.rate))}`);
      }
      if (o.signals > 0) {
        lines.push(`🟠 OVER: ${o.hits}W/${o.misses}L · ${escapeMarkdownV2(pct(o.rate))}`);
      }
    }
  }

  // Data availability breakdown
  const ba = stats.byAvailability;
  const anyAvailData = ba.rich.settled > 0 || ba.partial.settled > 0 || ba.none.settled > 0;
  if (anyAvailData) {
    lines.push('');
    lines.push('📡 *Data availability:*');
    if (ba.rich.settled > 0)    lines.push(`  rich: ${ba.rich.hits}/${ba.rich.settled} \\(${escapeMarkdownV2(pct(ba.rich.rate))}\\)`);
    if (ba.partial.settled > 0) lines.push(`  partial: ${ba.partial.hits}/${ba.partial.settled} \\(${escapeMarkdownV2(pct(ba.partial.rate))}\\)`);
    if (ba.none.settled > 0)    lines.push(`  none: ${ba.none.hits}/${ba.none.settled} \\(${escapeMarkdownV2(pct(ba.none.rate))}\\)`);
  }

  if (stats.settled > 0) {
    lines.push('');
    const roi = roiPct(stats.dryRate);
    lines.push(`ROI@2,0: ${escapeMarkdownV2((roi >= 0 ? '+' : '') + roi + '%')}`);
  }

  if (stats.pending > 0) {
    lines.push(`Очікують: ${stats.pending}`);
  }

  return lines.join('\n');
}

module.exports = { tally1H, formatDayTallyLine, formatDaySummary1H, roiPct };
