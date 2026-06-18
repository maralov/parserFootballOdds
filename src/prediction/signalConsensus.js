'use strict';

// Канонічний детектор протиріч "AI-сигнали ↔ напрям ставки" для 1H ТМ/ТБ.
// Спільне джерело правди: жива гілка (runOneH_AiDecision) і skill analyze-predictions.
// Евристика, не вирок: класифікує keySignals і повертає verdict для гейта.

const UNDER_CONTEXT = /\blow\b|low_|_low|under|0:0|0_0|низьк|обережн|\bfew\b|рівн|солідн/i;
const GOAL_LEANING = /defensive_issues|пропустили|first_half_goals|frequent|часто|поспіль|streak|гола за гру|goals per game|7-0/i;
const DEAD_LIVE = /shots_on_target[=:\s]*0(\D|$)|\bsot[=:\s]*0(\D|$)|xg[=:\s]*0\.0[0-9]/i;

function isHigh(w) { return String(w).toLowerCase() === 'high'; }

// Goal-leaning: argues a goal is coming. Skip signals whose phrasing is
// under-context ("low_first_half_goals", "часто ... з низькою кількістю").
function goalLeaningSignals(keySignals = []) {
  return keySignals.filter((s) => {
    const t = `${s.signal} ${s.value}`;
    return !UNDER_CONTEXT.test(t) && GOAL_LEANING.test(t);
  });
}

// Dead-live: live in-play evidence of NO danger (0 shots on target, xG≈0).
function deadLiveSignals(keySignals = []) {
  return keySignals.filter((s) => DEAD_LIVE.test(`${s.signal} ${s.value}`));
}

/**
 * @param {{direction:'under'|'over', keySignals:Array}} args
 * @returns {{verdict:'ok'|'flip'|'skip', reason:string|null, signals:Array}}
 *  flip = confident contradiction → bet the complement
 *  skip = weak contradiction → no bet
 *  ok   = consistent
 *
 * Asymmetric path design (intentional):
 *   under-path: flips only when a goal-leaning signal has HIGH weight;
 *               med/low-weight goal-leaning signals → skip (conservative).
 *   over-path:  flips on ANY dead-live signal regardless of weight, because
 *               dead-live (0 shots on target / xG≈0) is objective live
 *               evidence of no danger — it is not an opinion, so its weight
 *               label is irrelevant.  A flipped over→under usually lands
 *               below the p≥0.50 floor and gets dropped by skipped_by_min_p
 *               anyway, keeping the net behavior conservative.
 */
function evaluateConsensus({ direction, keySignals = [] } = {}) {
  if (direction === 'under') {
    const goal = goalLeaningSignals(keySignals);
    if (!goal.length) return { verdict: 'ok', reason: null, signals: [] };
    const why = goal.map((s) => s.signal).join(', ');
    return goal.some((s) => isHigh(s.weight))
      ? { verdict: 'flip', reason: `goal-leaning high на under: ${why}`, signals: goal }
      : { verdict: 'skip', reason: `goal-leaning (слабке) на under: ${why}`, signals: goal };
  }
  if (direction === 'over') {
    const dead = deadLiveSignals(keySignals);
    if (!dead.length) return { verdict: 'ok', reason: null, signals: [] };
    return { verdict: 'flip', reason: `dead-live на over: ${dead.map((s) => s.signal).join(', ')}`, signals: dead };
  }
  return { verdict: 'ok', reason: null, signals: [] };
}

module.exports = { evaluateConsensus, goalLeaningSignals, deadLiveSignals };
