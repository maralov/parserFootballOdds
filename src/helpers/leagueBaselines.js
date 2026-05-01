'use strict';

const DEFAULT_LEAGUE_BASELINE = 0.50;

const LEAGUE_BASELINES = {
  'італія: серія а': 0.58,
  'italy: serie a': 0.58,
  'франція: ліга 1': 0.55,
  'france: ligue 1': 0.55,
  'іспанія: ла ліга': 0.54,
  'spain: la liga': 0.54,
  'португалія: прімейра ліга': 0.55,
  'ukraine: premier league': 0.56,
  "україна: прем'єр-ліга": 0.56,
  'німеччина: бундесліга': 0.42,
  'germany: bundesliga': 0.42,
  'нідерланди: ередівізі': 0.40,
  'netherlands: eredivisie': 0.40,
  'сша: mls': 0.43,
  'usa: mls': 0.43,
};

function normalize(name) {
  if (!name) return '';
  return String(name).toLowerCase().trim();
}

function getLeagueBaseline(leagueName) {
  const key = normalize(leagueName);
  if (!key) return DEFAULT_LEAGUE_BASELINE;
  if (LEAGUE_BASELINES[key] !== undefined) return LEAGUE_BASELINES[key];
  for (const [k, v] of Object.entries(LEAGUE_BASELINES)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return DEFAULT_LEAGUE_BASELINE;
}

module.exports = { getLeagueBaseline, DEFAULT_LEAGUE_BASELINE, LEAGUE_BASELINES };
