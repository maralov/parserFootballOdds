'use strict';

const { escapeMarkdownV2, escapeMarkdownV2LinkUrl } = require('./markdown');
const { buildFlashscoreDesktopUrl } = require('./flashscoreUrl');
const { modelModeLabel } = require('./modeLabels');

function round2(value) {
  return Number(value.toFixed(2)).toString();
}

function fixed2(value) {
  return Number(value).toFixed(2);
}

function decisionTitle(predictionType) {
  if (predictionType === 'FT_TM05_FROM_60_75') return 'FT TM0.5';
  if (predictionType === 'TB05_80_PLUS') return "TB0.5 after 80'";
  return String(predictionType || '');
}

function renderComponents(components, predictionType) {
  const source = components && typeof components === 'object' ? components : {};
  const byType = {
    FT_TM05_FROM_60_75: [
      'fullTimeNilNilScore',
      'dryStateScore',
      'realPressureScore60_75',
      'fakePressureScore60_75',
      'lateActivationRisk',
      'aiScenarioScore',
    ],
    TB05_80_PLUS: [
      'lateGoalScore80',
      'realPressureScore70_80',
      'fakePressureScore70_80',
      'tempoTrend70_80',
      'aiScenarioScore',
    ],
  };

  const keys = byType[predictionType] || [];
  const lines = [];
  for (const key of keys) {
    if (source[key] === null || source[key] === undefined) continue;
    const value = typeof source[key] === 'number' ? round2(source[key]) : String(source[key]);
    lines.push(`• ${escapeMarkdownV2(key)}: ${escapeMarkdownV2(value)}`);
  }
  return lines.join('\n');
}

function renderOdds(odds) {
  if (!odds || typeof odds !== 'object') return '';
  if (![odds.home, odds.draw, odds.away].every((v) => typeof v === 'number')) return '';
  const base = `• 1: ${escapeMarkdownV2(fixed2(odds.home))} · X: ${escapeMarkdownV2(fixed2(odds.draw))} · 2: ${escapeMarkdownV2(fixed2(odds.away))}`;
  const favorite = odds.isOddsFavorite?.favorite;
  const margin = odds.isOddsFavorite?.margin;
  if (typeof favorite === 'string' && typeof margin === 'number') {
    return `${base} · fav: ${escapeMarkdownV2(favorite)} \\(margin ${escapeMarkdownV2(fixed2(margin))}\\)`;
  }
  return base;
}

function pickTeams(match) {
  const home = match?.homeTeam || match?.home || match?.teams?.home || match?.participants?.home;
  const away = match?.awayTeam || match?.away || match?.teams?.away || match?.participants?.away;
  return { home, away };
}

function formatEntryMessage({ match, prediction, decisionKey, minute, score }) {
  if (!match) return null;
  const { home, away } = pickTeams(match);
  if (!home || !away) return null;

  const predictionType = prediction?.predictionType || match?.predictions?.[decisionKey]?.predictionType || '';
  const title = decisionTitle(predictionType);
  const modeLabel = modelModeLabel(prediction?.modelMode);
  const league = match.league || match.tournament || match.competition || 'Unknown league';
  const scoreText = score || match.score || match.currentScore || '?:?';
  const desktopUrl = buildFlashscoreDesktopUrl(match.matchUrl || match.url || match.detailUrl);

  const lines = [
    `🎯 *${escapeMarkdownV2(title)}* · ${escapeMarkdownV2(modeLabel)} · ${escapeMarkdownV2(minute ?? '?')}'`,
    `🏟 *${escapeMarkdownV2(home)} — ${escapeMarkdownV2(away)}*`,
    `🏆 ${escapeMarkdownV2(league)} · ${escapeMarkdownV2(scoreText)}`,
    '',
    '📊 *Параметри рішення:*',
  ];

  const renderedComponents = renderComponents(prediction?.components, predictionType);
  if (renderedComponents) lines.push(renderedComponents);

  if (prediction?.confidence !== null && prediction?.confidence !== undefined) {
    lines.push(`• Confidence: ${escapeMarkdownV2(fixed2(prediction.confidence))}`);
  }
  if (Array.isArray(prediction?.riskFlags) && prediction.riskFlags.length) {
    const flags = prediction.riskFlags.map((f) => escapeMarkdownV2(String(f))).join(', ');
    lines.push(`• Risk flags: ${flags}`);
  }

  const aiScenario = prediction?.aiOverlay?.scenario || prediction?.aiScenario || prediction?.components?.aiScenario;
  if (aiScenario) {
    const tier = prediction?.tier ? ` \\(${escapeMarkdownV2(String(prediction.tier))}\\)` : '';
    lines.push(`• AI: ${escapeMarkdownV2(String(aiScenario))}${tier}`);
  }

  const oddsLine = renderOdds(match.odds);
  if (oddsLine) {
    lines.push('', '💰 *Pre-match odds:*', oddsLine);
  }

  if (desktopUrl) {
    lines.push('', `🔗 [Flashscore desktop](${escapeMarkdownV2LinkUrl(desktopUrl)})`);
  }

  return lines.join('\n');
}

module.exports = {
  formatEntryMessage,
  decisionTitle,
  renderComponents,
  renderOdds,
};
