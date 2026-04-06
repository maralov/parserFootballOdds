function getTimingLabel(minute) {
  if (minute <= 65) return '🟢 Раннє вікно';
  if (minute <= 75) return '🟡 Основне вікно';
  if (minute <= 84) return '🟠 Пізнє вікно';
  return '🔴 Занадто пізно';
}

function formatTelegramMessage(match, decision) {
  const { home, away, league, score, minute } = match;
  const { bet, confidence, pGoal, pDry, edge, reason } = decision;

  const betLabel = bet === 'OVER_0_5' ? 'OVER 0.5' : bet === 'UNDER_0_5' ? 'UNDER 0.5' : 'SKIP';
  const emoji = bet === 'OVER_0_5' ? '📈' : bet === 'UNDER_0_5' ? '📉' : '⏸️';

  const confMap = { high: '🔥 Висока', medium: '💪 Середня', low: '⚠️ Низька' };
  const confText = confMap[confidence] || confidence;
  const timing = getTimingLabel(minute);

  return `${emoji} *${betLabel}*

🏆 ${home} - ${away}
📊 ${league}
⚽ Рахунок: ${score.home}:${score.away} (${minute}')
⏱ ${timing}

🎯 *P(гол):* ${pGoal ?? 'N/A'} | *P(сухий):* ${pDry ?? 'N/A'}
💪 *Впевненість:* ${confText}
🧮 *Edge:* ${edge ?? '-'}

📝 ${reason}`;
}

function formatDailySummary(summary) {
  if (!summary) return null;

  return `📊 *Звіт за ${summary.date}*

🔢 Всього матчів: ${summary.totalMatches}
🎯 З прогнозами: ${summary.actionable}
✅ Влучень: ${summary.hits}
❌ Промахів: ${summary.misses}
📈 *Hit-rate:* ${summary.hitRate !== null ? (summary.hitRate * 100).toFixed(1) + '%' : 'N/A'}`;
}

module.exports = { formatTelegramMessage, formatDailySummary };
