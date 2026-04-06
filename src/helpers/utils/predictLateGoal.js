function getIntensityZone(stats = {}) {
  // Отримуємо значення тільки з вхідних даних (без fallback на середні)
  const xg = stats.expectedGoalsXg;
  const sOT = stats.shotsOnTarget;
  const touches = stats.touchesInOppositionBox;

  // Перевіряємо, які параметри доступні
  const hasXg = xg !== undefined && xg !== null;
  const hasSOT = sOT !== undefined && sOT !== null;
  const hasTouches = touches !== undefined && touches !== null;

  const availableParams = [hasXg, hasSOT, hasTouches].filter(Boolean).length;

  // Якщо немає жодного параметра - повертаємо Zone 0
  if (availableParams === 0) {
    return 0;
  }

  // Якщо є всі три параметри - використовуємо стандартні критерії
  if (availableParams === 3) {
    // Zone 1 – dead match
    if (xg <= 0.5 && sOT <= 3 && touches <= 18) return 1;

    // Zone 4 – ultra high intensity
    if (xg >= 2 && sOT >= 8 && touches >= 20) return 4;

    // Zone 2 – high intensity
    if (xg >= 1.3 && sOT >= 6 && touches >= 18) return 2;

    // Zone 3 – moderate
    if (xg > 0.5 && xg < 1.3 && sOT > 3 && sOT < 6 && touches >= 12 && touches <= 20) {
      return 3;
    }
  }

  // Якщо є тільки 2 параметри, використовуємо більш м'які пороги
  if (availableParams === 2) {
    if (hasXg && hasSOT) {
      // без touches
      if (xg >= 1.8 && sOT >= 7) return 4;
      if (xg >= 1.1 && sOT >= 5) return 2;
      if (xg <= 0.4 && sOT <= 2) return 1;
    }
    if (hasXg && hasTouches) {
      // без sOT
      if (xg >= 1.5 && touches >= 22) return 4;
      if (xg >= 1.1 && touches >= 16) return 2;
      if (xg <= 0.4 && touches <= 15) return 1;
    }
    if (hasSOT && hasTouches) {
      // без xg
      if (sOT >= 7 && touches >= 22) return 4;
      if (sOT >= 5 && touches >= 16) return 2;
      if (sOT <= 2 && touches <= 15) return 1;
    }
  }

  // Якщо є тільки 1 параметр, використовуємо дуже м'які критерії
  if (availableParams === 1) {
    if (hasXg) {
      if (xg >= 2.2) return 4;
      if (xg >= 1.5) return 2;
      if (xg <= 0.3) return 1;
    }
    if (hasSOT) {
      if (sOT >= 9) return 4;
      if (sOT >= 7) return 2;
      if (sOT <= 2) return 1;
    }
    if (hasTouches) {
      if (touches >= 28) return 4;
      if (touches >= 22) return 2;
      if (touches <= 12) return 1;
    }
  }

  // Zone 0 – undefined (недостатньо даних або дані не підходять під жодну зону)
  return 0;
}

function legacyPredictLateGoal(scored, decision) {
  return {
    bet: decision.bet,
    confidence: scored.confidence,
    zone: scored.zone,
    pGoal: scored.pGoal,
    edge: decision.edge,
    reason: decision.reason,
  };
}

module.exports = {
  getIntensityZone,
  legacyPredictLateGoal,
};
