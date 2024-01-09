function createPredictionMessage(matches) {
  const sortedMatches = matches.sort((a, b) => {
    const timeA = a.date.split(':').map(Number);
    const timeB = b.date.split(':').map(Number);
    return timeA[0] * 60 + timeA[1] - (timeB[0] * 60 + timeB[1]);
  });

  let messageText = `*Сегодня матчи (new):*\n`;
  sortedMatches.forEach((match, index) => {
    messageText += `${index + 1}. 🕐 ${match.date}, ${match.teamHome} - ${match.teamAway} (${
      match.country
    })\nPrediction: *${match.prediction}*\n[Match details](${match.url})\n`;
  });
  return messageText;
}

module.exports = createPredictionMessage;
