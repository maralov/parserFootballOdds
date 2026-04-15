const { impliedProbabilities } = require('./oddsContext');

/**
 * Ринковий контекст 1X2 (ТЗ §19): фаворит, сила, «опір нічиї», зміщення тиску.
 */
function buildMarketContext(odds1X2) {
  const implied = impliedProbabilities(odds1X2);
  if (!implied) {
    return {
      favoriteSide: null,
      favoriteStrength: null,
      drawResistance: null,
      marketPressureBias: 0,
      impliedProb: null,
    };
  }

  const favIsHome = implied.home >= implied.away;
  const favoriteSide = favIsHome ? 'home' : 'away';
  const favoriteStrength = Number(Math.max(implied.home, implied.away).toFixed(4));
  const drawResistance = Number(implied.draw.toFixed(4));

  // Легкий prior: сильний фаворит → трохи вище очікування голів у кінцівці
  let marketPressureBias = (favoriteStrength - 0.33) * 0.12;
  if (drawResistance > 0.34) marketPressureBias -= 0.04;
  else if (drawResistance < 0.26) marketPressureBias += 0.03;

  marketPressureBias = Number(Math.max(-0.08, Math.min(0.08, marketPressureBias)).toFixed(4));

  return {
    favoriteSide,
    favoriteStrength,
    drawResistance,
    marketPressureBias,
    impliedProb: implied,
  };
}

module.exports = { buildMarketContext };
