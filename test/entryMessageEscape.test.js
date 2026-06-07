'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { formatEntryMessage } = require('../src/integrations/telegram/formatters/entryMessage');

function buildMessage() {
  return formatEntryMessage({
    match: {
      homeTeam: 'Lanzhou Longyuan',
      awayTeam: 'Dalian Kewei',
      league: 'China League One',
      country: 'CHINA',
      matchUrl: '/match/xY0sFWYh/?s=2',
    },
    prediction: {
      pNoGoal: 0.75,
      dsScore: 82,
      odds: 2,
      confidence: 0.8,
      evGate: { ev: 1.38 },
      reasoning: 'Low scoring trend',
      keySignals: [{ signal: 'low_scoring_trend', value: '0.8 g/m', weight: 'high' }],
    },
    decisionKey: 'tm05',
    minute: 60,
    score: '0:0',
  });
}

// Telegram MarkdownV2 rejects any unescaped reserved char with HTTP 400.
// `=` is reserved; the bug was literal `DS=`, `p=`, `EV=`, `confidence=` separators
// emitted unescaped, which made every entry signal fail to send.
test('entry message escapes all literal "=" for MarkdownV2', () => {
  const msg = buildMessage();
  assert.ok(msg, 'message should be produced');
  const unescaped = msg.match(/(^|[^\\])=/g);
  assert.strictEqual(
    unescaped,
    null,
    `found unescaped "=" in message:\n${msg}`,
  );
});
