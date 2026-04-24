const path = require('path');
const fs = require('fs');
const { getTelegramMarkdownPrefix } = require('../telegramModelTag');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data', 'logs');

function loadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function truncate(str, len) {
  if (!str) return '';
  return str.length <= len ? str : str.slice(0, len - 1) + '…';
}

function pad(str, len, right = false) {
  const s = String(str ?? '');
  if (right) return s.padStart(len, ' ');
  return s.padEnd(len, ' ');
}

function fmtProfit(n) {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n}`;
}

function fmtRoi(r) {
  if (r == null) return '—';
  const pct = Math.round(r * 100);
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct}%`;
}

/**
 * Будує Telegram-повідомлення підсумку дня.
 * @param {string} dateKey — рядок YYYY-MM-DD (ключ сесії)
 */
function formatDailySummaryTelegram(dateKey) {
  const dayDir = path.join(DATA_DIR, dateKey);
  const roi   = loadJson(path.join(dayDir, 'stake_roi.json'));
  const matches = loadJson(path.join(dayDir, 'matches.json'));

  if (!roi) return null;

  // Хвилина першої ставки з matches.json (по matchId)
  const minuteByMatchId = {};
  if (Array.isArray(matches)) {
    for (const m of matches) {
      if (m.matchId && Array.isArray(m.betHistory) && m.betHistory.length > 0) {
        minuteByMatchId[m.matchId] = m.betHistory[0].minute ?? null;
      }
    }
  }

  const { overall, byBetType, byPeriod } = roi;
  const matchRows = roi.matches || [];

  // Заголовок
  const [, mm, dd] = dateKey.split('-');
  const dateLabel = `${dd}.${mm}`;
  const prefix = getTelegramMarkdownPrefix();
  const profitStr = fmtProfit(overall.profit);
  const roiStr = fmtRoi(overall.roi);
  const bankLine = `${overall.bankStart.toLocaleString()} → ${overall.bankEnd.toLocaleString()} (${profitStr})`;

  // Таблиця матчів (monospace)
  const COL_MATCH = 17;
  const COL_BET   = 14;
  const COL_MIN   = 3;
  const COL_RES   = 2;

  const header = `${pad('Матч', COL_MATCH)} ${pad('Ставка', COL_BET)} ${pad('Хв', COL_MIN, true)} ${pad('', COL_RES)}`;
  const divider = '─'.repeat(COL_MATCH + COL_BET + COL_MIN + COL_RES + 3);

  const rows = matchRows.map((m) => {
    const matchName = truncate(`${m.home}–${m.away}`, COL_MATCH);
    const signals = m.uniqueSignals || [];
    if (signals.length === 0) return null;

    return signals.map((s, i) => {
      const betLabel = truncate(`${s.bet} ${s.period || ''}`.trim(), COL_BET);
      const minute = i === 0 ? (minuteByMatchId[m.matchId] ?? '—') : '↩';
      const res = s.hit === true ? '✅' : s.hit === false ? '❌' : '⏳';
      const matchCol = i === 0 ? pad(matchName, COL_MATCH) : pad('', COL_MATCH);
      return `${matchCol} ${pad(betLabel, COL_BET)} ${pad(String(minute), COL_MIN, true)} ${res}`;
    }).join('\n');
  }).filter(Boolean).join('\n');

  // По типу ставки
  const tm = byBetType?.UNDER_0_5;
  const tb = byBetType?.OVER_0_5;
  const tmLine = tm?.total > 0
    ? `ТМ ${tm.wins}/${tm.total} (${fmtRoi(tm.roi)})`
    : null;
  const tbLine = tb?.total > 0
    ? `ТБ ${tb.wins}/${tb.total} (${fmtRoi(tb.roi)})`
    : null;
  const byTypeLine = [tmLine, tbLine].filter(Boolean).join(' · ');

  // По вікнах
  const periodParts = [];
  for (const [period, p] of Object.entries(byPeriod || {})) {
    if (p.total > 0 && period !== 'other') {
      periodParts.push(`${period}: ${p.wins}/${p.total}`);
    }
  }
  const byPeriodLine = periodParts.join(' · ');

  const hitsEmoji = overall.hitRate >= 0.6 ? '🟢' : overall.hitRate >= 0.45 ? '🟡' : '🔴';

  const msg =
    `${prefix}📊 *Підсумок ${dateLabel}*\n\n` +
    `${hitsEmoji} ✅ ${overall.wins} / ❌ ${overall.losses} з ${overall.bets} | Hit ${Math.round((overall.hitRate ?? 0) * 100)}%\n` +
    `💰 Банк: ${bankLine} | ROI ${roiStr}\n\n` +
    (rows
      ? `\`\`\`\n${header}\n${divider}\n${rows}\n\`\`\`\n\n`
      : '') +
    (byTypeLine ? `*Тип:* ${byTypeLine}\n` : '') +
    (byPeriodLine ? `*Вікно:* ${byPeriodLine}` : '');

  return msg;
}

module.exports = { formatDailySummaryTelegram };
