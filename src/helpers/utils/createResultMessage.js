function createResultMessage(dayProfit) {
  return `
  Результаты за вчерашний день (new):\n📅: ${dayProfit.date}\n🔢 Всего матчей: ${dayProfit.total}\n✅ : ${
    dayProfit.win
  }\n❌ : ${dayProfit.lose}\n💰 : ${(dayProfit.profit * 5).toFixed(2)}% к банку.\n 🏦 Банк: ${(
    dayProfit.totalProfit * 5
  ).toFixed(2)}%`;
}

module.exports = createResultMessage;
