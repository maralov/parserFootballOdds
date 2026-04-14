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

function envBool(v, defaultValue) {
  if (v === undefined || v === null || String(v).trim() === '') return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function envInt(v, defaultValue) {
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

function envFloat(v, defaultValue) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : defaultValue;
}

/** Вимкнути всі post-decision гейти: LIVE_QUALITY_GATES_ENABLED=0 */
const LIVE_QUALITY_GATES_ENABLED = envBool(process.env.LIVE_QUALITY_GATES_ENABLED, true);

/** Мінімум заповнених primary-метрик для не-SKIP ставки (не плутати з allowDecision). */
const LIVE_BET_MIN_PRIMARY_METRICS = Math.max(
  1,
  Math.min(6, envInt(process.env.LIVE_BET_MIN_PRIMARY_METRICS, 4))
);

/** Додатково до мінімуму primary для ліг поза топ-5 / єврокубками. */
const LIVE_NON_TOP_EXTRA_PRIMARY_METRICS = Math.max(
  0,
  Math.min(3, envInt(process.env.LIVE_NON_TOP_EXTRA_PRIMARY_METRICS, 1))
);

/** ТМ 60–70 лише при statsStatus === both (2H + overall). */
const LIVE_60_70_REQUIRE_BOTH_HALVES = envBool(process.env.LIVE_60_70_REQUIRE_BOTH_HALVES, true);

/** Мінімум |p−0.5| для обраної сторони (після oddsContext). 0 вимикає. */
const LIVE_MIN_DECISION_EDGE = Math.max(
  0,
  envFloat(process.env.LIVE_MIN_DECISION_EDGE, 0.02)
);

/** У 70–80: SKIP якщо обидва пороги ок, але |pGoal−pDry| < margin. За замовчуванням 0; спроба 0.05 через env. */
const LIVE_70_80_TIE_BREAK_MARGIN = Math.max(
  0,
  envFloat(process.env.LIVE_70_80_TIE_BREAK_MARGIN, 0)
);

/** З якої хвилини матчу збирати зрізи raw2H для дельт (MVP). */
const LIVE_SNAPSHOT_MIN_MINUTE = Math.min(
  120,
  Math.max(0, envInt(process.env.LIVE_SNAPSHOT_MIN_MINUTE, 55))
);

/** Гейт ТМ 60–70: SKIP якщо між тиками різкий приріст тиску (дельта 2H). */
const LIVE_SNAPSHOT_BURST_GATE_ENABLED = envBool(process.env.LIVE_SNAPSHOT_BURST_GATE_ENABLED, true);

const LIVE_SNAPSHOT_BURST_MIN_SOT = Math.max(
  0,
  envFloat(process.env.LIVE_SNAPSHOT_BURST_MIN_SOT, 2)
);

const LIVE_SNAPSHOT_BURST_MIN_XG = Math.max(
  0,
  envFloat(process.env.LIVE_SNAPSHOT_BURST_MIN_XG, 0.25)
);

module.exports = {
  USER_AGENTS, USER_AGENT, BASE_URL,
  LIVE_BASE_URL, LIVE_BASE_URL_ALT, LIVE_POLL_INTERVAL_MS, STATS_CONCURRENCY,
  MAX_TELEGRAM_MINUTE,
  LIVE_MIN_CANDIDATE_MINUTE,
  isWithinWorkingHours,
  LIVE_QUALITY_GATES_ENABLED,
  LIVE_BET_MIN_PRIMARY_METRICS,
  LIVE_NON_TOP_EXTRA_PRIMARY_METRICS,
  LIVE_60_70_REQUIRE_BOTH_HALVES,
  LIVE_MIN_DECISION_EDGE,
  LIVE_70_80_TIE_BREAK_MARGIN,
  LIVE_SNAPSHOT_MIN_MINUTE,
  LIVE_SNAPSHOT_BURST_GATE_ENABLED,
  LIVE_SNAPSHOT_BURST_MIN_SOT,
  LIVE_SNAPSHOT_BURST_MIN_XG,
};
