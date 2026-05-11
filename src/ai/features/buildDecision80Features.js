'use strict';

const { computeCleanProbs } = require('../../tracker/derivedFields');
const { calculateDangerScore } = require('./calculateDangerScore');
const { aggregateDeltaRange } = require('./calculateSnapshotTrend');
const {
  snapshotPins,
  halftimeResearchBrief,
  favoriteByOdds,
} = require('./buildDecision60Features');

function summarizeDecision60ForPrompt(match) {
  const d60 = match.aiAnalysis?.decision60?.output;
  if (!d60) return null;
  return {
    match_state: d60.match_state ?? null,
    tempo_state: d60.tempo_state ?? null,
    probabilities: d60.probabilities ?? null,
    recommendation: d60.recommendation ?? null,
    confidence: d60.confidence ?? null,
  };
}

function possessionShift(snapshotLater, snapshotEarlier) {
  const pL = snapshotLater?.ballPossession;
  const pE = snapshotEarlier?.ballPossession;
  if (!pL || !pE) return null;
  if (pL.home == null || pE.home == null) return null;
  return {
    home_pp_delta: pL.home - pE.home,
    away_pp_delta: (pL.away || 0) - (pE.away || 0),
  };
}

function sortedSnapshots(match) {
  return [...(match.snapshots || [])]
    .filter(s => s.minute != null)
    .sort((a, b) => a.minute - b.minute);
}

function snapshotAtOrBefore(match, minute) {
  const s = sortedSnapshots(match).filter(x => x.minute <= minute);
  return s[s.length - 1] || null;
}

function computeDecision80ServerMetrics(match) {
  const snaps = sortedSnapshots(match);
  const agg6070 = aggregateDeltaRange(snaps, 60, 70);
  const agg7080 = aggregateDeltaRange(snaps, 70, 80);
  const agg6080 = aggregateDeltaRange(snaps, 60, 80);

  const last10 = {
    shots: agg7080.shots,
    shots_on_target: agg7080.shotsOnTarget,
    corners: agg7080.corners,
    xg: agg7080.xg,
    yellow_cards: agg7080.yellowCards,
    red_cards: agg7080.redCards,
    danger_score: Math.round(calculateDangerScore({
      shots: agg7080.shots,
      shotsOnTarget: agg7080.shotsOnTarget,
      corners: agg7080.corners,
      xg: agg7080.xg,
      yellowCards: agg7080.yellowCards,
      redCards: agg7080.redCards,
    }) * 1000) / 1000,
  };

  const last20 = {
    shots: agg6080.shots,
    shots_on_target: agg6080.shotsOnTarget,
    corners: agg6080.corners,
    xg: agg6080.xg,
    yellow_cards: agg6080.yellowCards,
    red_cards: agg6080.redCards,
    danger_score: Math.round(calculateDangerScore({
      shots: agg6080.shots,
      shotsOnTarget: agg6080.shotsOnTarget,
      corners: agg6080.corners,
      xg: agg6080.xg,
      yellowCards: agg6080.yellowCards,
      redCards: agg6080.redCards,
    }) * 1000) / 1000,
  };

  const sn70 = snapshotAtOrBefore(match, 70);
  const sn80 = snapshotAtOrBefore(match, 80);

  return {
    delta_60_70_precomputed: {
      shots: agg6070.shots,
      shots_on_target: agg6070.shotsOnTarget,
      corners: agg6070.corners,
      xg: agg6070.xg,
      yellow_cards: agg6070.yellowCards,
      red_cards: agg6070.redCards,
      danger_score: Math.round(calculateDangerScore({
        shots: agg6070.shots,
        shotsOnTarget: agg6070.shotsOnTarget,
        corners: agg6070.corners,
        xg: agg6070.xg,
        yellowCards: agg6070.yellowCards,
        redCards: agg6070.redCards,
      }) * 1000) / 1000,
    },
    delta_70_80_precomputed: {
      shots: agg7080.shots,
      shots_on_target: agg7080.shotsOnTarget,
      corners: agg7080.corners,
      xg: agg7080.xg,
      yellow_cards: agg7080.yellowCards,
      red_cards: agg7080.redCards,
      danger_score: Math.round(calculateDangerScore({
        shots: agg7080.shots,
        shotsOnTarget: agg7080.shotsOnTarget,
        corners: agg7080.corners,
        xg: agg7080.xg,
        yellowCards: agg7080.yellowCards,
        redCards: agg7080.redCards,
      }) * 1000) / 1000,
    },
    last_10_minutes: last10,
    last_20_minutes: last20,
    possession_shift_70_to_80: possessionShift(sn80, sn70),
  };
}

function mergeDecision80ServerMetrics(match, aiNormalized) {
  const m = computeDecision80ServerMetrics(match);
  const out = { ...aiNormalized };
  out.last_10_minutes = { ...m.last_10_minutes };
  out.last_20_minutes = { ...m.last_20_minutes };
  const rf = new Set([...(out.risk_flags || [])]);
  if (match.statsLevel === 'basic') rf.add('basic_stats_only');
  const baselineXgMissing = match.baseline1H?.expectedGoalsXg?.home == null
    || match.baseline1H?.expectedGoalsXg?.away == null;
  const sn80 = snapshotAtOrBefore(match, 80);
  const sinceXg = sn80?.since2H?.expectedGoalsXg;
  const sinceXgMissing = sinceXg?.home == null || sinceXg?.away == null;
  if (baselineXgMissing || sinceXgMissing) rf.add('missing_xg');
  out.risk_flags = [...rf];
  return out;
}

function tournamentMotivationHint(match) {
  const ht = match.aiAnalysis?.halftime?.output;
  const mc = ht?.match_context;
  if (!mc) return null;
  return {
    tournament_importance_home: mc.tournament_importance_home ?? null,
    tournament_importance_away: mc.tournament_importance_away ?? null,
  };
}

function buildDecision80Features(match) {
  const snaps = sortedSnapshots(match);
  const at80 = snaps.filter(s => s.minute <= 80).pop() || null;
  const derived = match.derived || {};
  const cp = computeCleanProbs(match.odds);
  const clean = {
    p1Clean: derived.p1Clean ?? cp.p1Clean,
    pXClean: derived.pXClean ?? cp.pXClean,
    p2Clean: derived.p2Clean ?? cp.p2Clean,
  };

  const server = computeDecision80ServerMetrics(match);

  return {
    MATCH: {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league: match.league,
      country: match.country,
      currentMinute: 80,
      currentScore: '0:0',
      statsLevel: match.statsLevel || 'unknown',
    },
    SNAPSHOTS_PINNED: snapshotPins(match, [60, 65, 70, 75, 80]),
    ENRICHMENT_STATISTICS: match.statistics ?? null,
    DYNAMICS: {
      since2H_at_80: at80?.since2H ?? null,
      last_delta_at_80: at80?.delta ?? null,
      delta_60_70_precomputed: server.delta_60_70_precomputed,
      delta_70_80_precomputed: server.delta_70_80_precomputed,
      possession_shift_70_to_80: server.possession_shift_70_to_80,
    },
    PRESSURE: {
      shots_70_80: server.delta_70_80_precomputed.shots,
      shots_on_target_70_80: server.delta_70_80_precomputed.shots_on_target,
      corners_70_80: server.delta_70_80_precomputed.corners,
      xg_70_80: server.delta_70_80_precomputed.xg,
      yellow_cards_70_80: server.delta_70_80_precomputed.yellow_cards,
      red_cards_70_80: server.delta_70_80_precomputed.red_cards,
      danger_70_80: server.delta_70_80_precomputed.danger_score,
    },
    CONTEXT: {
      favorite_by_odds: favoriteByOdds(match),
      marketSignal: derived.marketSignal ?? null,
      tableSignal: derived.tableSignal ?? null,
      standings_pressure: match.standings
        ? {
          home: match.standings.home ?? null,
          away: match.standings.away ?? null,
          favoriteStrength: match.standings.favoriteStrength ?? null,
        }
        : null,
      tournament_motivation_hint: tournamentMotivationHint(match),
      p1Clean: clean.p1Clean,
      pXClean: clean.pXClean,
      p2Clean: clean.p2Clean,
      halftimeResearch: halftimeResearchBrief(match),
      decision60_summary: summarizeDecision60ForPrompt(match),
    },
    PRECOMPUTED_FOR_MODEL: {
      last_10_minutes: server.last_10_minutes,
      last_20_minutes: server.last_20_minutes,
      danger_band_hint:
        '0–2 dead/low activity; 2–5 balanced; 5–8 pressure building; 8+ high pressure / late siege',
    },
  };
}

module.exports = {
  buildDecision80Features,
  computeDecision80ServerMetrics,
  mergeDecision80ServerMetrics,
};
