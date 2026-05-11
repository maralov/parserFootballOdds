'use strict';

const { computeCleanProbs } = require('../../tracker/derivedFields');
const { calculateDangerScore } = require('./calculateDangerScore');
const { aggregateDeltaRange, computeTrendHints45to60, dangerFromAggregate } = require('./calculateSnapshotTrend');

function snapshotPins(match, minutes) {
  const sorted = [...(match.snapshots || [])]
    .filter(s => s.minute != null)
    .sort((a, b) => a.minute - b.minute);

  const out = {};
  for (const m of minutes) {
    const sn = sorted.filter(x => x.minute <= m).pop() || null;
    out[String(m)] = sn == null ? null : summarizeSnapshot(sn);
  }
  return out;
}

function summarizeSnapshot(sn) {
  if (!sn) return null;
  const row = {
    minute: sn.minute,
    score: sn.scoreHome != null && sn.scoreAway != null ? `${sn.scoreHome}:${sn.scoreAway}` : null,
    ball_possession: sn.ballPossession || null,
    since2H_totals: sn.since2H ? statsTotalsCombined(sn.since2H) : null,
    last_delta: sn.delta ? deltaTotals(sn.delta) : null,
  };
  return row;
}

function statsTotalsCombined(block) {
  const ts = block.totalShots;
  const sot = block.shotsOnTarget;
  const ck = block.cornerKicks;
  const xg = block.expectedGoalsXg;
  const y = block.yellowCards;
  const r = block.redCards;

  let xgSum = null;
  if (xg?.home != null && xg?.away != null) xgSum = xg.home + xg.away;

  return {
    shots: (ts?.home || 0) + (ts?.away || 0),
    shots_on_target: (sot?.home || 0) + (sot?.away || 0),
    corners: (ck?.home || 0) + (ck?.away || 0),
    xg: xgSum,
    yellow_cards: (y?.home || 0) + (y?.away || 0),
    red_cards: (r?.home || 0) + (r?.away || 0),
  };
}

function deltaTotals(delta) {
  return statsTotalsCombined(delta);
}

function favoriteByOdds(match) {
  const p1 = match.derived?.p1Clean;
  const p2 = match.derived?.p2Clean;
  if (p1 == null || p2 == null) {
    const { p1Clean, p2Clean } = computeCleanProbs(match.odds);
    if (p1Clean == null || p2Clean == null) return 'unknown';
    return Math.abs(p1Clean - p2Clean) < 0.03 ? 'balanced' : (p1Clean > p2Clean ? 'home' : 'away');
  }
  return Math.abs(p1 - p2) < 0.03 ? 'balanced' : (p1 > p2 ? 'home' : 'away');
}

function baseline1HSummary(match) {
  const b = match.baseline1H;
  if (!b) return null;
  return {
    shots: { home: b.totalShots?.home ?? null, away: b.totalShots?.away ?? null },
    shots_on_target: { home: b.shotsOnTarget?.home ?? null, away: b.shotsOnTarget?.away ?? null },
    corners: { home: b.cornerKicks?.home ?? null, away: b.cornerKicks?.away ?? null },
    xg: { home: b.expectedGoalsXg?.home ?? null, away: b.expectedGoalsXg?.away ?? null },
    possession: { home: b.ballPossession?.home ?? null, away: b.ballPossession?.away ?? null },
    yellow_cards: { home: b.yellowCards?.home ?? null, away: b.yellowCards?.away ?? null },
    red_cards: { home: b.redCards?.home ?? null, away: b.redCards?.away ?? null },
  };
}

function standingsBrief(match) {
  const s = match.standings;
  if (!s?.home || !s?.away) return null;
  return {
    home_position: s.home.position ?? null,
    away_position: s.away.position ?? null,
    favoriteStrength: s.favoriteStrength ?? null,
  };
}

function h2hBrief(match) {
  const h = match.h2h;
  if (!h) return null;
  return {
    recentForm: h.recentForm ?? null,
    faceToFace: h.faceToFace ?? null,
    daysSinceLastMatch: h.daysSinceLastMatch ?? null,
  };
}

function halftimeResearchBrief(match) {
  const ht = match.aiAnalysis?.halftime?.output;
  if (!ht) return null;
  const probs = ht.probabilities || {};
  return {
    p_match_ends_0_0: probs.p_match_ends_0_0 ?? ht.p_match_ends_0_0 ?? null,
    p_match_has_goal: probs.p_match_has_goal ?? ht.p_match_has_goal ?? null,
    confidence: ht.confidence ?? null,
    expected_2h_pattern:
      ht.first_half_interpretation?.expected_2h_pattern
      || ht.first_half_context?.expected_2h_pattern
      || null,
    key_factor:
      ht.first_half_interpretation?.key_factor_driving_pattern
      || ht.first_half_context?.key_factor
      || null,
    research_quality: ht.research_meta?.research_quality ?? null,
  };
}

function since2HMissingXg(since2H) {
  const xg = since2H?.expectedGoalsXg;
  return xg?.home == null || xg?.away == null;
}

function baselineMissingXg(match) {
  const xg = match.baseline1H?.expectedGoalsXg;
  return xg?.home == null || xg?.away == null;
}

/**
 * Metrics recomputed from match — merged into stored AI output (authoritative numbers).
 */
function computeDecision60ServerMetrics(match) {
  const snaps = [...(match.snapshots || [])].sort((a, b) => (a.minute || 0) - (b.minute || 0));
  const at60 = snaps.filter(s => s.minute != null && s.minute <= 60).pop() || null;
  const since = at60?.since2H;

  const totals = since ? statsTotalsCombined(since) : {
    shots: 0,
    shots_on_target: 0,
    corners: 0,
    xg: null,
    yellow_cards: 0,
    red_cards: 0,
  };

  const dangerSecondHalf = calculateDangerScore({
    shots: totals.shots,
    shotsOnTarget: totals.shots_on_target,
    corners: totals.corners,
    xg: totals.xg,
    yellowCards: totals.yellow_cards,
    redCards: totals.red_cards,
  });

  const trendPack = computeTrendHints45to60(snaps);

  const missingXg = baselineMissingXg(match) || since2HMissingXg(since);

  return {
    second_half_activity: {
      shots_since_ht: totals.shots,
      shots_on_target_since_ht: totals.shots_on_target,
      corners_since_ht: totals.corners,
      xg_since_ht: totals.xg,
      danger_score: Math.round(dangerSecondHalf * 1000) / 1000,
    },
    dynamics_pack: {
      since2H_totals_at_60: totals,
      delta_45_60_precomputed: trendPack.delta_45_60,
      danger_50_55: trendPack.danger_50_55,
      danger_55_60: trendPack.danger_55_60,
      tempo_trend_hint: trendPack.tempo_trend_hint,
      attacking_trend_hint: trendPack.attacking_trend_hint,
      pressure_direction_hint_45_60: trendPack.pressure_direction_hint_45_60,
    },
    flags: { missing_xg: missingXg },
  };
}

function mergeDecision60ServerMetrics(match, aiNormalized) {
  const m = computeDecision60ServerMetrics(match);
  const out = { ...aiNormalized };
  out.second_half_activity = { ...m.second_half_activity };
  const rf = new Set([...(out.risk_flags || [])]);
  if (match.statsLevel === 'basic') rf.add('basic_stats_only');
  if (m.flags.missing_xg) rf.add('missing_xg');
  out.risk_flags = [...rf];
  return out;
}

/**
 * Structured bundle embedded in the Decision 60 user prompt.
 */
function buildDecision60Features(match) {
  const snaps = [...(match.snapshots || [])].sort((a, b) => (a.minute || 0) - (b.minute || 0));
  const at60 = snaps.filter(s => s.minute != null && s.minute <= 60).pop() || null;
  const derived = match.derived || {};
  const clean = {
    p1Clean: derived.p1Clean ?? computeCleanProbs(match.odds).p1Clean,
    pXClean: derived.pXClean ?? computeCleanProbs(match.odds).pXClean,
    p2Clean: derived.p2Clean ?? computeCleanProbs(match.odds).p2Clean,
  };

  const server = computeDecision60ServerMetrics(match);

  return {
    MATCH: {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league: match.league,
      country: match.country,
      currentMinute: 60,
      currentScore: '0:0',
      statsLevel: match.statsLevel || 'unknown',
    },
    MARKET: {
      odds_1x2: match.odds || null,
      favorite_by_odds: favoriteByOdds(match),
      marketSignal: derived.marketSignal ?? null,
      tableSignal: derived.tableSignal ?? null,
      p1Clean: clean.p1Clean,
      pXClean: clean.pXClean,
      p2Clean: clean.p2Clean,
    },
    BASELINE_1H: baseline1HSummary(match),
    ENRICHMENT_STATISTICS: match.statistics ?? null,
    SNAPSHOTS_PINNED: snapshotPins(match, [45, 50, 55, 60]),
    DYNAMICS: {
      since2H_at_60: at60?.since2H ?? null,
      last_delta_at_60: at60?.delta ?? null,
      delta_45_60_precomputed: server.dynamics_pack.delta_45_60_precomputed,
      tempo_trend_hint: server.dynamics_pack.tempo_trend_hint,
      attacking_trend_hint: server.dynamics_pack.attacking_trend_hint,
      pressure_direction_hint_45_60: server.dynamics_pack.pressure_direction_hint_45_60,
    },
    CONTEXT: {
      standings: standingsBrief(match),
      favoriteStrength: match.standings?.favoriteStrength ?? null,
      recentForm: match.h2h?.recentForm ?? null,
      H2H: match.h2h?.faceToFace ?? null,
      daysSinceLastMatch: match.h2h?.daysSinceLastMatch ?? null,
      halftimeResearch: halftimeResearchBrief(match),
    },
    PRECOMPUTED_FOR_MODEL: {
      second_half_activity: server.second_half_activity,
      danger_band_hint:
        '0–2 dead/low activity; 2–5 balanced; 5–8 pressure building; 8+ high pressure',
    },
  };
}

module.exports = {
  buildDecision60Features,
  computeDecision60ServerMetrics,
  mergeDecision60ServerMetrics,
  favoriteByOdds,
  snapshotPins,
  halftimeResearchBrief,
  statsTotalsCombined,
};
