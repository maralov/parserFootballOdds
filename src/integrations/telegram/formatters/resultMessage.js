'use strict';

const { escapeMarkdownV2 } = require('./markdown');

function regularGoals(match) {
  const goals = match?.final?.goals;
  if (!Array.isArray(goals)) return [];
  return goals.filter((g) => !g?.isExtraTime);
}

function finalScore(match) {
  if (match?.final?.score) return String(match.final.score);
  if (typeof match?.final?.scoreHome === 'number' && typeof match?.final?.scoreAway === 'number') {
    return `${match.final.scoreHome}:${match.final.scoreAway}`;
  }
  const goals = regularGoals(match);
  if (!goals.length) return '?:?';
  const canDerive = goals.every((g) => g?.team === 'home' || g?.team === 'away');
  if (!canDerive) return '?:?';
  const home = goals.filter((g) => g?.team === 'home').length;
  const away = goals.filter((g) => g?.team === 'away').length;
  return `${home}:${away}`;
}

function firstGoalAfterMinute(match, minute) {
  return regularGoals(match).find((goal) => typeof goal?.minute === 'number' && goal.minute > minute) || null;
}

function computeHit(predictionType, match) {
  if (predictionType === 'FT_TM05_FROM_60_75') {
    return regularGoals(match).length === 0;
  }
  if (predictionType === 'TB05_80_PLUS') {
    return Boolean(firstGoalAfterMinute(match, 80));
  }
  return false;
}

function formatResultMessage({ outboxRecord, match }) {
  if (!outboxRecord || !match?.final) return null;

  const predictionType = outboxRecord.predictionType;
  const decisionKey = outboxRecord.decisionKey;
  const outboxHit = outboxRecord?.result?.hit;
  const auditHit = match?.predictions?.[decisionKey]?.predictionAudit?.hit;
  const hit = typeof outboxHit === 'boolean'
    ? outboxHit
    : (typeof auditHit === 'boolean' ? auditHit : computeHit(predictionType, match));

  if (predictionType === 'FT_TM05_FROM_60_75') {
    const status = hit ? '✅ *HIT*' : '❌ *MISS*';
    const lines = [`${status} · FT TM0\\.5`, `Фінал: ${escapeMarkdownV2(finalScore(match))}`];
    if (!hit) {
      const first = regularGoals(match).find((g) => typeof g?.minute === 'number');
      if (first) lines.push(`Перший гол: ${escapeMarkdownV2(first.minute)}'`);
    }
    return lines.join('\n');
  }

  if (predictionType === 'TB05_80_PLUS') {
    if (hit) {
      const goal = firstGoalAfterMinute(match, 80);
      const suffix = goal?.scoreAfter ? ` · ${escapeMarkdownV2(goal.scoreAfter)}` : '';
      return `✅ *HIT* · TB0\\.5 after 80'\nГол після 80': ${escapeMarkdownV2(goal?.minute ?? '?')}'${suffix}`;
    }
    return `❌ *MISS* · TB0\\.5 after 80'\nФінал: ${escapeMarkdownV2(finalScore(match))} — голу після 80' не було\\.`;
  }

  return null;
}

module.exports = {
  formatResultMessage,
  finalScore,
  regularGoals,
  firstGoalAfterMinute,
};
