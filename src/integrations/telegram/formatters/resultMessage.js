'use strict';

const { escapeMarkdownV2 } = require('./markdown');

function regularGoals(match) {
  const goals = match?.final?.goals;
  if (!Array.isArray(goals)) return [];
  return goals.filter((g) => !g?.isExtraTime);
}

function finalScore(match) {
  if (typeof match?.final?.scoreHome === 'number' && typeof match?.final?.scoreAway === 'number') {
    return `${match.final.scoreHome}:${match.final.scoreAway}`;
  }
  return '?:?';
}

function firstGoalMinute(match) {
  const g = regularGoals(match).find((goal) => typeof goal?.minute === 'number');
  return g ? g.minute : null;
}

function computeHit(decisionKey, match) {
  if (decisionKey === 'tm05') return match?.final?.resultTM05 === true;
  if (decisionKey === 'tb05') return match?.final?.resultTB05 === true;
  if (decisionKey === 'tm05_1h') {
    const fgm = firstGoalMinute(match);
    return fgm == null || fgm > 45;
  }
  return false;
}

function formatResultMessage({ outboxRecord, match }) {
  if (!outboxRecord || !match?.final) return null;
  const decisionKey = outboxRecord.decisionKey;
  if (decisionKey !== 'tm05' && decisionKey !== 'tb05' && decisionKey !== 'tm05_1h') return null;

  const outboxHit = outboxRecord?.result?.hit;
  const hit = typeof outboxHit === 'boolean' ? outboxHit : computeHit(decisionKey, match);
  const label = decisionKey === 'tb05' ? 'ТБ 0,5'
    : decisionKey === 'tm05_1h' ? '1HUNDER ТМ 0,5 тайму' : 'ТМ 0,5';
  const status = hit ? '✅ *HIT*' : '❌ *MISS*';
  const lines = [`${status} · ${escapeMarkdownV2(label)}`, `Фінал: ${escapeMarkdownV2(finalScore(match))}`];

  if ((decisionKey === 'tm05' || decisionKey === 'tm05_1h') && !hit) {
    const fgm = firstGoalMinute(match);
    if (fgm != null) lines.push(`Перший гол: ${escapeMarkdownV2(String(fgm))}'`);
  }
  if (decisionKey === 'tb05' && hit) {
    const fgm = firstGoalMinute(match);
    if (fgm != null) lines.push(`Гол: ${escapeMarkdownV2(String(fgm))}'`);
  }

  return lines.join('\n');
}

module.exports = {
  formatResultMessage,
  finalScore,
  regularGoals,
  firstGoalMinute,
  computeHit,
};
