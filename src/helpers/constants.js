const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
];

const BASE_URL = 'https://www.flashscore.com/football/';
const LIVE_BASE_URL = process.env.LIVE_BASE_URL || 'https://m.flashscore.ua/?s=2';
const LIVE_BASE_URL_ALT = process.env.LIVE_BASE_URL_ALT || null;
const LIVE_POLL_INTERVAL_MS = Number(process.env.LIVE_POLL_INTERVAL_MS || 180000);
const STATS_CONCURRENCY = Number(process.env.STATS_CONCURRENCY || 2);
const MAX_TELEGRAM_MINUTE = 90;
/** Мінімальна хвилина матчу для відбору кандидата (0–120). Env: LIVE_MIN_CANDIDATE_MINUTE */
const _rawMinCand = Number(process.env.LIVE_MIN_CANDIDATE_MINUTE);
const LIVE_MIN_CANDIDATE_MINUTE = Math.min(
  120,
  Math.max(0, Number.isFinite(_rawMinCand) ? _rawMinCand : 60)
);
const LIVE_IGNORE_HOURS = /^(1|true|yes)$/i.test(String(process.env.LIVE_IGNORE_HOURS || ''));
const { hour: dHour, dayOfWeek } = require('./date');

function isWithinWorkingHours(date) {
  if (LIVE_IGNORE_HOURS) return true;
  const h = dHour(date);
  const day = dayOfWeek(date);
  const isWeekend = day === 0 || day === 5 || day === 6;
  const startHour = isWeekend ? 16 : 17;
  return h >= startHour && h < 23;
}

const USER_AGENT = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

module.exports = {
  USER_AGENTS, USER_AGENT, BASE_URL,
  LIVE_BASE_URL, LIVE_BASE_URL_ALT, LIVE_POLL_INTERVAL_MS, STATS_CONCURRENCY,
  MAX_TELEGRAM_MINUTE,
  LIVE_MIN_CANDIDATE_MINUTE,
  isWithinWorkingHours,
};
