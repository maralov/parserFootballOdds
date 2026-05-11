'use strict';

function probsPairOk(pA, pB, tol = 0.08) {
  return Math.abs(pA + pB - 1) <= tol;
}

function decision60UseInModel(match, header, normalized) {
  if (!normalized || !match || !header) return false;
  if (header.scoreHome !== 0 || header.scoreAway !== 0) return false;
  if ((normalized.confidence ?? 0) < 0.55) return false;

  const p = normalized.probabilities || {};
  if (!probsPairOk(p.p_match_ends_0_0 ?? 0, p.p_goal_after_60 ?? 0)) return false;

  const subOk = Math.abs(
    (p.p_goal_60_75 ?? 0) + (p.p_goal_after_75 ?? 0) - (p.p_goal_after_60 ?? 0),
  ) <= 0.15;
  if (!subOk) return false;

  const act = normalized.second_half_activity || {};
  const enoughActivity =
    (act.shots_since_ht ?? 0) >= 2
    || (act.shots_on_target_since_ht ?? 0) >= 1
    || (act.corners_since_ht ?? 0) >= 2
    || (act.xg_since_ht ?? 0) >= 0.08;

  return match.statsLevel === 'detailed' || enoughActivity;
}

function decision80UseInModel(match, header, normalized) {
  if (!normalized || !match || !header) return false;
  if (header.scoreHome !== 0 || header.scoreAway !== 0) return false;
  if ((normalized.confidence ?? 0) < 0.55) return false;

  const p = normalized.probabilities || {};
  if (!probsPairOk(p.p_match_ends_0_0 ?? 0, p.p_goal_after_80 ?? 0)) return false;

  const st = p.p_goal_in_stoppage_time ?? 0;
  const ga = p.p_goal_after_80 ?? 0;
  if (st > ga + 0.05) return false;

  const l10 = normalized.last_10_minutes || {};
  const enoughActivity =
    (l10.shots ?? 0) >= 1
    || (l10.shots_on_target ?? 0) >= 1
    || (l10.corners ?? 0) >= 2
    || (l10.xg ?? 0) >= 0.05;

  return match.statsLevel === 'detailed' || enoughActivity;
}

module.exports = {
  decision60UseInModel,
  decision80UseInModel,
  probsPairOk,
};
