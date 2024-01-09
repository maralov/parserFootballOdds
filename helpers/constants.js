const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.104 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.1 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.705.63 Safari/537.36 Edg/88.0.705.6',
];

const BASE_URL = 'https://www.flashscore.com/football/';
const LEAGUES = [
  'austria/admiral-bundesliga',
  'england/premier-league',
  'england/championship',
  'spain/laliga',
  'italy/serie-a',
  'germany/bundesliga',
  'greece/super-league',
  'poland/ekstraklasa',
  'slovakia/nike-liga',
  'slovenia/prva-liga',
  'scotland/premiership',
  'scotland/championship',
  'france/ligue-1',
  'belgium/jupiler-league',
  'norway/eliteserien',
  'denmark/superliga/',
  'netherlands/eredivisie',
  'belgium/jupiler-pro-league',
];

module.exports = {
  USER_AGENTS: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
  BASE_URL,
  LEAGUES,
};
