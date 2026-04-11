const { applyOddsContext } = require('./oddsContext');

/** Бізнес-вікна лайв-моделі (хвилини матчу). */
function getLiveTimeWindow(minute) {
  const m = Number(minute);
  if (!Number.isFinite(m)) return 'before';
  if (m < 60) return 'before';
  if (m < 70) return '60-70';
  if (m < 80) return '70-80';
  if (m <= 120) return '80-90+';
  return 'after';
}

/**
 * Пороги калібровані під базову pGoal=0.45.
 * 60-70: тільки ТМ. 70-80: ТМ або ТБ. 80-90+: тільки ТБ.
 */
const THRESHOLDS = {
  '60-70':  { minPDryUnder: 0.52, minPGoalOver: 1   },
  '70-80':  { minPDryUnder: 0.54, minPGoalOver: 0.60 },
  '80-90+': { minPDryUnder: 1,    minPGoalOver: 0.55 },
};

function buildReason(features, scored, extra = '') {
  const raw = features.raw2H || features.rawOverall || {};
  const parts = [];
  if (raw.shotsOnTarget != null) parts.push(`${raw.shotsOnTarget} уд. в площ.`);
  if (raw.bigChances != null) parts.push(`${raw.bigChances} мом.`);
  if (raw.touchesInOppositionBox != null) parts.push(`${raw.touchesInOppositionBox} дотик.`);
  if (raw.expectedGoalsXg != null) parts.push(`xG ${raw.expectedGoalsXg}`);
  const statsLine = parts.length ? parts.join(', ') : 'мало даних';
  const src = features.statsStatus === 'both' ? '(2H+O)' :
    features.statsStatus === '2h_only' ? '(2H)' : '(O)';
  const oddsBit = extra ? ` ${extra}` : '';
  return `${statsLine} ${src}${oddsBit}`;
}

/**
 * @param {object} scored — від scoreMatchWindowed
 * @param {object} features — з buildFeatures + optional odds1X2
 * @param {string|null} prevBet — попередній активний прогноз UNDER_0_5 | OVER_0_5
 */
function decideWindowedLiveBet(scored, features, prevBet = null) {
  const minute = features.minute;
  const tw = getLiveTimeWindow(minute);
  const oddsLine = features.odds1X2
    ? `| кф ${features.odds1X2.home}/${features.odds1X2.draw}/${features.odds1X2.away}`
    : '';

  if (tw === 'before' || tw === 'after') {
    return {
      bet: 'SKIP',
      confidence: 'none',
      pGoal: scored?.pGoal ?? null,
      pDry: scored?.pDry ?? null,
      edge: null,
      reason: `Поза вікном 60–90+ (${minute}')`,
      timeWindow: tw,
      signalEligible: false,
      impliedProb: null,
      odds1X2: features.odds1X2 || null,
    };
  }

  if (!scored || !Number.isFinite(scored.pGoal)) {
    return {
      bet: 'SKIP', confidence: 'none', pGoal: null, pDry: null, edge: null,
      reason: 'Некоректні дані', timeWindow: tw, signalEligible: false,
      impliedProb: null, odds1X2: features.odds1X2 || null,
    };
  }

  if (!features?.allowDecision) {
    return {
      bet: 'SKIP',
      confidence: features?.confidence || 'none',
      pGoal: scored.pGoal,
      pDry: scored.pDry,
      edge: null,
      reason: `Недостатньо метрик (${buildReason(features, scored)})`,
      timeWindow: tw,
      signalEligible: false,
      impliedProb: null,
      odds1X2: features.odds1X2 || null,
    };
  }

  const oc = applyOddsContext(scored.pGoal, scored.pDry, tw, features.odds1X2);
  const pGoal = oc.pGoal;
  const pDry = oc.pDry;
  const highStats = features.confidence === 'high';
  const mediumStats = features.confidence === 'medium';

  const th = THRESHOLDS[tw];
  const reasonBase = buildReason(features, scored, oddsLine);
  const oddsSuffix = oc.oddsNote ? ` [ринок: ΔpGoal ${oc.oddsAdjust >= 0 ? '+' : ''}${oc.oddsAdjust}]` : '';

  /**
   * Telegram-сигнал: high — завжди, medium — з поміткою ⚠️.
   * low/none — не відправляємо, але відстежуємо.
   */
  const make = (bet, label, signalEligible) => ({
    bet,
    confidence: highStats ? 'high' : mediumStats ? 'medium' : 'low',
    pGoal,
    pDry,
    edge: Number(((bet === 'OVER_0_5' ? pGoal : pDry) - 0.5).toFixed(3)),
    reason: `${label}: ${reasonBase}${oddsSuffix}`,
    timeWindow: tw,
    signalEligible: Boolean(signalEligible && (highStats || mediumStats)),
    impliedProb: oc.impliedProb,
    odds1X2: features.odds1X2 || null,
  });

  if (tw === '60-70') {
    if (pDry >= th.minPDryUnder && pGoal <= 0.48) {
      return make('UNDER_0_5', 'ТМ 60–70', true);
    }
    return {
      bet: 'SKIP',
      confidence: features.confidence,
      pGoal, pDry,
      edge: null,
      reason: `60–70: очікуємо сильний сигнал ТМ (high stats + pDry≥${th.minPDryUnder}) — ${reasonBase}${oddsSuffix}`,
      timeWindow: tw,
      signalEligible: false,
      impliedProb: oc.impliedProb,
      odds1X2: features.odds1X2 || null,
    };
  }

  if (tw === '70-80') {
    const overOk = pGoal >= th.minPGoalOver;
    const underOk = pDry >= th.minPDryUnder;
    if (overOk && underOk) {
      const bet = pGoal >= pDry ? 'OVER_0_5' : 'UNDER_0_5';
      const label = bet === 'OVER_0_5' ? 'ТБ 70–80' : 'ТМ 70–80';
      return make(bet, label, true);
    }
    if (overOk) return make('OVER_0_5', 'ТБ 70–80', true);
    if (underOk) return make('UNDER_0_5', 'ТМ 70–80', true);
    return {
      bet: 'SKIP',
      confidence: features.confidence,
      pGoal, pDry,
      edge: null,
      reason: `70–80: немає чіткого ТБ/ТМ за порогами — ${reasonBase}${oddsSuffix}`,
      timeWindow: tw,
      signalEligible: false,
      impliedProb: oc.impliedProb,
      odds1X2: features.odds1X2 || null,
    };
  }

  // 80-90+
  const flipFromUnder = prevBet === 'UNDER_0_5';

  // Бонус фаворита: якщо явний фаворит (implied > 0.52) — команді невигідно 0:0, вона давить.
  // Використовується тільки для порівняння з порогом, не змінює pGoal у відповіді.
  const favBonus = (oc.impliedProb && Math.max(oc.impliedProb.home, oc.impliedProb.away) > 0.52)
    ? 0.04 : 0;
  const pGoalForDecision = Math.min(pGoal + favBonus, 1);
  const favNote = favBonus > 0 ? ' [фаворит+]' : '';

  if (pGoalForDecision >= th.minPGoalOver) {
    const label = flipFromUnder ? `ТБ 80+ (зміна з ТМ)${favNote}` : `ТБ 80+${favNote}`;
    return make('OVER_0_5', label, true);
  }
  return {
    bet: 'SKIP',
    confidence: features.confidence,
    pGoal, pDry,
    edge: null,
    reason: flipFromUnder
      ? `80+: моніторинг після ТМ — чекаємо сильний ТБ (pGoal≥${th.minPGoalOver}) — ${reasonBase}${oddsSuffix}`
      : `80+: немає сильного ТБ — ${reasonBase}${oddsSuffix}`,
    timeWindow: tw,
    signalEligible: false,
    impliedProb: oc.impliedProb,
    odds1X2: features.odds1X2 || null,
  };
}

module.exports = {
  getLiveTimeWindow,
  decideWindowedLiveBet,
  THRESHOLDS,
};
