'use strict';

require('dotenv').config();
const { FLASHSCORE_LIVE_URL } = require('./constants');

function envBool(key, def) {
  const v = process.env[key];
  if (v === undefined || v === null || v.trim() === '') return def;
  return /^(1|true|yes|on)$/i.test(v);
}

function envInt(key, def) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const env = {
  LIVE_BASE_URL: process.env.LIVE_BASE_URL || FLASHSCORE_LIVE_URL,
  LIVE_IGNORE_HOURS: envBool('LIVE_IGNORE_HOURS', false),
  LIVE_WORKING_HOURS_START: envInt('LIVE_WORKING_HOURS_START', 16),
  LIVE_WORKING_HOURS_END: envInt('LIVE_WORKING_HOURS_END', 23),
  LIVE_MIN_SLEEP_MS: envInt('LIVE_MIN_SLEEP_MS', 60_000),
  LIVE_MAX_SLEEP_MS: envInt('LIVE_MAX_SLEEP_MS', 480_000),
  LIVE_FALLBACK_SLEEP_MS: envInt('LIVE_FALLBACK_SLEEP_MS', 300_000),
  LIVE_TARGET_MINUTE: envInt('LIVE_TARGET_MINUTE', 44),
  LIVE_HTTP_MAX_RETRIES: envInt('LIVE_HTTP_MAX_RETRIES', 3),
  LIVE_HTTP_BASE_DELAY_MS: envInt('LIVE_HTTP_BASE_DELAY_MS', 1_000),
  LIVE_BROWSER_TIMEOUT_MS: envInt('LIVE_BROWSER_TIMEOUT_MS', 30_000),
  LIVE_BROWSER_MAX_LIFETIME_MS: envInt('LIVE_BROWSER_MAX_LIFETIME_MS', 600_000),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  // Stage 2 — enrichment
  LIVE_ENRICHMENT_ENABLED: envBool('LIVE_ENRICHMENT_ENABLED', true),
  LIVE_ENRICHMENT_CONCURRENCY: envInt('LIVE_ENRICHMENT_CONCURRENCY', 3),
  LIVE_ENRICHMENT_TIMEOUT_MS: envInt('LIVE_ENRICHMENT_TIMEOUT_MS', 15_000),
  LIVE_ENRICHMENT_DELAY_MIN_MS: envInt('LIVE_ENRICHMENT_DELAY_MIN_MS', 500),
  LIVE_ENRICHMENT_DELAY_MAX_MS: envInt('LIVE_ENRICHMENT_DELAY_MAX_MS', 1_500),
  LIVE_ODDS_FAVORITE_THRESHOLD: Number(process.env.LIVE_ODDS_FAVORITE_THRESHOLD) || 1.8,
  LIVE_REQUIRE_DETAILED_STATS: envBool('LIVE_REQUIRE_DETAILED_STATS', true),

  // Stage 3 — snapshot tracker
  LIVE_TRACKER_ENABLED: envBool('LIVE_TRACKER_ENABLED', true),
  LIVE_TRACKER_CONCURRENCY: envInt('LIVE_TRACKER_CONCURRENCY', 2),
  // Deprecated: cadence now starts from halftime buckets, not discoveredAt offset.
  LIVE_TRACKER_FIRST_SNAPSHOT_OFFSET_MS: envInt('LIVE_TRACKER_FIRST_SNAPSHOT_OFFSET_MS', 18 * 60_000),
  // Interval between regular snapshots (5 min)
  LIVE_TRACKER_INTERVAL_MS: envInt('LIVE_TRACKER_INTERVAL_MS', 5 * 60_000),
  // Random ±jitter added to each scheduled time (15 s)
  LIVE_TRACKER_JITTER_MS: envInt('LIVE_TRACKER_JITTER_MS', 15_000),
  // Retry delay when match is still in halftime (2 min)
  LIVE_TRACKER_HALFTIME_RETRY_MS: envInt('LIVE_TRACKER_HALFTIME_RETRY_MS', 2 * 60_000),
  // Hard timeout from discoveredAt after which match is marked stale (120 min)
  LIVE_TRACKER_HARD_TIMEOUT_MS: envInt('LIVE_TRACKER_HARD_TIMEOUT_MS', 120 * 60_000),
  // Consecutive fetch failures before marking stale
  LIVE_TRACKER_MAX_FAILURES: envInt('LIVE_TRACKER_MAX_FAILURES', 3),
  // Goals before this minute → discard
  LIVE_TRACKER_DISCARD_BEFORE_MINUTE: envInt('LIVE_TRACKER_DISCARD_BEFORE_MINUTE', 60),
  // validForPrediction is set when we reach this minute with 0:0
  LIVE_TRACKER_VALID_FROM_MINUTE: envInt('LIVE_TRACKER_VALID_FROM_MINUTE', 60),

  // Stage 4 — AI enrichment
  LIVE_AI_ENABLED: envBool('LIVE_AI_ENABLED', false),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  LIVE_AI_MODEL: process.env.LIVE_AI_MODEL || 'gpt-4o',
  LIVE_AI_MAX_RETRIES: envInt('LIVE_AI_MAX_RETRIES', 2),
  LIVE_AI_TIMEOUT_MS: envInt('LIVE_AI_TIMEOUT_MS', 15_000),
  LIVE_AI_WEB_SEARCH_TIMEOUT_MS: envInt('LIVE_AI_WEB_SEARCH_TIMEOUT_MS', 90_000),
  LIVE_AI_TEMPERATURE: Number(process.env.LIVE_AI_TEMPERATURE) || 0.2,
  LIVE_AI_MAX_TOKENS: envInt('LIVE_AI_MAX_TOKENS', 2500),

  LIVE_AI_REEVAL_MIN_GAP_MIN: envInt('LIVE_AI_REEVAL_MIN_GAP_MIN', 10),
  LIVE_PRED_BASIC_DS_MIN: envInt('LIVE_PRED_BASIC_DS_MIN', 70),
  // Minimum Pressure Score to proceed to AI for Line B (TB 0.5). Calibrated at 35 on 63 samples.
  LIVE_PS_THRESHOLD_AI: envInt('LIVE_PS_THRESHOLD_AI', 35),

  // Stage 6 — 1HUNDER (first-half ТМ 0.5) line
  LIVE_1H_ENABLED: envBool('LIVE_1H_ENABLED', false),
  // Data-collection mode: run ONLY the 1H line. Disables A/B enrichment+tracking,
  // settles the 1H bet at halftime (records HT outcome + replies HIT/MISS), then
  // stops tracking the match instead of handing it to the 2H scheduler.
  LIVE_1H_ONLY: envBool('LIVE_1H_ONLY', false),
  LIVE_1H_CONCURRENCY: envInt('LIVE_1H_CONCURRENCY', 2),
  LIVE_1H_MAX_CONCURRENT: envInt('LIVE_1H_MAX_CONCURRENT', 20),
  // Discovery window: live 0:0 matches in this minute range become 1H candidates
  LIVE_1H_OPEN_MIN: envInt('LIVE_1H_OPEN_MIN', 12),
  LIVE_1H_OPEN_MAX: envInt('LIVE_1H_OPEN_MAX', 24),
  // Snapshot cadence (minutes between 1H snapshots)
  LIVE_1H_SNAPSHOT_INTERVAL_MIN: envInt('LIVE_1H_SNAPSHOT_INTERVAL_MIN', 2),
  // Decision window (single signal per match, first EV-pass in window)
  LIVE_1H_DECISION_MIN: envInt('LIVE_1H_DECISION_MIN', 25),
  LIVE_1H_DECISION_MAX: envInt('LIVE_1H_DECISION_MAX', 35),
  // Gate parameters
  LIVE_1H_DS_THRESHOLD_MIN: envInt('LIVE_1H_DS_THRESHOLD_MIN', 70),
  // Inverted-decision TEST mode: signal exactly on the band the normal gate
  // skips (DS in [MIN,MAX]) and skip everything else. EV gate is bypassed in
  // this mode. Formulas are untouched — only the BET/SKIP branch flips.
  LIVE_1H_INVERT_DECISION: envBool('LIVE_1H_INVERT_DECISION', false),
  LIVE_1H_INVERT_DS_MIN: envInt('LIVE_1H_INVERT_DS_MIN', 20),
  LIVE_1H_INVERT_DS_MAX: envInt('LIVE_1H_INVERT_DS_MAX', 64),
  // Disable the DS gate entirely: bet the whole favorite-band population (DS is
  // still computed & recorded). Used to collect a clean base-rate dataset.
  LIVE_1H_DISABLE_DS: envBool('LIVE_1H_DISABLE_DS', false),
  // Bet-gate (signal only — every favorite is still tracked & resolved for data):
  // favorite odds band [MIN, MAX] (0 = that bound disabled).
  LIVE_1H_FAV_ODDS_MIN: envInt('LIVE_1H_FAV_ODDS_MIN', 0),
  LIVE_1H_FAV_ODDS_MAX: envInt('LIVE_1H_FAV_ODDS_MAX', 0),
  // Bet only on AWAY favorites (home favorites break 0:0 before HT more often).
  LIVE_1H_AWAY_FAV_ONLY: envBool('LIVE_1H_AWAY_FAV_ONLY', false),
  LIVE_1H_BASELINE_P: Number(process.env.LIVE_1H_BASELINE_P) || 0.42,
  LIVE_1H_CONFIDENCE: Number(process.env.LIVE_1H_CONFIDENCE) || 0.6,
  LIVE_1H_CALIBRATED: envBool('LIVE_1H_CALIBRATED', false),
  LIVE_1H_TG_ENABLED: envBool('LIVE_1H_TG_ENABLED', true),
  // Re-fetch the live score (cache-busted) right before sending a signal and
  // abort if a goal already shows — guards against a stale 0:0 from the live
  // page lagging the real match. See runTm05_1hDecision.
  LIVE_1H_CONFIRM_BEFORE_SIGNAL: envBool('LIVE_1H_CONFIRM_BEFORE_SIGNAL', true),
  // AI-powered 1H decision (UNDER/OVER routing via LLM + web search)
  LIVE_1H_AI_ENABLED: envBool('LIVE_1H_AI_ENABLED', false),
  LIVE_1H_AI_MODEL: process.env.LIVE_1H_AI_MODEL || '',  // falls back to LIVE_AI_MODEL in runOneH_AiDecision
  LIVE_1H_UNDER_BASELINE_P: Number(process.env.LIVE_1H_UNDER_BASELINE_P) || 0.42,
  LIVE_1H_OVER_BASELINE_P: Number(process.env.LIVE_1H_OVER_BASELINE_P) || 0.40,
  LIVE_1H_AI_DAILY_CAP: envInt('LIVE_1H_AI_DAILY_CAP', 0),  // 0 = unlimited
  // Max sleep while a first-half match is in the discovery window (keep polling tight)
  LIVE_1H_POLL_MS: envInt('LIVE_1H_POLL_MS', 120_000),
  // P1 consensus gate: flip on high-weight contradictions, skip on weak ones
  LIVE_1H_CONSENSUS_GATE: envBool('LIVE_1H_CONSENSUS_GATE', true),
  // P2 probability floor: after any flip, skip if effective p < this value
  LIVE_1H_MIN_P: process.env.LIVE_1H_MIN_P != null && process.env.LIVE_1H_MIN_P !== '' ? Number(process.env.LIVE_1H_MIN_P) : 0.50,
  // D1: xG-routing gates
  LIVE_1H_DETAILED_ONLY: envBool('LIVE_1H_DETAILED_ONLY', true),
  LIVE_1H_XG_UNDER_MAX: process.env.LIVE_1H_XG_UNDER_MAX != null && process.env.LIVE_1H_XG_UNDER_MAX !== '' ? Number(process.env.LIVE_1H_XG_UNDER_MAX) : 0.15,
  LIVE_1H_XG_OVER_MAX: process.env.LIVE_1H_XG_OVER_MAX != null && process.env.LIVE_1H_XG_OVER_MAX !== '' ? Number(process.env.LIVE_1H_XG_OVER_MAX) : 0.50,

  // Stage 5 — Telegram notifications
  LIVE_TG_ENABLED: envBool('LIVE_TG_ENABLED', true),
  LIVE_TG_DRY_RUN: envBool('LIVE_TG_DRY_RUN', false),
  LIVE_TG_MAX_RETRIES: envInt('LIVE_TG_MAX_RETRIES', 3),
  LIVE_TG_RETRY_BASE_MS: envInt('LIVE_TG_RETRY_BASE_MS', 1_000),
};

module.exports = env;
