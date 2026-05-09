'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');

function reloadModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  delete require.cache[require.resolve('../src/config/env')];
  return require(modulePath);
}

function withEnv(overrides, fn) {
  const prev = {};
  for (const key of Object.keys(overrides)) {
    prev[key] = process.env[key];
    process.env[key] = overrides[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
    });
}

test('escapeMarkdownV2 escapes all reserved chars', () => {
  const { escapeMarkdownV2 } = reloadModule('../src/integrations/telegram/client');
  const input = '_*[]()~`>#+-=|{}.!hello';
  const expected = '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!hello';
  assert.equal(escapeMarkdownV2(input), expected);
});

test('escapeMarkdownV2 handles non-string inputs', () => {
  const { escapeMarkdownV2 } = reloadModule('../src/integrations/telegram/client');
  assert.equal(escapeMarkdownV2(null), '');
  assert.equal(escapeMarkdownV2(undefined), '');
  assert.equal(escapeMarkdownV2(123), '123');
});

test('escapeMarkdownV2 escapes period in version-like strings', () => {
  const { escapeMarkdownV2 } = reloadModule('../src/integrations/telegram/client');
  assert.equal(escapeMarkdownV2(1.23), '1\\.23');
});

test('escapeMarkdownV2LinkUrl escapes only URL-breaking chars', () => {
  const { escapeMarkdownV2LinkUrl } = reloadModule('../src/integrations/telegram/formatters/markdown');
  const input = 'https://www.flashscore.com/match/A)b\\c/#match-summary';
  const escaped = escapeMarkdownV2LinkUrl(input);
  assert.match(escaped, /A\\\)b\\\\c/);
  assert.match(escaped, /www\.flashscore\.com/);
  assert.match(escaped, /match-summary/);
  assert.doesNotMatch(escaped, /www\\\.flashscore\\\.com/);
  assert.doesNotMatch(escaped, /match\\\-summary/);
});

test('sendMessage returns disabled when LIVE_TG_ENABLED=false', async () => {
  await withEnv(
    {
      LIVE_TG_ENABLED: '0',
      LIVE_TG_DRY_RUN: '0',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { sendMessage } = reloadModule('../src/integrations/telegram/client');
      const result = await sendMessage({ text: 'x' });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'disabled');
      assert.equal(result.dryRun, false);
      assert.equal(result.attempts, 0);
    },
  );
});

test('sendMessage returns missing_credentials when TELEGRAM_TOKEN empty', async () => {
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '0',
      TELEGRAM_TOKEN: '',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { sendMessage } = reloadModule('../src/integrations/telegram/client');
      const result = await sendMessage({ text: 'x' });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'missing_credentials');
      assert.equal(result.attempts, 0);
      assert.equal(result.dryRun, false);
    },
  );
});

test('sendMessage dry-run returns synthetic messageId=-1 without HTTP call', async () => {
  const originalPost = axios.post;
  let called = false;
  try {
    axios.post = async () => {
      called = true;
      throw new Error('axios.post should not be called in dry-run');
    };

    await withEnv(
      {
        LIVE_TG_ENABLED: '1',
        LIVE_TG_DRY_RUN: '1',
        TELEGRAM_TOKEN: 'fake',
        TELEGRAM_CHAT_ID: '123',
      },
      async () => {
        const { sendMessage } = reloadModule('../src/integrations/telegram/client');
        const result = await sendMessage({ text: 'hello' });
        assert.equal(result.ok, true);
        assert.equal(result.messageId, -1);
        assert.equal(result.error, null);
        assert.equal(result.dryRun, true);
        assert.equal(result.attempts, 0);
        assert.equal(called, false);
      },
    );
  } finally {
    axios.post = originalPost;
  }
});

test('sendMessage retries on network error and reports correct attempts', async () => {
  const originalPost = axios.post;
  let calls = 0;
  try {
    axios.post = async () => {
      calls += 1;
      throw new Error('ECONNREFUSED');
    };

    await withEnv(
      {
        LIVE_TG_ENABLED: '1',
        LIVE_TG_DRY_RUN: '0',
        LIVE_TG_MAX_RETRIES: '3',
        LIVE_TG_RETRY_BASE_MS: '10',
        TELEGRAM_TOKEN: 'fake',
        TELEGRAM_CHAT_ID: '123',
      },
      async () => {
        const { sendMessage } = reloadModule('../src/integrations/telegram/client');
        const result = await sendMessage({ text: 'network-test' });
        assert.equal(result.ok, false);
        assert.equal(result.attempts, 3);
        assert.equal(result.messageId, null);
        assert.match(result.error, /max_retries_exhausted/);
        assert.equal(calls, 3);
      },
    );
  } finally {
    axios.post = originalPost;
  }
});

test('sendMessage retries on HTTP 429 with retry_after', async () => {
  const originalPost = axios.post;
  let calls = 0;
  try {
    axios.post = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          data: {
            ok: false,
            parameters: { retry_after: 0 },
            description: 'Too many requests',
          },
        };
      }
      return { status: 200, data: { ok: true, result: { message_id: 555 } } };
    };

    await withEnv(
      {
        LIVE_TG_ENABLED: '1',
        LIVE_TG_DRY_RUN: '0',
        LIVE_TG_MAX_RETRIES: '3',
        LIVE_TG_RETRY_BASE_MS: '10',
        TELEGRAM_TOKEN: 'fake',
        TELEGRAM_CHAT_ID: '123',
      },
      async () => {
        const { sendMessage } = reloadModule('../src/integrations/telegram/client');
        const result = await sendMessage({ text: '429-test' });
        assert.equal(result.ok, true);
        assert.equal(result.messageId, 555);
        assert.equal(result.attempts, 2);
        assert.equal(calls, 2);
      },
    );
  } finally {
    axios.post = originalPost;
  }
});

test('sendMessage retries on HTTP 5xx with backoff', async () => {
  const originalPost = axios.post;
  let calls = 0;
  try {
    axios.post = async () => {
      calls += 1;
      if (calls <= 2) {
        return {
          status: 503,
          data: {
            ok: false,
            description: 'Service unavailable',
          },
        };
      }
      return { status: 200, data: { ok: true, result: { message_id: 999 } } };
    };

    await withEnv(
      {
        LIVE_TG_ENABLED: '1',
        LIVE_TG_DRY_RUN: '0',
        LIVE_TG_MAX_RETRIES: '3',
        LIVE_TG_RETRY_BASE_MS: '10',
        TELEGRAM_TOKEN: 'fake',
        TELEGRAM_CHAT_ID: '123',
      },
      async () => {
        const { sendMessage } = reloadModule('../src/integrations/telegram/client');
        const result = await sendMessage({ text: '5xx-test' });
        assert.equal(result.ok, true);
        assert.equal(result.messageId, 999);
        assert.equal(result.attempts, 3);
        assert.equal(calls, 3);
      },
    );
  } finally {
    axios.post = originalPost;
  }
});

test('sendMessage does NOT retry on HTTP 4xx (non-429)', async () => {
  const originalPost = axios.post;
  let calls = 0;
  try {
    axios.post = async () => {
      calls += 1;
      return {
        status: 400,
        data: {
          ok: false,
          description: 'Bad Request: chat not found',
        },
      };
    };

    await withEnv(
      {
        LIVE_TG_ENABLED: '1',
        LIVE_TG_DRY_RUN: '0',
        LIVE_TG_MAX_RETRIES: '3',
        LIVE_TG_RETRY_BASE_MS: '10',
        TELEGRAM_TOKEN: 'fake',
        TELEGRAM_CHAT_ID: '123',
      },
      async () => {
        const { sendMessage } = reloadModule('../src/integrations/telegram/client');
        const result = await sendMessage({ text: '4xx-test' });
        assert.equal(result.ok, false);
        assert.equal(result.error, '400: Bad Request: chat not found');
        assert.equal(result.attempts, 1);
        assert.equal(calls, 1);
      },
    );
  } finally {
    axios.post = originalPost;
  }
});

test('tgOutbox enqueue creates new record with default shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    outboxFilePath,
    readOutbox,
  } = reloadModule('../src/store/tgOutbox');

  const record = enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });

  assert.equal(record.status, 'queued');
  assert.equal(record.entry.attempts, 0);
  assert.equal(record.result.messageId, null);
  assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const file = outboxFilePath(dir);
  assert.equal(fs.existsSync(file), true);
  const arr = readOutbox(dir);
  assert.equal(arr.length, 1);
});

test('tgOutbox enqueue is idempotent by matchId+decisionKey', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    readOutbox,
  } = reloadModule('../src/store/tgOutbox');

  const first = enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  const second = enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '1:0' },
  });

  const arr = readOutbox(dir);
  assert.equal(arr.length, 1);
  assert.equal(second.createdAt, first.createdAt);
});

test('tgOutbox enqueue allows different decisionKey for same matchId', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    readOutbox,
  } = reloadModule('../src/store/tgOutbox');

  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision80',
    predictionType: 'FT_TM05_FROM_75_90',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });

  const arr = readOutbox(dir);
  assert.equal(arr.length, 2);
});

test('tgOutbox markEntrySent transitions to pending_result', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    markEntrySent,
    findByKey,
  } = reloadModule('../src/store/tgOutbox');

  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  markEntrySent(dir, 'M1', 'decision60', {
    messageId: 12345,
    sentAt: '2026-05-09T10:00:00Z',
  });

  const record = findByKey(dir, 'M1', 'decision60');
  assert.equal(record.status, 'pending_result');
  assert.equal(record.entry.messageId, 12345);
  assert.equal(record.entry.sentAt, '2026-05-09T10:00:00Z');
});

test("tgOutbox markEntryFailed increments attempts but keeps status='queued'", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    markEntryFailed,
    findByKey,
  } = reloadModule('../src/store/tgOutbox');

  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });

  markEntryFailed(dir, 'M1', 'decision60', { error: 'timeout', attempts: 1 });
  let record = findByKey(dir, 'M1', 'decision60');
  assert.equal(record.status, 'queued');
  assert.equal(record.entry.attempts, 1);
  assert.equal(record.entry.lastError, 'timeout');

  markEntryFailed(dir, 'M1', 'decision60', { error: 'timeout', attempts: 2 });
  record = findByKey(dir, 'M1', 'decision60');
  assert.equal(record.status, 'queued');
  assert.equal(record.entry.attempts, 2);
});

test("tgOutbox setStatus('failed') overrides FSM", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    markEntryFailed,
    setStatus,
    findByKey,
  } = reloadModule('../src/store/tgOutbox');

  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  markEntryFailed(dir, 'M1', 'decision60', { error: 'timeout', attempts: 1 });
  setStatus(dir, 'M1', 'decision60', 'failed');

  const record = findByKey(dir, 'M1', 'decision60');
  assert.equal(record.status, 'failed');
});

test('tgOutbox markResultSent transitions to resolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    markEntrySent,
    markResultSent,
    findByKey,
  } = reloadModule('../src/store/tgOutbox');

  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  markEntrySent(dir, 'M1', 'decision60', {
    messageId: 12345,
    sentAt: '2026-05-09T10:00:00Z',
  });
  markResultSent(dir, 'M1', 'decision60', {
    messageId: 999,
    sentAt: '2026-05-09T11:00:00Z',
    hit: true,
  });

  const record = findByKey(dir, 'M1', 'decision60');
  assert.equal(record.status, 'resolved');
  assert.equal(record.result.messageId, 999);
  assert.equal(record.result.hit, true);
});

test('tgOutbox markResultFailed updates result.attempts/lastError without changing status', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    markEntrySent,
    markResultFailed,
    findByKey,
  } = reloadModule('../src/store/tgOutbox');

  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  markEntrySent(dir, 'M1', 'decision60', { messageId: 12345, sentAt: '2026-05-09T10:00:00Z' });
  markResultFailed(dir, 'M1', 'decision60', { error: 'tg_timeout', attempts: 1 });

  let record = findByKey(dir, 'M1', 'decision60');
  assert.equal(record.status, 'pending_result');
  assert.equal(record.result.attempts, 1);
  assert.equal(record.result.lastError, 'tg_timeout');
  assert.equal(record.result.messageId, null);

  markResultFailed(dir, 'M1', 'decision60', { error: 'tg_timeout', attempts: 2 });
  record = findByKey(dir, 'M1', 'decision60');
  assert.equal(record.status, 'pending_result');
  assert.equal(record.result.attempts, 2);
});

test('tgOutbox findByStatus filters correctly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    markEntrySent,
    markResultSent,
    findByStatus,
  } = reloadModule('../src/store/tgOutbox');

  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  enqueue(dir, {
    matchId: 'M2',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  enqueue(dir, {
    matchId: 'M3',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });

  markEntrySent(dir, 'M2', 'decision60', {
    messageId: 200,
    sentAt: '2026-05-09T10:00:00Z',
  });
  markEntrySent(dir, 'M3', 'decision60', {
    messageId: 300,
    sentAt: '2026-05-09T10:00:00Z',
  });
  markResultSent(dir, 'M3', 'decision60', {
    messageId: 301,
    sentAt: '2026-05-09T11:00:00Z',
    hit: true,
  });

  const pending = findByStatus(dir, 'pending_result');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].matchId, 'M2');

  const queued = findByStatus(dir, 'queued');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].matchId, 'M1');
});

test('tgOutbox findByMatchId returns all records for matchId', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    enqueue,
    findByMatchId,
  } = reloadModule('../src/store/tgOutbox');

  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision60',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });
  enqueue(dir, {
    matchId: 'M1',
    decisionKey: 'decision80',
    predictionType: 'FT_TM05_FROM_75_90',
    tier: null,
    modelMode: 'detailed',
    snapshot: { score: '0:0' },
  });

  const rows = findByMatchId(dir, 'M1');
  assert.equal(rows.length, 2);
});

test('tgOutbox markEntrySent throws if record missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const { markEntrySent } = reloadModule('../src/store/tgOutbox');

  assert.throws(
    () =>
      markEntrySent(dir, 'GHOST', 'decision60', {
        messageId: 12345,
        sentAt: '2026-05-09T10:00:00Z',
      }),
    /outbox record not found/,
  );
});

test('tgOutbox readOutbox returns [] if file missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const { readOutbox } = reloadModule('../src/store/tgOutbox');
  assert.deepEqual(readOutbox(dir), []);
});

test('tgOutbox readOutbox handles corrupt JSON gracefully', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-outbox-'));
  const {
    readOutbox,
    outboxFilePath,
  } = reloadModule('../src/store/tgOutbox');

  fs.writeFileSync(outboxFilePath(dir), '{not json', 'utf8');
  assert.deepEqual(readOutbox(dir), []);
});

test('modelModeLabel maps known modes and unknown fallback', () => {
  const { modelModeLabel } = reloadModule('../src/integrations/telegram/formatters/modeLabels');
  assert.equal(modelModeLabel('basic'), 'Базовий');
  assert.equal(modelModeLabel('detailed'), 'Повний');
  assert.equal(modelModeLabel('detailed_ai'), 'Повний АІ');
  assert.equal(modelModeLabel('unknown'), 'Невідомий режим');
  assert.equal(modelModeLabel(''), 'Невідомий режим');
});

test('buildFlashscoreDesktopUrl converts mobi and relative URLs to desktop summary URL', () => {
  const { buildFlashscoreDesktopUrl } = reloadModule('../src/integrations/telegram/formatters/flashscoreUrl');
  assert.equal(
    buildFlashscoreDesktopUrl('/match/KvzyKxD4/?s=2'),
    'https://www.flashscore.com/match/KvzyKxD4/#match-summary',
  );
  assert.equal(
    buildFlashscoreDesktopUrl('https://www.flashscore.mobi/match/WIgtbejo/'),
    'https://www.flashscore.com/match/WIgtbejo/#match-summary',
  );
  assert.equal(buildFlashscoreDesktopUrl('https://example.com/nope'), null);
});

test('formatEntryMessage renders FT primary with teams league components odds and desktop link', () => {
  const { formatEntryMessage } = reloadModule('../src/integrations/telegram/formatters/entryMessage');
  const text = formatEntryMessage({
    match: {
      homeTeam: 'Home FC',
      awayTeam: 'Away United',
      league: 'Bundesliga',
      matchUrl: '/match/KvzyKxD4/?s=2',
      odds: {
        home: 1.2,
        draw: 7.52,
        away: 9.67,
        isOddsFavorite: { favorite: 'home', margin: 0.6 },
      },
    },
    prediction: {
      predictionType: 'FT_TM05_FROM_60_75',
      modelMode: 'detailed_ai',
      confidence: 0.8123,
      tier: 'ai_premium_upgrade',
      components: {
        fullTimeNilNilScore: 78.123,
        dryStateScore: 82,
        realPressureScore60_75: 18,
        fakePressureScore60_75: 35,
        lateActivationRisk: 22,
        aiScenarioScore: 90,
        notWhitelistedMetric: 999,
      },
      riskFlags: ['HIGH_FAKE_PRESSURE'],
      aiOverlay: { scenario: 'dead_match' },
    },
    decisionKey: 'decision60',
    minute: 67,
    score: '0:0',
  });

  assert.match(text, /Home FC/);
  assert.match(text, /Away United/);
  assert.match(text, /Повний АІ/);
  assert.match(text, /Confidence: 0\\\.81/);
  assert.match(text, /1\\\.20/);
  assert.match(text, /Flashscore desktop/);
  assert.match(text, /https:\/\/www\.flashscore\.com\/match\/KvzyKxD4\/#match-summary/);
  assert.match(text, /HIGH\\_FAKE\\_PRESSURE/);
  assert.match(text, /dead\\_match/);
  assert.doesNotMatch(text, /notWhitelistedMetric/);
  assert.doesNotMatch(text, /999/);
});

test('formatEntryMessage returns null when teams missing', () => {
  const { formatEntryMessage } = reloadModule('../src/integrations/telegram/formatters/entryMessage');
  const result = formatEntryMessage({
    match: { league: 'Bundesliga', matchUrl: '/match/KvzyKxD4/' },
    prediction: { predictionType: 'FT_TM05_FROM_60_75', modelMode: 'basic' },
    decisionKey: 'decision60',
    minute: 65,
    score: '0:0',
  });
  assert.equal(result, null);
});

test('formatEntryMessage omits odds block when odds incomplete', () => {
  const { formatEntryMessage } = reloadModule('../src/integrations/telegram/formatters/entryMessage');
  const text = formatEntryMessage({
    match: {
      homeTeam: 'Home FC',
      awayTeam: 'Away United',
      league: 'Bundesliga',
      matchUrl: '/match/KvzyKxD4/',
      odds: { home: 1.2, draw: 7.52 },
    },
    prediction: { predictionType: 'FT_TM05_FROM_60_75', modelMode: 'basic', components: {} },
    decisionKey: 'decision60',
    minute: 66,
    score: '0:0',
  });
  assert.doesNotMatch(text, /Pre-match odds/);
});

test('formatResultMessage renders FT hit and miss', () => {
  const { formatResultMessage } = reloadModule('../src/integrations/telegram/formatters/resultMessage');

  const hitText = formatResultMessage({
    outboxRecord: { predictionType: 'FT_TM05_FROM_60_75', decisionKey: 'decision60', result: { hit: true } },
    match: { final: { score: '0:0', goals: [] } },
  });
  assert.match(hitText, /✅/);
  assert.match(hitText, /HIT/);
  assert.match(hitText, /FT TM0\\\.5/);
  assert.match(hitText, /Фінал: 0:0/);

  const missText = formatResultMessage({
    outboxRecord: { predictionType: 'FT_TM05_FROM_60_75', decisionKey: 'decision60', result: { hit: false } },
    match: { final: { score: '1:0', goals: [{ minute: 78 }] } },
  });
  assert.match(missText, /❌/);
  assert.match(missText, /MISS/);
  assert.match(missText, /Перший гол: 78'/);
});

test('formatResultMessage renders TB80 hit and miss', () => {
  const { formatResultMessage } = reloadModule('../src/integrations/telegram/formatters/resultMessage');

  const hitText = formatResultMessage({
    outboxRecord: { predictionType: 'TB05_80_PLUS', decisionKey: 'decision80' },
    match: { final: { goals: [{ minute: 87, scoreAfter: '1:0' }] } },
  });
  assert.match(hitText, /Гол після 80'/);
  assert.match(hitText, /87'/);
  assert.match(hitText, /1:0/);

  const missText = formatResultMessage({
    outboxRecord: { predictionType: 'TB05_80_PLUS', decisionKey: 'decision80' },
    match: { final: { score: '0:0', goals: [] } },
  });
  assert.match(missText, /голу після 80' не було/);
});

test('regularGoals filters extra-time goals', () => {
  const { regularGoals } = reloadModule('../src/integrations/telegram/formatters/resultMessage');
  const goals = regularGoals({
    final: {
      goals: [
        { minute: 78, isExtraTime: false },
        { minute: 92, isExtraTime: true },
      ],
    },
  });
  assert.equal(goals.length, 1);
  assert.equal(goals[0].minute, 78);
});

test('finalScore returns unknown when goals lack valid team', () => {
  const { finalScore } = reloadModule('../src/integrations/telegram/formatters/resultMessage');
  assert.equal(finalScore({ final: { goals: [{ minute: 78 }] } }), '?:?');
});
