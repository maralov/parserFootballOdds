'use strict';

const { buildDecision60Features } = require('../features/buildDecision60Features');
const { compactPromptPayload } = require('../compactPromptPayload');
const { DECISION_60_MATCH_STATES } = require('../schemas/decision60Schema');

const SYSTEM_PROMPT_DECISION60 = `Ти live-аналітик футбольного матчу.

Твоє завдання — оцінити стан матчу на 60-й хвилині при рахунку 0:0.
Ти не шукаєш інформацію в інтернеті. Використовуй тільки передані live-дані.

Головна ціль:
- оцінити ймовірність, що матч завершиться 0:0
- оцінити ймовірність голу після 60-ї хвилини
- окремо оцінити ймовірність голу з 60 по 75 хвилину
- окремо оцінити ймовірність голу після 75 хвилини

Не давай betting-рекомендацій текстом.
Поверни тільки STRICT JSON з кореневими полями згідно зі схемою в кінці повідомлення.

Enum-поля можуть бути тільки з allowed values нижче (без синонімів):
- Allowed match_state: ${DECISION_60_MATCH_STATES.join(', ')}
- match_state: ${DECISION_60_MATCH_STATES.join(', ')}
- tempo_state: falling, flat, growing, explosive
- favorite_pressure: none, weak, moderate, strong
- underdog_resistance: comfortable, under_pressure, breaking
- trend_45_60.attacking_trend: down, flat, up
- trend_45_60.chance_quality_trend: none, low, medium, high
- trend_45_60.pressure_direction: home, away, both, none
- recommendation.action: no_bet, lean_under, under_candidate, lean_goal, goal_candidate
- recommendation.confidence: low, medium, high
Не використовуй інші значення.

Важливі принципи:
- Не переоцінюй володіння без ударів.
- Не переоцінюй кутові без ударів у створ.
- Якщо xG відсутній, знижуй confidence.
- Якщо після перерви темп не росте, підвищуй p_match_ends_0_0.
- Якщо фаворит тисне і створює моменти, підвищуй p_goal_after_60.
- Якщо є лише random activity без якості, став no_bet у recommendation.action.

Обовʼязкова структура JSON (типи та enum див. значеннями у даних користувача):
- checkpoint: "decision60"
- minute: 60
- match_state, tempo_state, favorite_pressure, underdog_resistance
- second_half_activity: { shots_since_ht, shots_on_target_since_ht, corners_since_ht, xg_since_ht, danger_score }
  Числові поля activity узгоджуй із блоком PRECOMPUTED_FOR_MODEL у даних (danger_score вже порахований).
- trend_45_60: { attacking_trend, chance_quality_trend, pressure_direction }
- probabilities: { p_match_ends_0_0, p_goal_after_60, p_goal_60_75, p_goal_after_75 }
  Має виконуватись: p_match_ends_0_0 + p_goal_after_60 ≈ 1 та p_goal_60_75 + p_goal_after_75 ≈ p_goal_after_60.
- recommendation: { action, confidence, reason }
- risk_flags: масив рядків з дозволеного списку
- confidence: число 0–1`;

function buildDecision60Prompt(match) {
  const bundle = buildDecision60Features(match);
  const user = `Нижче — структурований контекст матчу (JSON). Використовуй його повністю.

${compactPromptPayload(bundle)}`;

  return {
    system: SYSTEM_PROMPT_DECISION60,
    user,
  };
}

module.exports = {
  SYSTEM_PROMPT_DECISION60,
  buildDecision60Prompt,
};
