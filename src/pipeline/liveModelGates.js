const { isTopTierLeague } = require('../helpers/leagueTier');
const {
  LIVE_QUALITY_GATES_ENABLED,
  LIVE_BET_MIN_PRIMARY_METRICS,
  LIVE_NON_TOP_EXTRA_PRIMARY_METRICS,
  LIVE_60_70_REQUIRE_BOTH_HALVES,
  LIVE_MIN_DECISION_EDGE,
  LIVE_SNAPSHOT_BURST_GATE_ENABLED,
  LIVE_SNAPSHOT_BURST_MIN_SOT,
  LIVE_SNAPSHOT_BURST_MIN_XG,
} = require('../helpers/constants');

function skipFromGate(prev, note) {
  return {
    ...prev,
    bet: 'SKIP',
    signalEligible: false,
    edge: null,
    reason: `[гейт] ${note} — ${prev.reason}`,
  };
}

/**
 * Після обрання ТМ/ТБ: відсікає слабкі дані та «слабкий edge» (менше випадкових ставок).
 * @param {object} features — з buildFeatures (+ league, statsStatus, availablePrimary)
 * @param {object} decision — результат decideWindowedLiveBet до гейтів
 */
function applyLiveModelGates(features, decision) {
  if (!LIVE_QUALITY_GATES_ENABLED || !decision || decision.bet === 'SKIP') {
    return decision;
  }

  const top = isTopTierLeague(features.league);
  const minPrimary =
    LIVE_BET_MIN_PRIMARY_METRICS + (top ? 0 : LIVE_NON_TOP_EXTRA_PRIMARY_METRICS);
  const ap = features.availablePrimary ?? 0;
  if (ap < minPrimary) {
    return skipFromGate(decision, `потрібно ≥${minPrimary} primary-метрик (зараз ${ap})${top ? '' : ', не-топ ліга'}`);
  }

  const tw = decision.timeWindow;
  if (
    LIVE_60_70_REQUIRE_BOTH_HALVES &&
    tw === '60-70' &&
    decision.bet === 'UNDER_0_5' &&
    features.statsStatus !== 'both'
  ) {
    return skipFromGate(decision, '60–70 ТМ: потрібні дані 2H+O (обидві половини)');
  }

  const edgeMin = LIVE_MIN_DECISION_EDGE;
  if (edgeMin > 0 && Number.isFinite(decision.pGoal) && Number.isFinite(decision.pDry)) {
    if (decision.bet === 'OVER_0_5') {
      const e = decision.pGoal - 0.5;
      if (e < edgeMin) {
        return skipFromGate(decision, `edge ТБ (pGoal−0.5)=${e.toFixed(3)} < ${edgeMin}`);
      }
    }
    if (decision.bet === 'UNDER_0_5') {
      const e = decision.pDry - 0.5;
      if (e < edgeMin) {
        return skipFromGate(decision, `edge ТМ (pDry−0.5)=${e.toFixed(3)} < ${edgeMin}`);
      }
    }
  }

  return decision;
}

/**
 * ТМ 60–70: відсікати вхід, якщо між останніми зрізами raw2H — різкий приріст ударів у площину або xG.
 * Потрібні ≥2 знімки (другий цикл опитування для цього matchId).
 */
function applyLiveSnapshotBurstGate(features, decision) {
  if (!LIVE_SNAPSHOT_BURST_GATE_ENABLED || !decision || decision.bet === 'SKIP') {
    return decision;
  }
  if (decision.bet !== 'UNDER_0_5' || decision.timeWindow !== '60-70') {
    return decision;
  }

  const tr = features?.liveTrajectory;
  if (!tr || tr.snapshotCount < 2 || !tr.deltas) {
    return decision;
  }

  const dSot = tr.deltas.shotsOnTarget;
  const dXg = tr.deltas.expectedGoalsXg;
  const burstSot = dSot != null && dSot >= LIVE_SNAPSHOT_BURST_MIN_SOT;
  const burstXg = dXg != null && dXg >= LIVE_SNAPSHOT_BURST_MIN_XG;
  if (!burstSot && !burstXg) {
    return decision;
  }

  const parts = [];
  if (burstSot) parts.push(`ΔSOT ${dSot}≥${LIVE_SNAPSHOT_BURST_MIN_SOT}`);
  if (burstXg) parts.push(`ΔxG ${dXg}≥${LIVE_SNAPSHOT_BURST_MIN_XG}`);
  return skipFromGate(
    decision,
    `ТМ 60–70: сплеск 2H (${parts.join(', ')}, Δхв матчу=${tr.deltaMatchMinutes ?? '—'})`
  );
}

module.exports = { applyLiveModelGates, applyLiveSnapshotBurstGate };
