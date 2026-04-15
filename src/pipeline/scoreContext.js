/**
 * Контекст рахунку для v2: окремий шар від «сухості» статистики (ТЗ §4).
 */

function parseGoals(s) {
  const n = Number(String(s ?? '').replace(/\D/g, '') || 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {{ home?: string|number, away?: string|number }} score
 */
function buildScoreContext(score) {
  const h = parseGoals(score?.home);
  const a = parseGoals(score?.away);
  const total = h + a;

  let scoreStateType = '0-0';
  if (total === 0) scoreStateType = '0-0';
  else if (h === a) scoreStateType = 'level';
  else if (total === 1) scoreStateType = 'one_goal';
  else scoreStateType = 'multi_goal';

  const leadingSide = h > a ? 'home' : a > h ? 'away' : null;
  const trailingSide = h < a ? 'home' : a < h ? 'away' : null;

  return {
    score: `${h}:${a}`,
    homeGoals: h,
    awayGoals: a,
    totalGoals: total,
    isZeroZero: total === 0,
    isLevelScore: h === a && total > 0,
    isOneGoalGame: total === 1,
    isMultiGoalGame: total >= 2,
    leadingSide,
    trailingSide,
    scoreStateType,
  };
}

module.exports = { buildScoreContext, parseGoals };
