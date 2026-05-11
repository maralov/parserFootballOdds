'use strict';

/** @readonly */
const CHECKPOINTS = {
  DECISION_60: 'decision60',
  DECISION_80: 'decision80',
};

/**
 * Ринкова ідея: прогноз фінального ТМ0.5 (FT 0:0), записаний у вікні 60–75.
 */
const TARGET_MARKET = {
  decision60: 'FT_TM05_FROM_60_75',
  decision80: 'TB05_80_PLUS',
};

/** Канонічні rule-based типи для decision60 (FT-потік). */
const PRED_TYPES_60 = {
  FT_TM05_FROM_60_75: 'FT_TM05_FROM_60_75',
  LEAN_FT_TM05_FROM_60_75: 'LEAN_FT_TM05_FROM_60_75',
  FT_TM05_RISK: 'FT_TM05_RISK',
  NO_BET: 'NO_BET',
};

/** Канонічні типи decision80 (незалежний продукт). */
const PRED_TYPES_80 = {
  TB05_80_PLUS: 'TB05_80_PLUS',
  LEAN_TB05_80_PLUS: 'LEAN_TB05_80_PLUS',
  PROTECT_UNDER: 'PROTECT_UNDER',
  NO_BET: 'NO_BET',
};

/** Short labels for prediction-signals.json */
const SIGNAL_CODE = {
  FT_TM05_FROM_60_75: 'FT_TM60_75',
  LEAN_FT_TM05_FROM_60_75: 'LEAN_FT_TM60_75',
  FT_TM05_RISK: 'FT_TM_RISK',

  TB05_80_PLUS: 'TB80_PLUS',
  LEAN_TB05_80_PLUS: 'LEAN_TB80_PLUS',
  PROTECT_UNDER: 'PROTECT_UNDER',
  NO_BET: 'NO_BET',
};

const RISK_STANDARD = /** @type {const} */ ([
  'basic_stats_only',
  'missing_xg',
  'missing_xgot',
  'missing_detailed_fields',
  'red_card',
  'data_inconsistent',
  'low_snapshot_count',
  'fake_pressure',
  'locked_after_tm60_signal',
  'early_goal_detected',
  'score_not_0_0',
  'late_activation_signs',
  'favorite_siege_risk',
  'chaos_cards',
  'sparse_snapshots',
]);

module.exports = {
  CHECKPOINTS,
  TARGET_MARKET,
  PRED_TYPES_60,
  PRED_TYPES_80,
  SIGNAL_CODE,
  RISK_STANDARD,
};
