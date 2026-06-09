'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { formatEntryMessage } = require('../src/integrations/telegram/formatters/entryMessage');

function buildMessage(overrides = {}) {
  return formatEntryMessage({
    match: {
      homeTeam: 'Lanzhou Longyuan',
      awayTeam: 'Dalian Kewei',
      league: 'China League One',
      country: 'CHINA',
      matchUrl: '/match/xY0sFWYh/?s=2',
      ...overrides.match,
    },
    prediction: {
      pNoGoal: 0.75,
      dsScore: 82,
      odds: 2,
      confidence: 0.8,
      evGate: { ev: 1.38 },
      reasoning: 'Low scoring trend',
      keySignals: [{ signal: 'low_scoring_trend', value: '0.8 g/m', weight: 'high' }],
      ...overrides.prediction,
    },
    decisionKey: overrides.decisionKey || 'tm05',
    minute: overrides.minute ?? 60,
    score: overrides.score || '0:0',
  });
}

// Telegram MarkdownV2 rejects any unescaped reserved char with HTTP 400.

// Reserved chars that must always be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
const RESERVED_RE = /(^|[^\\])[-_*[\]()~`>#+\-=|{}.!]/;

function assertNoUnescaped(msg, label) {
  assert.ok(msg, `${label}: message should be produced`);
  // Strip inline link URLs [...](url) — inside url parens escaping rules differ
  const noUrls = msg.replace(/\]\([^)]*\)/g, '](URL)');
  // Remove valid escapes, then look for bare reserved chars
  const stripped = noUrls
    .replace(/\\\\/g, '')
    .replace(/\\[-_*[\]()~`>#+\-=|{}.!]/g, '');
  const bad = stripped.match(/(^|[^\\])[-=]/g);
  assert.strictEqual(bad, null, `${label}: found unescaped reserved char in:\n${msg}`);
}

// `=` was the original bug (DS=, p=, EV=, confidence= separators)
test('entry message escapes all literal "=" for MarkdownV2', () => {
  const msg = buildMessage();
  assertNoUnescaped(msg, 'base case');
});

// `league` with dashes was not escaped when `country` was present —
// triggered HTTP 400 for "Primera A - Apertura - Play Offs" style names.
test('entry message escapes "-" in league name when country is present', () => {
  const msg = buildMessage({
    match: {
      homeTeam: 'Atl. Nacional',
      awayTeam: 'Junior',
      league: 'Primera A - Apertura - Play Offs',
      country: 'COLOMBIA',
      matchUrl: '/match/pYz7vh4c/?s=2',
    },
    prediction: {
      pNoGoal: 0.4575,
      dsScore: 85,
      odds: 2.6,
      confidence: 0.6,
      evGate: { ev: 1.1505 },
      reasoning: 'Фаворит (Atl. Nacional) не пробиває до 26\'',
      keySignals: [{ signal: 'fav_shots_on_target', value: 0, weight: 'high' }],
    },
    decisionKey: 'tm05_1h',
    minute: 26,
  });
  assertNoUnescaped(msg, 'league with dashes');
});
