/**
 * Груба класифікація ліги для м’якших/жорсткіших гейтів (топ-5 + єврокубки).
 * Рядки з Flashscore UA зазвичай містять країну великими літерами.
 */
const TOP_PATTERNS = [
  /англія/i,
  /іспанія/i,
  /німеччин/i,
  /італія/i,
  /франція/i,
  /premier\s*league/i,
  /champions/i,
  /ліга\s*чемпіонів/i,
  /європа/i,
  /europa\s*league/i,
  /bundes/i,
  /serie\s*a\b/i,
  /la\s*liga/i,
  /ligue\s*1/i,
];

function isTopTierLeague(league) {
  if (!league || typeof league !== 'string') return false;
  return TOP_PATTERNS.some((p) => p.test(league));
}

module.exports = { isTopTierLeague, TOP_PATTERNS };
