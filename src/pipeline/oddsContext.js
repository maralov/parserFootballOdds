function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function impliedProbabilities(odds) {
  if (!odds || !odds.home || !odds.draw || !odds.away) return null;
  const h = Number(odds.home);
  const d = Number(odds.draw);
  const a = Number(odds.away);
  if (![h, d, a].every((x) => Number.isFinite(x) && x > 0)) return null;
  const inv = 1 / h + 1 / d + 1 / a;
  return {
    home: Number(((1 / h) / inv).toFixed(3)),
    draw: Number(((1 / d) / inv).toFixed(3)),
    away: Number(((1 / a) / inv).toFixed(3)),
  };
}

/**
 * Легка корекція pGoal/pDry за прематч 1X2 (ринковий контекст).
 * @param {'60-70'|'70-80'|'80-90+'} timeWindow
 */
function applyOddsContext(pGoal, pDry, timeWindow, odds1X2) {
  const implied = impliedProbabilities(odds1X2);
  if (!implied) {
    return {
      pGoal, pDry, impliedProb: null, oddsAdjust: 0, oddsNote: null,
    };
  }

  let delta = 0;
  if (implied.draw > 0.34) delta -= 0.04;
  else if (implied.draw < 0.26) delta += 0.025;

  const imb = Math.abs(implied.home - implied.away);
  if (imb > 0.22 && (timeWindow === '70-80' || timeWindow === '80-90+')) {
    delta += 0.03;
  }

  const pGoal2 = Number(clamp01(pGoal + delta).toFixed(3));
  const pDry2 = Number((1 - pGoal2).toFixed(3));

  return {
    pGoal: pGoal2,
    pDry: pDry2,
    impliedProb: implied,
    oddsAdjust: Number(delta.toFixed(3)),
    oddsNote: delta !== 0 ? '1X2_implied' : null,
  };
}

module.exports = { impliedProbabilities, applyOddsContext };
