function formatTelegramMessage(match, prediction) {
  const { home, away, league, score } = match;
  const { bet, confidence, zone, reason } = prediction;

  const emojiMap = {
    'OVER_0_5': '📈',
    'UNDER_0_5': '📉',
    'SKIP': '⏸️',
  };

  const confidenceMap = {
    'max': '🔥 МАКСИМАЛЬНА',
    'strong': '💪 СИЛЬНА',
    'medium': '⚖️ СЕРЕДНЯ',
    'low': '⚠️ НИЗЬКА',
  };

  const emoji = emojiMap[bet] || '⚽';
  const confidenceText = confidenceMap[confidence] || confidence;

  return `${emoji} *Прогноз на матч*

🏆 ${home} - ${away}
📊 Ліга: ${league}
⚽ Рахунок: ${score.home}:${score.away}

🎯 *Прогноз:* ${bet === 'OVER_0_5' ? 'OVER 0.5' : bet === 'UNDER_0_5' ? 'UNDER 0.5' : 'SKIP'}
📊 *Зона інтенсивності:* ${zone}
💪 *Впевненість:* ${confidenceText}

📝 *Причина:* ${reason}`;
}

module.exports = formatTelegramMessage;


