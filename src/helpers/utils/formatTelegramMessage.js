function getTimingLabel(minute) {
  if (minute <= 65) return '🟢 Раннє вікно';
  if (minute <= 75) return '🟡 Основне вікно';
  if (minute <= 84) return '🟠 Пізнє вікно';
  return '🔴 Занадто пізно';
}

function formatTelegramMessage(match, decision, desktopUrl) {
  const { home, away, league, score, minute } = match;
  const { bet, confidence, pGoal, pDry, edge, reason } = decision;

  const betLabel = bet === 'OVER_0_5' ? 'ТБ 0,5' : bet === 'UNDER_0_5' ? 'ТМ 0,5' : 'SKIP';
  const emoji = bet === 'OVER_0_5' ? '📈' : bet === 'UNDER_0_5' ? '📉' : '⏸️';

  const confMap = { high: '🔥 Висока', medium: '💪 Середня', low: '⚠️ Низька' };
  const confText = confMap[confidence] || confidence;
  const timing = getTimingLabel(minute);

  let msg = `${emoji} *${betLabel}*

🏆 ${home} - ${away}
📊 ${league}
⚽ Рахунок: ${score.home}:${score.away} (${minute}')
⏱ ${timing}

🎯 *P(гол):* ${pGoal ?? 'N/A'} | *P(сухий):* ${pDry ?? 'N/A'}
💪 *Впевненість:* ${confText}
🧮 *Edge:* ${edge ?? '-'}

📝 ${reason}`;

  if (desktopUrl) {
    msg += `\n\n🔗 [Flashscore](${desktopUrl})`;
  }

  return msg;
}

function formatConfLine(label, data) {
  if (!data || data.total === 0) return null;
  const rate = data.hitRate !== null ? (data.hitRate * 100).toFixed(0) + '%' : '—';
  return `${label}: ${data.hits}/${data.checked} (${rate}) з ${data.total}`;
}

function formatDailySummary(summary) {
  if (!summary) return null;

  const resolved = summary.resolved ?? (summary.hits + summary.misses);
  let msg = `📊 *Звіт за ${summary.date}*

🔢 Всього записів: ${summary.totalMatches}
🎯 З прогнозами: ${summary.actionable}
✅ Влучень: ${summary.hits}
❌ Промахів: ${summary.misses}
📋 З результатом: ${resolved}${resolved < summary.actionable ? ` (ще ${summary.actionable - resolved} без фіналу)` : ''}
📈 *Hit-rate:* ${summary.hitRate !== null ? (summary.hitRate * 100).toFixed(1) + '%' : 'N/A'}`;

  if (summary.byConfidence) {
    const lines = [
      formatConfLine('🔥 High', summary.byConfidence.high),
      formatConfLine('💪 Medium', summary.byConfidence.medium),
      formatConfLine('⚠️ Low', summary.byConfidence.low),
    ].filter(Boolean);
    if (lines.length > 0) {
      msg += '\n\n*По впевненості:*\n' + lines.join('\n');
    }
  }

  return msg;
}

module.exports = { formatTelegramMessage, formatDailySummary };
