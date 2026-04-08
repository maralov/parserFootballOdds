const { toISO } = require('../helpers/date');

const CONTRACT_VERSION = '1.0.0';

function createLiveMatchCandidate(payload = {}) {
  return {
    id: payload.id || '',
    league: payload.league || 'unknown',
    home: payload.home || '',
    away: payload.away || '',
    minute: Number(payload.minute || 0),
    score: {
      home: String(payload.score?.home ?? '0'),
      away: String(payload.score?.away ?? '0'),
    },
    matchDetailsUrl: payload.matchDetailsUrl || '',
    provider: payload.provider || 'flashscore-mobile-ua',
  };
}

function createFeaturePayload(payload = {}) {
  return {
    matchId: payload.matchId || '',
    league: payload.league || 'unknown',
    minute: Number(payload.minute || 0),
    expectedGoalsXg: payload.expectedGoalsXg,
    shotsOnTarget: payload.shotsOnTarget,
    touchesInOppositionBox: payload.touchesInOppositionBox,
    dataQualityScore: Number(payload.dataQualityScore || 0),
    availableMetrics: Number(payload.availableMetrics || 0),
    minuteBucket: payload.minuteBucket || '70-75',
    allowDecision: Boolean(payload.allowDecision),
  };
}

function createRunContext() {
  const iso = toISO();
  const runId = `${iso.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    runId,
    startedAt: iso,
    contractVersion: CONTRACT_VERSION,
  };
}

module.exports = {
  CONTRACT_VERSION,
  createLiveMatchCandidate,
  createFeaturePayload,
  createRunContext,
};
