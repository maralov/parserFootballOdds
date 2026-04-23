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
/**
 * Мінімальна хвилина матчу для відбору кандидата 0:0 (0–120).
 * За замовчуванням 52 — щоб до початку вікна 60+ встигли накопичитись ≥2 зрізи raw2H між циклами опитування.
 * Env: LIVE_MIN_CANDIDATE_MINUTE
 */
const _rawMinCand = Number(process.env.LIVE_MIN_CANDIDATE_MINUTE);
const LIVE_MIN_CANDIDATE_MINUTE = Math.min(
  120,
  Math.max(0, Number.isFinite(_rawMinCand) ? _rawMinCand : 52)
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

/**
 * З якої хвилини матчу збирати зрізи raw2H для дельт.
 * За замовчуванням узгоджено з LIVE_MIN_CANDIDATE_MINUTE (52), щоб перший цикл кандидата вже писав зріз.
 * Env: LIVE_SNAPSHOT_MIN_MINUTE
 */
const LIVE_SNAPSHOT_MIN_MINUTE = Math.min(
  120,
  Math.max(0, envInt(process.env.LIVE_SNAPSHOT_MIN_MINUTE, 52))
);

/**
 * Пауза (мс) і повторний scrape desktop-статистики в тому ж циклі, якщо вже ≥60′, а зрізів менше ніж LIVE_V2_UNDER_CONFIRM_SNAPSHOTS.
 * 0 = вимкнено (достатньо раннього кандидата + наступних циклів). Env: LIVE_SNAPSHOT_SECOND_PASS_MS
 */
const LIVE_SNAPSHOT_SECOND_PASS_MS = Math.max(
  0,
  Math.min(120000, envInt(process.env.LIVE_SNAPSHOT_SECOND_PASS_MS, 0))
);

/** Початок вікон рішень v2 (60–70, …). Має збігатися з getLiveTimeWindow у liveModelV2. Env: LIVE_DECISION_WINDOW_START_MINUTE */
const LIVE_DECISION_WINDOW_START_MINUTE = Math.min(
  120,
  Math.max(0, envInt(process.env.LIVE_DECISION_WINDOW_START_MINUTE, 60))
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

/** Крок «логічного» сегмента для нормалізації приросту (хв). Env: LIVE_SEGMENT_STEP_MINUTES */
const LIVE_SEGMENT_STEP_MINUTES = Math.max(
  1,
  Math.min(20, envInt(process.env.LIVE_SEGMENT_STEP_MINUTES, 5))
);

/** Макс. зрізів raw2H на матч у пам’яті та в лозі. Env: LIVE_SNAPSHOT_HISTORY_MAX */
const LIVE_SNAPSHOT_HISTORY_MAX = Math.max(
  4,
  Math.min(60, envInt(process.env.LIVE_SNAPSHOT_HISTORY_MAX, 24))
);

/** Кінець вікна «60–70» (хв матчу). Env: LIVE_WINDOW_END_60_70 */
const LIVE_WINDOW_END_60_70 = Math.max(
  61,
  Math.min(89, envInt(process.env.LIVE_WINDOW_END_60_70, 70))
);

/** Кінець вікна «70–80». Має бути > LIVE_WINDOW_END_60_70. Env: LIVE_WINDOW_END_70_80 */
const _rawW80 = envInt(process.env.LIVE_WINDOW_END_70_80, 80);
const LIVE_WINDOW_END_70_80 = Math.max(
  LIVE_WINDOW_END_60_70 + 1,
  Math.min(100, Number.isFinite(_rawW80) ? _rawW80 : 80)
);

/** Мінімум signalQuality для Telegram (0–1). Env: LIVE_V2_MIN_SIGNAL_QUALITY_TELEGRAM */
const LIVE_V2_MIN_SIGNAL_QUALITY_TELEGRAM = Math.max(
  0,
  Math.min(1, envFloat(process.env.LIVE_V2_MIN_SIGNAL_QUALITY_TELEGRAM, 0.4))
);

/** Скільки зрізів потрібно для ТМ у 60–70. Env: LIVE_V2_UNDER_CONFIRM_SNAPSHOTS */
const LIVE_V2_UNDER_CONFIRM_SNAPSHOTS = Math.max(
  1,
  Math.min(8, envInt(process.env.LIVE_V2_UNDER_CONFIRM_SNAPSHOTS, 2))
);

/** Пороги рішень v2 (після applyOddsContext). */
const LIVE_V2_PDRY_MIN_60_70 = Math.max(0.35, Math.min(0.85, envFloat(process.env.LIVE_V2_PDRY_MIN_60_70, 0.52)));
const LIVE_V2_PGOAL_MAX_60_70 = Math.max(0.35, Math.min(0.65, envFloat(process.env.LIVE_V2_PGOAL_MAX_60_70, 0.48)));
const LIVE_V2_PGOAL_MIN_70_80 = Math.max(0.45, Math.min(0.9, envFloat(process.env.LIVE_V2_PGOAL_MIN_70_80, 0.58)));
const LIVE_V2_PDRY_MIN_70_80 = Math.max(0.45, Math.min(0.9, envFloat(process.env.LIVE_V2_PDRY_MIN_70_80, 0.54)));
const LIVE_V2_PGOAL_MIN_80 = Math.max(0.45, Math.min(0.95, envFloat(process.env.LIVE_V2_PGOAL_MIN_80, 0.55)));

/** Золоті фільтри v3.1 — виведено з аналізу 04-15..04-19 (HR 66.7% / 62.5%). */
const LIVE_V3_PDRY_MIN_60_70 = Math.max(0.35, Math.min(0.95, envFloat(process.env.LIVE_V3_PDRY_MIN_60_70, 0.67)));
const LIVE_V3_SQ_MIN_60_70   = Math.max(0,    Math.min(1,    envFloat(process.env.LIVE_V3_SQ_MIN_60_70,   0.77)));
const LIVE_V3_SQ_MIN_70_80   = Math.max(0,    Math.min(1,    envFloat(process.env.LIVE_V3_SQ_MIN_70_80,   0.71)));
/** Мін. кількість зрізів (snapshot) для дозволу ставки. Env: LIVE_V3_MIN_SNAPSHOTS */
const LIVE_V3_MIN_SNAPSHOTS  = Math.max(1,    Math.min(8,    envInt(process.env.LIVE_V3_MIN_SNAPSHOTS,    2)));

/** Adaptive SQ threshold для 60-70 вікна (v3.1).
 *  FALLING: знижка на SQ якщо активність послідовно спадає (consistently_dry).
 *  SLOW:    знижка якщо темп нижчий за середній 2H (vsRatio <= 0.85).
 *  FLOOR:   мінімально допустимий адаптивний поріг SQ.
 *  HEATING: надбавка якщо гра розігрується (heating_up) — захист від хибного ТМ.
 */
const LIVE_V3_SQ_ADAPTIVE_FALLING_DISCOUNT = Math.max(0, Math.min(0.15, envFloat(process.env.LIVE_V3_SQ_ADAPTIVE_FALLING_DISCOUNT, 0.05)));
const LIVE_V3_SQ_ADAPTIVE_SLOW_DISCOUNT    = Math.max(0, Math.min(0.10, envFloat(process.env.LIVE_V3_SQ_ADAPTIVE_SLOW_DISCOUNT,    0.02)));
const LIVE_V3_SQ_ADAPTIVE_FLOOR            = Math.max(0.50, Math.min(0.80, envFloat(process.env.LIVE_V3_SQ_ADAPTIVE_FLOOR,         0.69)));
const LIVE_V3_SQ_ADAPTIVE_HEATING_PREMIUM  = Math.max(0, Math.min(0.10, envFloat(process.env.LIVE_V3_SQ_ADAPTIVE_HEATING_PREMIUM,  0.04)));

/** Kelly Criterion: частка від full Kelly. Env: LIVE_V3_KELLY_FRACTION */
const LIVE_V3_KELLY_FRACTION  = Math.max(0.05, Math.min(1, envFloat(process.env.LIVE_V3_KELLY_FRACTION, 0.25)));
/** Максимальна ставка як частка від банку (0.10 = 10%). Env: LIVE_V3_MAX_STAKE_PCT */
const LIVE_V3_MAX_STAKE_PCT   = Math.max(0.01, Math.min(0.5, envFloat(process.env.LIVE_V3_MAX_STAKE_PCT, 0.10)));
/** Розмір банку для відображення рекомендованої ставки у грн. Env: LIVE_V3_BANK_SIZE */
const LIVE_V3_BANK_SIZE       = Math.max(100,  envFloat(process.env.LIVE_V3_BANK_SIZE, 10000));

/** Сплеск 2H для блокування ТМ 60–70 (як раніше burst gate). Env: LIVE_V2_BURST_* */
const LIVE_V2_BURST_MIN_SOT = Math.max(0, envFloat(process.env.LIVE_V2_BURST_MIN_SOT, LIVE_SNAPSHOT_BURST_MIN_SOT));
const LIVE_V2_BURST_MIN_XG = Math.max(0, envFloat(process.env.LIVE_V2_BURST_MIN_XG, LIVE_SNAPSHOT_BURST_MIN_XG));

/** Пізній сплеск: сегмент vs середнє 2H. Env: LIVE_V2_LATE_SURGE_RATIO */
const LIVE_V2_LATE_SURGE_RATIO = Math.max(1, envFloat(process.env.LIVE_V2_LATE_SURGE_RATIO, 1.18));

/** Форма + H2H з m.match/.../?t=h2h для pre-match bias (v3). Env: LIVE_FORM_H2H_ENABLED */
const LIVE_FORM_H2H_ENABLED = envBool(process.env.LIVE_FORM_H2H_ENABLED, false);
const LIVE_FORM_H2H_MAX_FORM_ROWS = Math.max(3, Math.min(15, envInt(process.env.LIVE_FORM_H2H_MAX_FORM_ROWS, 8)));
const LIVE_FORM_H2H_MAX_H2H_ROWS = Math.max(2, Math.min(15, envInt(process.env.LIVE_FORM_H2H_MAX_H2H_ROWS, 8)));
/** Макс. |Δ basePGoal| від форми/H2H перед applyOddsContext. Env: LIVE_PREMATCH_BIAS_CAP */
const LIVE_PREMATCH_BIAS_CAP = Math.max(0, Math.min(0.12, envFloat(process.env.LIVE_PREMATCH_BIAS_CAP, 0.045)));
/** Тег у Telegram для паралельних серверів / версій. Env: TELEGRAM_MODEL_TAG */
const TELEGRAM_MODEL_TAG = String(process.env.TELEGRAM_MODEL_TAG || 'v3.2').trim();

/** Яку оцінку викликати в worker: v2 | v3. Env: LIVE_EVAL_MODEL */
const LIVE_EVAL_MODEL = String(process.env.LIVE_EVAL_MODEL || 'v2').toLowerCase() === 'v3' ? 'v3' : 'v2';

module.exports = {
  USER_AGENTS, USER_AGENT, BASE_URL,
  LIVE_BASE_URL, LIVE_BASE_URL_ALT, LIVE_POLL_INTERVAL_MS, STATS_CONCURRENCY,
  MAX_TELEGRAM_MINUTE,
  LIVE_MIN_CANDIDATE_MINUTE,
  LIVE_DECISION_WINDOW_START_MINUTE,
  isWithinWorkingHours,
  LIVE_QUALITY_GATES_ENABLED,
  LIVE_BET_MIN_PRIMARY_METRICS,
  LIVE_NON_TOP_EXTRA_PRIMARY_METRICS,
  LIVE_60_70_REQUIRE_BOTH_HALVES,
  LIVE_MIN_DECISION_EDGE,
  LIVE_70_80_TIE_BREAK_MARGIN,
  LIVE_SNAPSHOT_MIN_MINUTE,
  LIVE_SNAPSHOT_SECOND_PASS_MS,
  LIVE_SNAPSHOT_BURST_GATE_ENABLED,
  LIVE_SNAPSHOT_BURST_MIN_SOT,
  LIVE_SNAPSHOT_BURST_MIN_XG,
  LIVE_SEGMENT_STEP_MINUTES,
  LIVE_SNAPSHOT_HISTORY_MAX,
  LIVE_WINDOW_END_60_70,
  LIVE_WINDOW_END_70_80,
  LIVE_V2_MIN_SIGNAL_QUALITY_TELEGRAM,
  LIVE_V2_UNDER_CONFIRM_SNAPSHOTS,
  LIVE_V2_PDRY_MIN_60_70,
  LIVE_V2_PGOAL_MAX_60_70,
  LIVE_V2_PGOAL_MIN_70_80,
  LIVE_V2_PDRY_MIN_70_80,
  LIVE_V2_PGOAL_MIN_80,
  LIVE_V3_PDRY_MIN_60_70,
  LIVE_V3_SQ_MIN_60_70,
  LIVE_V3_SQ_MIN_70_80,
  LIVE_V3_MIN_SNAPSHOTS,
  LIVE_V3_SQ_ADAPTIVE_FALLING_DISCOUNT,
  LIVE_V3_SQ_ADAPTIVE_SLOW_DISCOUNT,
  LIVE_V3_SQ_ADAPTIVE_FLOOR,
  LIVE_V3_SQ_ADAPTIVE_HEATING_PREMIUM,
  LIVE_V3_KELLY_FRACTION,
  LIVE_V3_MAX_STAKE_PCT,
  LIVE_V3_BANK_SIZE,
  LIVE_V2_BURST_MIN_SOT,
  LIVE_V2_BURST_MIN_XG,
  LIVE_V2_LATE_SURGE_RATIO,
  LIVE_FORM_H2H_ENABLED,
  LIVE_FORM_H2H_MAX_FORM_ROWS,
  LIVE_FORM_H2H_MAX_H2H_ROWS,
  LIVE_PREMATCH_BIAS_CAP,
  TELEGRAM_MODEL_TAG,
  LIVE_EVAL_MODEL,
};
