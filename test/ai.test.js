'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  MATCH_STATES,
  DOMINANT_SIDES,
  DEFAULT_AI_MODEL,
} = require('../src/ai/constants');
const { validateAIResponse } = require('../src/ai/schemas');
const { calculateCost } = require('../src/ai/costCalculator');
const {
  buildFiveMinWindows,
  buildHalftimePrompt,
  buildDecision60Prompt,
  buildDecision80Prompt,
} = require('../src/ai/prompts');
const { callAI } = require('../src/ai/aiClient');
const matchStore = require('../src/store/matchStore');
const {
  maybeRequestAI,
  determineCheckpoint,
  shouldRunCheckpoint,
} = require('../src/ai/aiOrchestrator');
const { printTracking } = require('../src/observability/display');

describe('ai constants', () => {
  test('exposes allowed enums and default model', () => {
    assert.deepEqual(MATCH_STATES, [
      'low_tempo',
      'balanced',
      'building_pressure',
      'high_tempo',
    ]);
    assert.deepEqual(DOMINANT_SIDES, ['home', 'away', 'none']);
    assert.equal(DEFAULT_AI_MODEL, 'gpt-4o');
  });
});

describe('schemas.validateAIResponse', () => {
  test('accepts valid AI response payload', () => {
    const result = validateAIResponse({
      p_match_ends_0_0: 0.62,
      p_match_has_goal: 0.38,
      match_state: 'low_tempo',
      dominant_side: 'away',
      key_observations: ['a', 'b', 'c'],
      confidence: 0.71,
    });

    assert.deepEqual(result, { ok: true, error: null });
  });

  test('rejects payloads when probabilities do not sum to one', () => {
    const result = validateAIResponse({
      p_match_ends_0_0: 0.62,
      p_match_has_goal: 0.48,
      match_state: 'low_tempo',
      dominant_side: 'away',
      key_observations: ['a', 'b', 'c'],
      confidence: 0.71,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /sum/i);
  });

  test('rejects payloads with invalid match_state', () => {
    const result = validateAIResponse({
      p_match_ends_0_0: 0.62,
      p_match_has_goal: 0.38,
      match_state: 'chaotic',
      dominant_side: 'away',
      key_observations: ['a', 'b', 'c'],
      confidence: 0.71,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /match_state/i);
  });
});

describe('costCalculator.calculateCost', () => {
  test('calculates gpt-4o request cost from token usage', () => {
    const cost = calculateCost({
      prompt_tokens: 500,
      completion_tokens: 200,
    }, 'gpt-4o');

    assert.equal(cost, 0.00325);
  });

  test('returns null for unknown model', () => {
    assert.equal(calculateCost({
      prompt_tokens: 500,
      completion_tokens: 200,
    }, 'unknown-model'), null);
  });
});

describe('prompts', () => {
  const match = {
    homeTeam: 'St Albans',
    awayTeam: 'Green Gully',
    country: 'AUSTRALIA',
    league: 'NPL Victoria',
    odds: { home: 2.01, draw: 4.02, away: 3.1 },
    derived: { marketSignal: 0.12, tableSignal: -0.2 },
    statsLevel: 'detailed',
    baseline1H: {
      totalShots: { home: 7, away: 3 },
      shotsOnTarget: { home: 3, away: 0 },
      cornerKicks: { home: 6, away: 0 },
      expectedGoalsXg: { home: 0.82, away: 0.14 },
      ballPossession: { home: 68, away: 32 },
      yellowCards: { home: 1, away: 2 },
      redCards: { home: 0, away: 0 },
    },
    standings: {
      totalTeams: 14,
      home: { position: 10, pts: 13, mp: 11 },
      away: { position: 6, pts: 17, mp: 11 },
    },
    h2h: {
      recentForm: {
        home: [{ result: 'W' }, { result: 'D' }, { result: 'L' }],
        away: [{ result: 'W' }, { result: 'W' }, { result: 'D' }],
      },
      faceToFace: [{ score: '1:0' }, { score: '0:0' }],
    },
    snapshots: [
      {
        minute: 52,
        delta: {
          totalShots: { home: 2, away: 1 },
          shotsOnTarget: { home: 1, away: 0 },
          expectedGoalsXg: { home: 0.18, away: 0.04 },
          cornerKicks: { home: 1, away: 0 },
        },
      },
      {
        minute: 57,
        delta: {
          totalShots: { home: 1, away: 2 },
          shotsOnTarget: { home: 0, away: 1 },
          expectedGoalsXg: { home: 0.03, away: 0.11 },
          cornerKicks: { home: 0, away: 1 },
        },
      },
      {
        minute: 60,
        ballPossession: { home: 55, away: 45 },
        since2H: {
          totalShots: { home: 3, away: 3 },
          shotsOnTarget: { home: 1, away: 1 },
          cornerKicks: { home: 1, away: 1 },
          expectedGoalsXg: { home: 0.21, away: 0.15 },
        },
        delta: {
          totalShots: { home: 0, away: 0 },
          shotsOnTarget: { home: 0, away: 0 },
          expectedGoalsXg: { home: 0, away: 0 },
          cornerKicks: { home: 0, away: 0 },
        },
      },
      {
        minute: 80,
        ballPossession: { home: 52, away: 48 },
        since2H: {
          totalShots: { home: 7, away: 8 },
          shotsOnTarget: { home: 2, away: 4 },
          cornerKicks: { home: 2, away: 3 },
          expectedGoalsXg: { home: 0.48, away: 0.72 },
        },
        delta: {
          totalShots: { home: 2, away: 3 },
          shotsOnTarget: { home: 1, away: 1 },
          expectedGoalsXg: { home: 0.14, away: 0.19 },
          cornerKicks: { home: 1, away: 1 },
        },
      },
    ],
    aiAnalysis: {
      halftime: {
        output: {
          p_match_ends_0_0: 0.58,
          match_state: 'balanced',
          dominant_side: 'home',
          confidence: 0.63,
        },
      },
      decision60: {
        output: {
          p_match_ends_0_0: 0.45,
          p_match_has_goal: 0.55,
          match_state: 'building_pressure',
          dominant_side: 'away',
          confidence: 0.67,
        },
      },
    },
  };

  test('buildFiveMinWindows aggregates delta stats per snapshot', () => {
    const windows = buildFiveMinWindows(match.snapshots);

    assert.deepEqual(windows[0], {
      minute: 52,
      shots_total: 3,
      sot_total: 1,
      xg_total: 0.22,
      corners: 1,
    });
  });

  test('buildHalftimePrompt includes teams and first-half summary', () => {
    const prompt = buildHalftimePrompt(match);

    assert.match(prompt.system, /аналітик футбольних матчів/i);
    assert.match(prompt.user, /St Albans/);
    assert.match(prompt.user, /Green Gully/);
    assert.match(prompt.user, /0\.82 - 0\.14/);
  });

  test('buildDecision60Prompt includes 5-minute windows and halftime AI summary', () => {
    const prompt = buildDecision60Prompt(match);

    assert.match(prompt.user, /поточна хвилина 60/i);
    assert.match(prompt.user, /52\s+\|\s+3\s+\|\s+1\s+\|\s+0\.22\s+\|\s+1/);
    assert.match(prompt.user, /ОЦІНКА В ПЕРЕРВІ \(AI\)/);
    assert.match(prompt.user, /0\.58/);
  });

  test('buildDecision80Prompt includes remaining-time context and decision60 summary', () => {
    const prompt = buildDecision80Prompt(match);

    assert.match(prompt.user, /10 регулярних хвилин \+ компенсований час/);
    assert.match(prompt.user, /ОЦІНКА НА 60-Й ХВИЛИНІ \(AI\)/);
    assert.match(prompt.user, /0\.45/);
  });
});

describe('aiClient.callAI', () => {
  test('returns validated output with usage and cost metadata', async () => {
    let attempts = 0;
    const result = await callAI({
      system: 'system',
      user: 'user',
      model: 'gpt-4o',
      temperature: 0.2,
      maxTokens: 500,
      timeoutMs: 1000,
      maxRetries: 2,
    }, {
      requester: async () => {
        attempts += 1;
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                p_match_ends_0_0: 0.6,
                p_match_has_goal: 0.4,
                match_state: 'balanced',
                dominant_side: 'none',
                key_observations: ['a', 'b', 'c'],
                confidence: 0.7,
              }),
            },
          }],
          usage: { prompt_tokens: 500, completion_tokens: 200 },
        };
      },
      sleep: async () => {},
    });

    assert.equal(attempts, 1);
    assert.equal(result.error, null);
    assert.equal(result.model, 'gpt-4o');
    assert.equal(result.costUsd, 0.00325);
    assert.equal(result.promptTokens, 500);
    assert.equal(result.completionTokens, 200);
    assert.equal(result.output.p_match_ends_0_0, 0.6);
  });

  test('retries schema failures and returns final error', async () => {
    let attempts = 0;
    const result = await callAI({
      system: 'system',
      user: 'user',
      model: 'gpt-4o',
      temperature: 0.2,
      maxTokens: 500,
      timeoutMs: 1000,
      maxRetries: 2,
    }, {
      requester: async () => {
        attempts += 1;
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                p_match_ends_0_0: 0.9,
                p_match_has_goal: 0.9,
                match_state: 'balanced',
                dominant_side: 'none',
                key_observations: ['a', 'b', 'c'],
                confidence: 0.7,
              }),
            },
          }],
          usage: { prompt_tokens: 500, completion_tokens: 200 },
        };
      },
      sleep: async () => {},
    });

    assert.equal(attempts, 2);
    assert.equal(result.output, null);
    assert.match(result.error, /probabilities/i);
  });
});

describe('matchStore AI helpers', () => {
  const date = new Date('2099-01-01T12:00:00.000Z');
  const logDir = path.resolve(__dirname, '../data/logs/2099-01-01');

  test('setAiAnalysis stores checkpoint result and updates totals', () => {
    fs.rmSync(logDir, { recursive: true, force: true });

    matchStore.upsertFromEnrichment({
      matchId: 'ai-match-1',
      homeTeam: 'Home',
      awayTeam: 'Away',
      statistics: { '1half': { home: {}, away: {} } },
      statsLevel: 'detailed',
    }, date);

    matchStore.setAiAnalysis('ai-match-1', 'halftime', {
      output: {
        p_match_ends_0_0: 0.55,
        p_match_has_goal: 0.45,
        match_state: 'balanced',
        dominant_side: 'none',
        key_observations: ['a', 'b', 'c'],
        confidence: 0.6,
      },
      costUsd: 0.004,
    }, date);

    const stored = matchStore.getMatch('ai-match-1', date);
    assert.equal(stored.aiAnalysis.halftime.output.p_match_ends_0_0, 0.55);
    assert.equal(stored.aiAnalysis.totalCostUsd, 0.004);
    assert.equal(stored.aiAnalysis.requestCount, 1);
    assert.equal(matchStore.hasAiCheckpoint('ai-match-1', 'halftime', date), true);
  });

  test('upsertFromEnrichment precomputes derived market and table signals', () => {
    const derivedDate = new Date('2099-01-04T12:00:00.000Z');
    const derivedDir = path.resolve(__dirname, '../data/logs/2099-01-04');
    fs.rmSync(derivedDir, { recursive: true, force: true });

    const record = matchStore.upsertFromEnrichment({
      matchId: 'ai-match-2',
      homeTeam: 'Home',
      awayTeam: 'Away',
      statistics: { '1half': { home: {}, away: {} } },
      statsLevel: 'detailed',
      odds: { home: 2.1, draw: 3.2, away: 3.6 },
      standings: {
        home: { pts: 20, mp: 10 },
        away: { pts: 12, mp: 10 },
      },
    }, derivedDate);

    assert.equal(typeof record.derived.marketSignal, 'number');
    assert.equal(typeof record.derived.tableSignal, 'number');
  });

  test('upsertFromEnrichment backfills derived for existing records', () => {
    const backfillDate = new Date('2099-01-07T12:00:00.000Z');
    const backfillDir = path.resolve(__dirname, '../data/logs/2099-01-07');
    const backfillFile = path.join(backfillDir, 'matches.json');
    fs.rmSync(backfillDir, { recursive: true, force: true });

    matchStore.upsertFromEnrichment({
      matchId: 'ai-match-4',
      homeTeam: 'Home',
      awayTeam: 'Away',
      statistics: { '1half': { home: {}, away: {} } },
      statsLevel: 'detailed',
      odds: { home: 2.1, draw: 3.2, away: 3.6 },
      standings: {
        home: { pts: 20, mp: 10 },
        away: { pts: 12, mp: 10 },
      },
    }, backfillDate);

    const store = JSON.parse(fs.readFileSync(backfillFile, 'utf8'));
    store['ai-match-4'].derived = null;
    fs.writeFileSync(backfillFile, JSON.stringify(store, null, 2), 'utf8');

    const record = matchStore.upsertFromEnrichment({
      matchId: 'ai-match-4',
      homeTeam: 'Home',
      awayTeam: 'Away',
      statistics: { '1half': { home: {}, away: {} } },
      statsLevel: 'detailed',
      odds: { home: 2.1, draw: 3.2, away: 3.6 },
      standings: {
        home: { pts: 20, mp: 10 },
        away: { pts: 12, mp: 10 },
      },
    }, backfillDate);

    assert.equal(typeof record.derived.marketSignal, 'number');
    assert.equal(typeof record.derived.tableSignal, 'number');
  });
});

describe('aiOrchestrator filters', () => {
  test('determineCheckpoint picks halftime before valid 60-minute checkpoint', () => {
    const checkpoint = determineCheckpoint({
      minute: 47,
      scoreHome: 0,
      scoreAway: 0,
    }, {
      tracking: { validForPrediction: false },
      aiAnalysis: {},
    });

    assert.equal(checkpoint, 'halftime');
  });

  test('shouldRunCheckpoint skips basic stats matches', () => {
    const decision = shouldRunCheckpoint('halftime', {
      statsLevel: 'basic',
      baseline1H: { expectedGoalsXg: { home: null, away: null } },
      aiAnalysis: {},
    }, {
      LIVE_AI_HT_XG_THRESHOLD: 1.5,
      OPENAI_API_KEY: 'key',
      LIVE_AI_ENABLED: true,
    });

    assert.deepEqual(decision, {
      run: false,
      skipReason: 'stats_level_not_detailed',
    });
  });

  test('shouldRunCheckpoint allows decision60 for valid detailed match', () => {
    const decision = shouldRunCheckpoint('decision60', {
      statsLevel: 'detailed',
      tracking: { validForPrediction: true },
      aiAnalysis: {},
    }, {
      LIVE_AI_HT_XG_THRESHOLD: 1.5,
      OPENAI_API_KEY: 'key',
      LIVE_AI_ENABLED: true,
    });

    assert.deepEqual(decision, { run: true, skipReason: null });
  });

  test('maybeRequestAI marks checkpoint pending and avoids duplicate in-flight calls', async () => {
    const date = new Date('2099-01-03T12:00:00.000Z');
    const logDir = path.resolve(__dirname, '../data/logs/2099-01-03');
    fs.rmSync(logDir, { recursive: true, force: true });

    matchStore.upsertFromEnrichment({
      matchId: 'ai-match-3',
      homeTeam: 'Home',
      awayTeam: 'Away',
      statistics: {
        '1half': {
          home: { expectedGoalsXg: 0.2 },
          away: { expectedGoalsXg: 0.1 },
        },
      },
      statsLevel: 'detailed',
      odds: { home: 2.2, draw: 3.1, away: 3.5 },
      standings: {
        home: { pts: 18, mp: 10 },
        away: { pts: 16, mp: 10 },
      },
    }, date);

    let calls = 0;
    let resolveCall;
    const resultPromise = new Promise(resolve => {
      resolveCall = resolve;
    });

    const cfg = {
      LIVE_AI_ENABLED: true,
      OPENAI_API_KEY: 'key',
      LIVE_AI_HT_XG_THRESHOLD: 1.5,
      LIVE_AI_MODEL: 'gpt-4o',
      LIVE_AI_TEMPERATURE: 0.2,
      LIVE_AI_MAX_TOKENS: 500,
      LIVE_AI_TIMEOUT_MS: 1000,
      LIVE_AI_MAX_RETRIES: 1,
    };

    const header = { minute: 47, scoreHome: 0, scoreAway: 0 };
    const match = matchStore.getMatch('ai-match-3', date);

    const p1 = maybeRequestAI('ai-match-3', header, match, date, {
      env: cfg,
      matchStore,
      callAI: async () => {
        calls += 1;
        return resultPromise;
      },
    });

    const pending = matchStore.getMatch('ai-match-3', date);
    assert.equal(pending.aiAnalysis.halftime.pending, true);

    const p2 = maybeRequestAI('ai-match-3', header, pending, date, {
      env: cfg,
      matchStore,
      callAI: async () => {
        calls += 1;
        return resultPromise;
      },
    });

    assert.equal(calls, 1);

    resolveCall({
      output: {
        p_match_ends_0_0: 0.61,
        p_match_has_goal: 0.39,
        match_state: 'balanced',
        dominant_side: 'none',
        key_observations: ['one', 'two', 'three'],
        confidence: 0.74,
      },
      latencyMs: 12,
      promptTokens: 100,
      completionTokens: 50,
      model: 'gpt-4o',
      costUsd: 0.00075,
      error: null,
    });

    await Promise.all([p1, p2]);

    const stored = matchStore.getMatch('ai-match-3', date);
    assert.equal(stored.aiAnalysis.halftime.pending, undefined);
    assert.equal(stored.aiAnalysis.requestCount, 1);
    assert.equal(stored.aiAnalysis.halftime.output.p_match_ends_0_0, 0.61);
  });

  test('maybeRequestAI persists thrown AI errors instead of leaving pending forever', async () => {
    const date = new Date('2099-01-06T12:00:00.000Z');
    const logDir = path.resolve(__dirname, '../data/logs/2099-01-06');
    fs.rmSync(logDir, { recursive: true, force: true });

    matchStore.upsertFromEnrichment({
      matchId: 'ai-match-5',
      homeTeam: 'Home',
      awayTeam: 'Away',
      statistics: {
        '1half': {
          home: { expectedGoalsXg: 0.2 },
          away: { expectedGoalsXg: 0.1 },
        },
      },
      statsLevel: 'detailed',
      odds: { home: 2.2, draw: 3.1, away: 3.5 },
      standings: {
        home: { pts: 18, mp: 10 },
        away: { pts: 16, mp: 10 },
      },
    }, date);

    await maybeRequestAI('ai-match-5', { minute: 47, scoreHome: 0, scoreAway: 0 }, matchStore.getMatch('ai-match-5', date), date, {
      env: {
        LIVE_AI_ENABLED: true,
        OPENAI_API_KEY: 'key',
        LIVE_AI_HT_XG_THRESHOLD: 1.5,
        LIVE_AI_MODEL: 'gpt-4o',
        LIVE_AI_TEMPERATURE: 0.2,
        LIVE_AI_MAX_TOKENS: 500,
        LIVE_AI_TIMEOUT_MS: 1000,
        LIVE_AI_MAX_RETRIES: 1,
      },
      matchStore,
      callAI: async () => {
        throw new Error('boom');
      },
    });

    const stored = matchStore.getMatch('ai-match-5', date);
    assert.equal(stored.aiAnalysis.halftime.pending, undefined);
    assert.equal(stored.aiAnalysis.halftime.error, 'boom');
    assert.equal(stored.aiAnalysis.requestCount, 1);
  });
});

describe('display.printTracking AI tags', () => {
  test('prints AI checkpoint statuses for active matches', () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));

    try {
      printTracking([{
        matchId: 'match-1',
        homeTeam: 'Home',
        awayTeam: 'Away',
        tracking: {
          status: 'active',
          validForPrediction: true,
          nextSnapshotAt: new Date(Date.now() + 60_000).toISOString(),
        },
        snapshots: [{
          minute: 67,
          scoreHome: 0,
          scoreAway: 0,
          cumulative: {
            totalShots: { home: 6, away: 8 },
            expectedGoalsXg: { home: 0.42, away: 0.55 },
          },
        }],
        aiAnalysis: {
          halftime: { output: { p_match_ends_0_0: 0.6 } },
          decision60: { skipped: true },
          decision80: undefined,
        },
      }], 1);
    } finally {
      console.log = originalLog;
    }

    const combined = lines.join('\n');
    assert.match(combined, /AI:HT✓ D60skip D80—/);
  });
});
