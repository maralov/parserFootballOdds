'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

after(() => {
  const logsRoot = path.resolve(__dirname, '../data/logs');
  if (!fs.existsSync(logsRoot)) return;
  for (const entry of fs.readdirSync(logsRoot)) {
    if (entry.startsWith('2099-')) {
      fs.rmSync(path.join(logsRoot, entry), { recursive: true, force: true });
    }
  }
});

const {
  MATCH_STATES,
  DOMINANT_SIDES,
  DEFAULT_AI_MODEL,
  SYSTEM_PROMPT_HALFTIME,
  SYSTEM_PROMPT_HALFTIME_RESEARCH,
} = require('../src/ai/constants');
const { validateDecision60Response } = require('../src/ai/schemas/decision60Schema');
const { validateDecision80Response, normalizeDecision80 } = require('../src/ai/schemas/decision80Schema');
const { validateHalftimeResearchResponse } = require('../src/ai/halftimeSchema');
const { calculateCost, calculateResponsesCost } = require('../src/ai/costCalculator');
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
  buildPromptForCheckpoint,
} = require('../src/ai/aiOrchestrator');
const { printTracking } = require('../src/observability/display');
const { performHalftimeResearch, parseJsonFromResponsesText } = require('../src/ai/halftimeResponses');

function sampleHalftimeOutput(patch = {}) {
  const base = {
    research_meta: {
      search_queries_made: ['q1'],
      sources_consulted: 7,
      research_quality: 0.72,
      data_freshness_days: 1,
      language_of_sources: 'en',
    },
    home_team: {
      starting_lineup_known: true,
      lineup_strength_vs_normal: 0.82,
      key_absences: [],
      form_last_5: 'WWWDD',
      form_quality_assessment: 'average',
      team_internal_state: 'stable',
      coach_situation: 'secure',
      tactical_style: 'Баланс володіння.',
      late_game_pattern: 'balanced',
    },
    away_team: {
      starting_lineup_known: false,
      lineup_strength_vs_normal: 0.71,
      key_absences: [],
      form_last_5: 'WWWDD',
      form_quality_assessment: 'below_average',
      team_internal_state: 'minor_tension',
      coach_situation: 'under_pressure',
      tactical_style: 'Контратаки.',
      late_game_pattern: 'defensive',
    },
    match_context: {
      tournament_importance_home: 2,
      tournament_importance_away: 2,
      tournament_importance_explanation_home: 'Боротьба за місце.',
      tournament_importance_explanation_away: 'Тиск ізнизу.',
      rotation_risk_home: 0.1,
      rotation_risk_away: 0.15,
      is_derby_or_rivalry: false,
      rivalry_notes: null,
      weather: { conditions: 'not_found', may_affect_play: false },
      pitch_condition: 'good',
      venue_factor: null,
    },
    h2h_qualitative: {
      common_pattern: 'Низькі рахунки.',
      notable_recent_h2h: '0:0 восени.',
      h2h_low_scoring_tendency: true,
    },
    first_half_interpretation: {
      score_consistent_with_research: true,
      explanation: 'Мало явних нагоди.',
      expected_2h_pattern: 'balanced',
      key_factor_driving_pattern: 'Низький темп і ротація.',
    },
    probabilities: {
      p_match_ends_0_0: 0.55,
      p_match_has_goal: 0.45,
      reasoning_for_probabilities: 'Низький темп. Свіжі склади без сенсацій.',
    },
    confidence: 0.72,
    red_flags: [],
  };
  const { probabilities: pOverrides, ...rest } = patch;
  const out = { ...base, ...rest };
  if (pOverrides) out.probabilities = { ...base.probabilities, ...pOverrides };
  if (patch.research_meta) out.research_meta = { ...base.research_meta, ...patch.research_meta };
  return out;
}

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
    assert.match(SYSTEM_PROMPT_HALFTIME_RESEARCH, /ПОШУКОВА ТАКТИКА/);
    assert.match(SYSTEM_PROMPT_HALFTIME_RESEARCH, /STRICT JSON/i);
  });
});

function sampleDecision60Payload(patch = {}) {
  const base = {
    checkpoint: 'decision60',
    minute: 60,
    match_state: 'balanced',
    tempo_state: 'flat',
    favorite_pressure: 'weak',
    underdog_resistance: 'comfortable',
    second_half_activity: {
      shots_since_ht: 2,
      shots_on_target_since_ht: 1,
      corners_since_ht: 1,
      xg_since_ht: 0.12,
      danger_score: 4,
    },
    trend_45_60: {
      attacking_trend: 'flat',
      chance_quality_trend: 'low',
      pressure_direction: 'none',
    },
    probabilities: {
      p_match_ends_0_0: 0.58,
      p_goal_after_60: 0.42,
      p_goal_60_75: 0.22,
      p_goal_after_75: 0.2,
    },
    recommendation: {
      action: 'no_bet',
      confidence: 'medium',
      reason: 'Tem moderate.',
    },
    risk_flags: [],
    confidence: 0.61,
  };
  return { ...base, ...patch };
}

function sampleDecision80Payload(patch = {}) {
  const base = {
    checkpoint: 'decision80',
    minute: 80,
    match_state: 'late_siege',
    late_goal_scenario: 'possible',
    pressure_team: 'home',
    pressure_quality: 'real',
    last_10_minutes: {
      shots: 3,
      shots_on_target: 1,
      corners: 2,
      xg: 0.18,
      danger_score: 6,
    },
    last_20_minutes: {
      shots: 5,
      shots_on_target: 2,
      corners: 4,
      xg: 0.31,
      danger_score: 9,
    },
    probabilities: {
      p_match_ends_0_0: 0.42,
      p_goal_after_80: 0.58,
      p_goal_in_stoppage_time: 0.22,
    },
    recommendation: {
      action: 'late_goal_candidate',
      confidence: 'medium',
      reason: 'Late waves.',
    },
    risk_flags: [],
    confidence: 0.63,
  };
  return { ...base, ...patch };
}

describe('schemas.validateDecision60Response', () => {
  test('accepts valid payload', () => {
    const result = validateDecision60Response(sampleDecision60Payload());
    assert.equal(result.ok, true);
    assert.equal(result.normalized.match_state, 'balanced');
    assert.equal(result.normalized.probabilities.p_goal_after_60, 0.42);
  });

  test('rejects when primary probabilities do not sum to ~1', () => {
    const result = validateDecision60Response(sampleDecision60Payload({
      probabilities: {
        p_match_ends_0_0: 0.62,
        p_goal_after_60: 0.48,
        p_goal_60_75: 0.22,
        p_goal_after_75: 0.26,
      },
    }));
    assert.equal(result.ok, false);
    assert.match(result.error, /sum/i);
  });

  test('rejects invalid match_state', () => {
    const result = validateDecision60Response(sampleDecision60Payload({
      match_state: 'galaxy_pressure',
    }));
    assert.equal(result.ok, false);
    assert.match(result.error, /match_state/i);
  });

  test('accepts chaotic as allowed enum', () => {
    const result = validateDecision60Response(sampleDecision60Payload({
      match_state: 'chaotic',
    }));
    assert.equal(result.ok, true);
  });

  test('unwraps nested analysis wrapper', () => {
    const result = validateDecision60Response({
      analysis: sampleDecision60Payload({
        probabilities: {
          p_match_ends_0_0: '0.55',
          p_goal_after_60: '0.45',
          p_goal_60_75: '0.25',
          p_goal_after_75: '0.20',
        },
        confidence: '0.70',
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.normalized.confidence, 0.7);
  });
});

describe('schemas.validateDecision80Response', () => {
  test('accepts valid payload', () => {
    const result = validateDecision80Response(sampleDecision80Payload());
    assert.equal(result.ok, true);
    assert.equal(result.normalized.pressure_quality, 'real');
  });

  test('rejects when stoppage goal exceeds after-80 mass', () => {
    const result = validateDecision80Response(sampleDecision80Payload({
      probabilities: {
        p_match_ends_0_0: 0.2,
        p_goal_after_80: 0.8,
        p_goal_in_stoppage_time: 0.95,
      },
    }));
    assert.equal(result.ok, false);
    assert.match(result.error, /stoppage/i);
  });

  test('normalizeDecision80 correctly normalizes motivation_asymmetry when present', () => {
    const payload = sampleDecision80Payload({
      motivation_asymmetry: {
        team_that_must_score: 'home',
        strength: 'high',
        reason: 'needs win to avoid relegation',
      },
    });
    const n = normalizeDecision80(payload);
    assert.equal(n.motivation_asymmetry.team_that_must_score, 'home');
    assert.equal(n.motivation_asymmetry.strength, 'high');
    assert.equal(n.motivation_asymmetry.reason, 'needs win to avoid relegation');
  });

  test('normalizeDecision80 handles missing motivation_asymmetry gracefully', () => {
    const payload = sampleDecision80Payload();
    const n = normalizeDecision80(payload);
    assert.equal(n.motivation_asymmetry.team_that_must_score, undefined);
    assert.equal(n.motivation_asymmetry.strength, undefined);
    assert.equal(n.motivation_asymmetry.reason, '');
  });
});

describe('halftimeSchema.validateHalftimeResearchResponse', () => {
  test('accepts valid halftime payload', () => {
    const p = sampleHalftimeOutput();
    p.home_team.key_absences = [{ player: 'A', reason: 'injury', impact: 'high' }];
    const r = validateHalftimeResearchResponse(p);
    assert.equal(r.ok, true);
    assert.equal(r.normalized.probabilities.p_match_ends_0_0, 0.55);
    assert.equal(r.normalized.home_team.key_absences[0].player, 'A');
  });

  test('accepts payload wrapped under analysis', () => {
    const r = validateHalftimeResearchResponse({ analysis: sampleHalftimeOutput() });
    assert.equal(r.ok, true);
    assert.equal(r.normalized.confidence, 0.72);
  });

  test('rejects when probabilities do not sum to one', () => {
    const p = sampleHalftimeOutput({ probabilities: { p_match_has_goal: 0.9 } });
    const r = validateHalftimeResearchResponse(p);
    assert.equal(r.ok, false);
    assert.match(r.error, /sum/i);
  });

  test('rejects missing top-level key', () => {
    const p = { ...sampleHalftimeOutput() };
    delete p.research_meta;
    const r = validateHalftimeResearchResponse(p);
    assert.equal(r.ok, false);
    assert.match(r.error, /Missing: research_meta/);
  });

  test('rejects empty reasoning_for_probabilities', () => {
    const p = sampleHalftimeOutput({
      probabilities: { reasoning_for_probabilities: '   ' },
    });
    const r = validateHalftimeResearchResponse(p);
    assert.equal(r.ok, false);
    assert.match(r.error, /reasoning_for_probabilities/i);
  });

  test('rejects invalid research_quality', () => {
    const p = sampleHalftimeOutput({ research_meta: { research_quality: 2 } });
    const r = validateHalftimeResearchResponse(p);
    assert.equal(r.ok, false);
    assert.match(r.error, /research_quality/i);
  });
});

describe('costCalculator.calculateResponsesCost', () => {
  test('calculates cost from Responses API token fields', () => {
    const cost = calculateResponsesCost({
      input_tokens: 1000,
      output_tokens: 500,
    }, 'gpt-4o');
    assert.equal(cost, 0.0075);
  });

  test('returns null for unknown model', () => {
    assert.equal(calculateResponsesCost({
      input_tokens: 500,
      output_tokens: 200,
    }, 'unknown-model'), null);
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
        output: sampleHalftimeOutput({
          probabilities: {
            p_match_ends_0_0: 0.58,
            p_match_has_goal: 0.42,
            reasoning_for_probabilities: 'Low xG.',
          },
          confidence: 0.63,
          research_meta: {
            search_queries_made: ['x'],
            sources_consulted: 2,
            research_quality: 0.55,
            data_freshness_days: 3,
          },
        }),
      },
      decision60: {
        output: sampleDecision60Payload({
          probabilities: {
            p_match_ends_0_0: 0.45,
            p_goal_after_60: 0.55,
            p_goal_60_75: 0.30,
            p_goal_after_75: 0.25,
          },
          confidence: 0.67,
        }),
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

  test('buildHalftimePrompt includes teams, 1H stats block, and research task', () => {
    const prompt = buildHalftimePrompt(match, {
      timezone: 'Europe/Kyiv',
      now: new Date('2099-06-01T14:30:00.000Z'),
    });

    assert.equal(prompt.system, SYSTEM_PROMPT_HALFTIME_RESEARCH);
    assert.match(prompt.user, /St Albans/);
    assert.match(prompt.user, /Green Gully/);
    assert.match(prompt.user, /СТАТИСТИКА ПЕРШОГО ТАЙМУ/);
    assert.match(prompt.user, /ЗАВДАННЯ/);
    assert.match(prompt.user, /Europe\/Kyiv/);
    assert.match(prompt.user, /0\.82 \| 0\.14/);
  });

  test('buildHalftimePrompt defaults timezone and shows H2H when present', () => {
    const prompt = buildHalftimePrompt(match);

    assert.match(prompt.user, /\(UTC\)/);
    assert.match(prompt.user, /H2H останні 5/);
    assert.match(prompt.user, /W\/D\/L/);
  });

  test('buildDecision60Prompt embeds MATCH bundle and precomputed activity JSON', () => {
    const prompt = buildDecision60Prompt(match);

    assert.match(prompt.system, /Allowed match_state:/);
    assert.match(prompt.user, /"currentMinute":\s*60/);
    assert.match(prompt.user, /"currentScore":\s*"0:0"/);
    assert.match(prompt.user, /PRECOMPUTED_FOR_MODEL/);
    assert.match(prompt.user, /St Albans/);
  });

  test('buildDecision80Prompt embeds decision60_summary and danger hints JSON', () => {
    const prompt = buildDecision80Prompt(match);

    assert.match(prompt.system, /fake_pressure/);
    assert.match(prompt.user, /decision60_summary/);
    assert.match(prompt.user, /"currentMinute":\s*80/);
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
      checkpoint: 'decision60',
      apiKey: 'k',
    }, {
      requester: async () => {
        attempts += 1;
        return {
          choices: [{
            message: {
              content: JSON.stringify(sampleDecision60Payload()),
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
    assert.equal(result.output.probabilities.p_match_ends_0_0, 0.58);
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
      checkpoint: 'decision60',
      apiKey: 'k',
    }, {
      requester: async () => {
        attempts += 1;
        return {
          choices: [{
            message: {
              content: JSON.stringify(sampleDecision60Payload({
                probabilities: {
                  p_match_ends_0_0: 0.9,
                  p_goal_after_60: 0.9,
                  p_goal_60_75: 0.5,
                  p_goal_after_75: 0.4,
                },
              })),
            },
          }],
          usage: { prompt_tokens: 500, completion_tokens: 200 },
        };
      },
      sleep: async () => {},
    });

    assert.equal(attempts, 2);
    assert.equal(result.output, null);
    assert.match(result.error, /probabilities|sum/i);
  });
});

describe('halftimeResponses.parseJsonFromResponsesText', () => {
  test('parses fenced or padded model output', () => {
    const inner = '{"a":1,"b":"x"}';
    assert.equal(parseJsonFromResponsesText(inner).a, 1);
    assert.equal(parseJsonFromResponsesText(`Here:\n\`\`\`json\n${inner}\n\`\`\``).b, 'x');
    assert.equal(parseJsonFromResponsesText(`prefix\n${inner}\ntrailing`).a, 1);
  });
});

describe('halftimeResponses.performHalftimeResearch', () => {
  test('returns validated normalized output and cost on success', async () => {
    const payload = sampleHalftimeOutput({
      probabilities: {
        p_match_ends_0_0: 0.7,
        p_match_has_goal: 0.3,
        reasoning_for_probabilities: 'Facts one. Facts two.',
      },
    });
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify(payload),
          usage: { input_tokens: 1000, output_tokens: 400 },
          output: [],
        }),
      },
    };
    const cfg = {
      OPENAI_API_KEY: 'k',
      LIVE_AI_HT_MODEL: 'gpt-4o',
      LIVE_AI_HT_MAX_TOKENS: 2000,
      LIVE_AI_HT_RESPONSES_TIMEOUT_MS: 5000,
      LIVE_AI_HT_TEMPERATURE: 0.2,
    };

    const res = await performHalftimeResearch({ system: 's', user: 'u' }, cfg, { client });
    assert.equal(res.error, null);
    assert.equal(res.output?.probabilities?.p_match_ends_0_0, 0.7);
    assert.equal(res.promptTokens, 1000);
    assert.equal(res.completionTokens, 400);
    assert.equal(res.costUsd, calculateResponsesCost(
      { input_tokens: 1000, output_tokens: 400 },
      'gpt-4o',
    ));
  });

  test('returns structured error after retry on schema failure', async () => {
    let phase = 0;
    const client = {
      responses: {
        create: async () => {
          phase += 1;
          if (phase === 1) {
            return {
              output_text: '{ broken',
              usage: {},
              output: [],
            };
          }
          return {
            output_text: JSON.stringify({
              probabilities: {
                p_match_ends_0_0: 0.61,
                p_match_has_goal: 0.39,
              },
            }),
            usage: {},
            output: [],
          };
        },
      },
    };
    const cfg = {
      OPENAI_API_KEY: 'k',
      LIVE_AI_HT_MODEL: 'gpt-4o-mini',
      LIVE_AI_HT_MAX_TOKENS: 500,
      LIVE_AI_HT_RESPONSES_TIMEOUT_MS: 5000,
      LIVE_AI_HT_TEMPERATURE: 0.35,
    };
    const res = await performHalftimeResearch({ system: 's', user: 'u' }, cfg, { client });
    assert.ok(res.error);
    assert.equal(res.output, null);
    assert.ok(phase >= 2);
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
      output: sampleHalftimeOutput({
        research_meta: {
          search_queries_made: [],
          sources_consulted: 0,
          research_quality: 0.35,
          data_freshness_days: 999,
        },
        probabilities: {
          p_match_ends_0_0: 0.55,
          p_match_has_goal: 0.45,
          reasoning_for_probabilities: 'One. Two.',
        },
        confidence: 0.6,
      }),
      costUsd: 0.004,
    }, date);

    const stored = matchStore.getMatch('ai-match-1', date);
    assert.equal(stored.aiAnalysis.halftime.output.probabilities.p_match_ends_0_0, 0.55);
    assert.equal(stored.aiAnalysis.totalCostUsd, 0.004);
    assert.equal(stored.aiAnalysis.requestCount, 1);
    assert.equal(matchStore.hasAiCheckpoint('ai-match-1', 'halftime', date), true);
  });

  test('upsertFromEnrichment precomputes derived market and table signals', () => {
    const derivedDate = new Date('2099-01-04T12:00:00.000Z');
    const derivedDir = path.resolve(__dirname, '../data/logs/2099-01-04');
    fs.rmSync(derivedDir, { recursive: true, force: true });

    const statBlob = {
      capturedAtStatus: 'Half Time',
      '1half': { home: { shotsOffTarget: 2 }, away: {}, overall: {} },
      rawRows: [{ label: 'Test', home: '1', away: '2' }],
    };
    const record = matchStore.upsertFromEnrichment({
      matchId: 'ai-match-2',
      homeTeam: 'Home',
      awayTeam: 'Away',
      statistics: statBlob,
      tabs: { stats: true, standings: false, h2h: false },
      statsLevel: 'detailed',
      odds: { home: 2.1, draw: 3.2, away: 3.6 },
      standings: {
        home: { pts: 20, mp: 10 },
        away: { pts: 12, mp: 10 },
      },
    }, derivedDate);

    assert.deepEqual(record.statistics, statBlob);
    assert.deepEqual(record.enrichmentTabs, { stats: true, standings: false, h2h: false });
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

  test('shouldRunCheckpoint skips when statsLevel is not detailed (no tokens for basic)', () => {
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
      LIVE_AI_HT_MODEL: 'gpt-4o-mini',
      LIVE_AI_TEMPERATURE: 0.2,
      LIVE_AI_MAX_TOKENS: 500,
      LIVE_AI_HT_MAX_TOKENS: 1200,
      LIVE_AI_HT_RESPONSES_TIMEOUT_MS: 90_000,
      LIVE_AI_HT_TEMPERATURE: 0.3,
      LIVE_AI_MATCH_TIMEZONE: 'UTC',
      LIVE_AI_TIMEOUT_MS: 1000,
      LIVE_AI_MAX_RETRIES: 1,
    };

    const header = { minute: 47, scoreHome: 0, scoreAway: 0 };
    const match = matchStore.getMatch('ai-match-3', date);

    const p1 = maybeRequestAI('ai-match-3', header, match, date, {
      env: cfg,
      matchStore,
      performHalftimeResearch: async () => {
        calls += 1;
        return resultPromise;
      },
    });

    const pending = matchStore.getMatch('ai-match-3', date);
    assert.equal(pending.aiAnalysis.halftime.pending, true);

    const p2 = maybeRequestAI('ai-match-3', header, pending, date, {
      env: cfg,
      matchStore,
      performHalftimeResearch: async () => {
        calls += 1;
        return resultPromise;
      },
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);

    const htPayload = sampleHalftimeOutput({
      research_meta: {
        search_queries_made: [],
        sources_consulted: 0,
        research_quality: 0.41,
        data_freshness_days: 999,
      },
      probabilities: {
        p_match_ends_0_0: 0.61,
        p_match_has_goal: 0.39,
        reasoning_for_probabilities: 'One note. Two note.',
      },
      confidence: 0.74,
    });

    resolveCall({
      output: htPayload,
      latencyMs: 12,
      promptTokens: 100,
      completionTokens: 50,
      model: 'gpt-4o-mini',
      costUsd: 0.00075,
      error: null,
      useInModel: true,
      weightMultiplier: 1,
      webSearchCallsCount: 0,
    });

    await Promise.all([p1, p2]);

    const stored = matchStore.getMatch('ai-match-3', date);
    assert.equal(stored.aiAnalysis.halftime.pending, undefined);
    assert.equal(stored.aiAnalysis.requestCount, 1);
    assert.equal(stored.aiAnalysis.halftime.output.probabilities.p_match_ends_0_0, 0.61);
  });

  test('buildPromptForCheckpoint halftime builds research user block', async () => {
    const m = {
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
      league: 'Test League',
      country: 'ZZ',
      baseline1H: {
        totalShots: { home: 2, away: 1 },
        shotsOnTarget: { home: 1, away: 0 },
        cornerKicks: { home: 0, away: 0 },
        expectedGoalsXg: { home: 0.1, away: 0.05 },
        ballPossession: { home: 50, away: 50 },
        yellowCards: { home: 0, away: 0 },
        redCards: { home: 0, away: 0 },
      },
    };
    const pr = await buildPromptForCheckpoint('halftime', m, {
      LIVE_AI_MATCH_TIMEZONE: 'UTC',
    });
    assert.match(pr.user, /ЗАВДАННЯ/);
    assert.match(pr.user, /СТАТИСТИКА ПЕРШОГО ТАЙМУ/);
    assert.match(pr.user, /Alpha/);
    assert.match(pr.user, /0\.1 \| 0\.05/);
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
        LIVE_AI_HT_MODEL: 'gpt-4o-mini',
        LIVE_AI_TEMPERATURE: 0.2,
        LIVE_AI_MAX_TOKENS: 500,
        LIVE_AI_HT_MAX_TOKENS: 1200,
        LIVE_AI_HT_RESPONSES_TIMEOUT_MS: 90_000,
        LIVE_AI_HT_TEMPERATURE: 0.3,
        LIVE_AI_MATCH_TIMEZONE: 'UTC',
        LIVE_AI_TIMEOUT_MS: 1000,
        LIVE_AI_MAX_RETRIES: 1,
      },
      matchStore,
      performHalftimeResearch: async () => {
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
          halftime: {
            output: {
              probabilities: { p_match_ends_0_0: 0.6 },
            },
          },
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
