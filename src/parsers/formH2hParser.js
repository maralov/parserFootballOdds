/**
 * Парсинг вкладки m.flashscore «форма + очні» (#commentary-mobi): h4 + table.h2h.
 * Чисті функції — тестуються без браузера.
 */

function normalizeText(s) {
  return String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(s) {
  return normalizeText(s).toLowerCase();
}

function namesLikelyMatch(labelFromH4, matchSideName) {
  const a = normalizeName(labelFromH4);
  const b = normalizeName(matchSideName);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function parseDdMmYyyy(dateStr) {
  const m = String(dateStr || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const y = Number(m[3]);
  const dt = new Date(y, mo, d);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/**
 * Витягує рядки з внутрішнього HTML tbody таблиці .h2h.
 * @returns {Array<{ dateStr: string, fixtureLine: string, homeGoals: number, awayGoals: number, totalGoals: number }>}
 */
function parseH2hTableRows(tableInner) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM;
  while ((trM = trRe.exec(tableInner)) !== null) {
    const tr = trM[1];
    const tdMatch = tr.match(/<td[^>]*class="[^"]*data[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (!tdMatch) continue;
    const inner = tdMatch[1];
    const spans = [];
    const spanRe = /<span[^>]*>([\s\S]*?)<\/span>/gi;
    let sm;
    while ((sm = spanRe.exec(inner)) !== null) {
      spans.push(normalizeText(sm[1]));
    }
    if (spans.length < 2) continue;
    const dateStr = spans[0];
    const fixtureLine = spans[1];
    const bMatch = inner.match(/<b[^>]*>([\s\S]*?)<\/b>/i);
    if (!bMatch) continue;
    const scoreText = normalizeText(bMatch[1]);
    const scoreNums = scoreText.match(/(\d+)\s*:\s*(\d+)/);
    if (!scoreNums) continue;
    const homeGoals = Number(scoreNums[1]);
    const awayGoals = Number(scoreNums[2]);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    rows.push({
      dateStr,
      fixtureLine,
      homeGoals,
      awayGoals,
      totalGoals: homeGoals + awayGoals,
    });
  }
  return rows;
}

/**
 * @param {string} commentaryInnerHtml — innerHTML елемента #commentary-mobi
 * @param {string} homeName
 * @param {string} awayName
 * @param {{ maxForm?: number, maxH2h?: number }} [opts]
 */
function parseFormH2hFromCommentaryInnerHtml(commentaryInnerHtml, homeName, awayName, opts = {}) {
  const maxForm = Math.max(1, Math.min(15, opts.maxForm ?? 8));
  const maxH2h = Math.max(1, Math.min(15, opts.maxH2h ?? 8));
  const out = {
    parseOk: false,
    error: null,
    formHome: [],
    formAway: [],
    h2hMutual: [],
    aggregates: { home: null, away: null, mutual: null },
  };

  if (!commentaryInnerHtml || typeof commentaryInnerHtml !== 'string') {
    out.error = 'empty_html';
    return out;
  }

  const re = /<h4[^>]*>([^<]+)<\/h4>\s*<table class="h2h">([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(commentaryInnerHtml)) !== null) {
    const title = normalizeText(m[1]);
    const tableInner = m[2];
    const rows = parseH2hTableRows(tableInner);
    const lastFormRe = /останні матчі\s*:\s*(.+)$/i;
    const mutualRe = /(очні зустрічі|взаємні матчі|head\s*to\s*head|h2h)/i;

    const lm = title.match(lastFormRe);
    if (lm) {
      const teamLabel = normalizeText(lm[1]);
      if (namesLikelyMatch(teamLabel, homeName)) {
        out.formHome = rows.slice(0, maxForm);
      } else if (namesLikelyMatch(teamLabel, awayName)) {
        out.formAway = rows.slice(0, maxForm);
      } else {
        if (!out.formHome.length) out.formHome = rows.slice(0, maxForm);
        else if (!out.formAway.length) out.formAway = rows.slice(0, maxForm);
      }
      continue;
    }
    if (mutualRe.test(title)) {
      out.h2hMutual = rows.slice(0, maxH2h);
      continue;
    }
  }

  if (!out.formHome.length && !out.formAway.length && !out.h2hMutual.length) {
    out.error = 'no_sections_parsed';
    return out;
  }

  out.aggregates.home = aggregateRows(out.formHome);
  out.aggregates.away = aggregateRows(out.formAway);
  out.aggregates.mutual = aggregateRowsWithStaleness(out.h2hMutual);
  out.parseOk = true;
  return out;
}

function aggregateRows(rowList) {
  if (!rowList || rowList.length === 0) return null;
  let sum = 0;
  let u15 = 0;
  let u05 = 0;
  for (const r of rowList) {
    sum += r.totalGoals;
    if (r.totalGoals <= 1) u15 += 1;
    if (r.totalGoals === 0) u05 += 1;
  }
  const n = rowList.length;
  return {
    n,
    avgTotalGoals: Number((sum / n).toFixed(3)),
    shareUnder15: Number((u15 / n).toFixed(3)),
    shareUnder05: Number((u05 / n).toFixed(3)),
  };
}

function aggregateRowsWithStaleness(rowList) {
  const base = aggregateRows(rowList);
  if (!base) return null;
  let newest = null;
  for (const r of rowList) {
    const d = parseDdMmYyyy(r.dateStr);
    if (d && (!newest || d > newest)) newest = d;
  }
  const now = new Date();
  const staleYears = newest
    ? Number(((now - newest) / (365.25 * 24 * 3600 * 1000)).toFixed(2))
    : null;
  return { ...base, newestDateIso: newest ? newest.toISOString().slice(0, 10) : null, staleYears };
}

module.exports = {
  parseFormH2hFromCommentaryInnerHtml,
  parseH2hTableRows,
  normalizeText,
  namesLikelyMatch,
};
