'use strict';

const MATCH_STATES = [
  'low_tempo',
  'balanced',
  'building_pressure',
  'high_tempo',
];

const DOMINANT_SIDES = ['home', 'away', 'none'];

const DEFAULT_AI_MODEL = 'gpt-4o';

const MODEL_PRICING = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

const SYSTEM_PROMPT = `Ти аналітик футбольних матчів. Отримуєш об'єктивні статистичні дані
матчу і даєш числові оцінки ймовірностей розвитку подій.

ПРАВИЛА:
1. Базуйся ТІЛЬКИ на наданих даних. Не використовуй знання про команди.
2. Не давай рекомендацій щодо ставок чи інвестицій.
3. Не використовуй термінологію беттінгу (тотал, ТМ, ТБ, коеф).
4. Видавай ТІЛЬКИ JSON, без коментарів до або після.
5. Сума ймовірностей альтернатив має бути 1.0.
6. Якщо даних мало для впевненої оцінки — встановлюй confidence < 0.5.
7. Кореневий JSON ОБОВʼЯЗКОВО містить ключі (саме такі імена): p_match_ends_0_0, p_match_has_goal, match_state, dominant_side, key_observations, confidence.`;

module.exports = {
  MATCH_STATES,
  DOMINANT_SIDES,
  DEFAULT_AI_MODEL,
  MODEL_PRICING,
  SYSTEM_PROMPT,
};
