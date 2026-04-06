const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

const BASE_URL = 'https://www.flashscore.com/football/';
const LIVE_BASE_URL = process.env.LIVE_BASE_URL || 'https://m.flashscore.ua/?s=2';
const LIVE_POLL_INTERVAL_MS = Number(process.env.LIVE_POLL_INTERVAL_MS || 600000);
const STATS_CONCURRENCY = Number(process.env.STATS_CONCURRENCY || 2);

const LEAGUES = [
  { country: 'spain', name: 'laliga' },
  { country: 'england', name: 'premier-league' },
  { country: 'italy', name: 'serie-a' },
  { country: 'germany', name: 'bundesliga' },
  { country: 'france', name: 'ligue-1' },
  { country: 'netherlands', name: 'eredivisie' },
  { country: 'portugal', name: 'liga-portugal' },
  { country: 'austria', name: 'bundesliga' },
  { country: 'belgium', name: 'challenger-pro-league' },
  { country: 'denmark', name: '1st-division' },
  { country: 'turkey', name: 'super-lig' },
  { country: 'sweden', name: 'superettan' },
];

const TOP_LEAGUE_KEYWORDS = [
  'прем\'єр-ліга', 'premier league',
  'ла ліга', 'laliga', 'la liga',
  'серія a', 'serie a',
  'бундесліга', 'bundesliga',
  'ліга 1', 'ligue 1',
  'ередивізі', 'eredivisie',
  'ліга португал', 'liga portugal', 'primeira liga',
  'суперліга', 'super lig', 'süper lig',
  'ліга чемпіонів', 'champions league',
  'ліга європи', 'europa league',
];

function isTopLeague(leagueName) {
  const lower = String(leagueName || '').toLowerCase();
  return TOP_LEAGUE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isWeekendDay(date) {
  const day = (date || new Date()).getDay();
  return day === 0 || day === 5 || day === 6;
}

function shouldAnalyzeMatch(leagueName, date) {
  if (!isWeekendDay(date)) return true;
  return isTopLeague(leagueName);
}

const USER_AGENT = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

module.exports = {
  USER_AGENTS,
  USER_AGENT,
  BASE_URL,
  LIVE_BASE_URL,
  LIVE_POLL_INTERVAL_MS,
  STATS_CONCURRENCY,
  LEAGUES,
  TOP_LEAGUE_KEYWORDS,
  isTopLeague,
  isWeekendDay,
  shouldAnalyzeMatch,
};
