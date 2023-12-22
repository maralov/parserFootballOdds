function createPredictionMessage(matches) {
  let messageText = `*Сегодня матчи (new):*\n`;
  matches.forEach((match, index) => {
    messageText += `${index + 1}. 🕐 ${match.date}, *${match.teamHome} - ${match.teamAway}* (${
      match.country
    }) \n Прогноз: _${match.prediction}_ \n [Деталі](${match.url})\n`;
  });
  return messageText;
}

module.exports = createPredictionMessage;
