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

function reloadTelegramDispatcher() {
  const modules = [
    '../src/config/env',
    '../src/integrations/telegram/client',
    '../src/integrations/telegram/dispatcher',
  ];
  for (const modulePath of modules) {
    delete require.cache[require.resolve(modulePath)];
  }
  return require('../src/integrations/telegram/dispatcher');
}

function cleanupFutureDay(date) {
  const matchStore = reloadModule('../src/store/matchStore');
  const dayDir = matchStore.dayLogsAbsolute(date);
  if (fs.existsSync(dayDir)) {
    fs.rmSync(dayDir, { recursive: true, force: true });
  }
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
  assert.match(hitText, /ТМ 0,5/);
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

test('isPrimaryPrediction only allows FT primary and TB primary', () => {
  const { isPrimaryPrediction } = reloadTelegramDispatcher();
  assert.equal(isPrimaryPrediction('FT_TM05_FROM_60_75'), true);
  assert.equal(isPrimaryPrediction('TB05_80_PLUS'), true);
  assert.equal(isPrimaryPrediction('LEAN_FT_TM05_FROM_60_75'), false);
  assert.equal(isPrimaryPrediction('FT_TM05_RISK'), false);
  assert.equal(isPrimaryPrediction('PROTECT_UNDER'), false);
  assert.equal(isPrimaryPrediction('NO_BET'), false);
  assert.equal(isPrimaryPrediction('UNKNOWN'), false);
});

test('buildOutboxPayload captures match prediction snapshot', () => {
  const { buildOutboxPayload } = reloadTelegramDispatcher();
  const payload = buildOutboxPayload({
    match: { matchId: 'M1' },
    prediction: {
      predictionType: 'FT_TM05_FROM_60_75',
      tier: 'tierA',
      modelMode: 'detailed_ai',
      confidence: 0.91,
      components: { x: 1 },
      riskFlags: ['r1'],
      reasons: ['because'],
      aiOverlay: { scenario: 'dead_match' },
    },
    decisionKey: 'decision60',
    minute: 65,
    score: '0:0',
  });
  assert.equal(payload.matchId, 'M1');
  assert.equal(payload.decisionKey, 'decision60');
  assert.equal(payload.predictionType, 'FT_TM05_FROM_60_75');
  assert.equal(payload.tier, 'tierA');
  assert.equal(payload.modelMode, 'detailed_ai');
  assert.equal(payload.snapshot.minute, 65);
  assert.equal(payload.snapshot.score, '0:0');
  assert.equal(payload.snapshot.aiVerdict, 'dead_match');
});

test('enqueueEntry dry-run sends primary and marks pending_result', async () => {
  const date = new Date('2099-02-01T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { enqueueEntry } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const match = {
        matchId: 'M-T4-1',
        homeTeam: 'Home FC',
        awayTeam: 'Away FC',
        league: 'Test League',
        matchUrl: '/match/abc/',
        odds: { home: 2.1, draw: 3.2, away: 3.9 },
      };
      const prediction = {
        predictionType: 'FT_TM05_FROM_60_75',
        modelMode: 'detailed_ai',
        confidence: 0.77,
        components: {},
        riskFlags: [],
        reasons: [],
        useInTelegram: true,
      };

      const row = await enqueueEntry({
        match,
        prediction,
        decisionKey: 'decision60',
        minute: 65,
        score: '0:0',
        date,
      });
      assert.equal(row.status, 'pending_result');
      assert.equal(row.entry.messageId, -1);

      const outboxRows = tgOutbox.readOutbox(matchStore.dayLogsAbsolute(date));
      assert.equal(outboxRows.length, 1);
    },
  );
  cleanupFutureDay(date);
});

test('enqueueEntry is idempotent and does not send duplicate if entry already sent', async () => {
  const date = new Date('2099-02-02T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { enqueueEntry } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const match = {
        matchId: 'M-T4-2',
        homeTeam: 'Home FC',
        awayTeam: 'Away FC',
        league: 'Test League',
        matchUrl: '/match/abcd/',
      };
      const prediction = { predictionType: 'FT_TM05_FROM_60_75', modelMode: 'basic', useInTelegram: true };

      const first = await enqueueEntry({
        match,
        prediction,
        decisionKey: 'decision60',
        minute: 66,
        score: '0:0',
        date,
      });
      const second = await enqueueEntry({
        match,
        prediction,
        decisionKey: 'decision60',
        minute: 66,
        score: '0:0',
        date,
      });

      const outboxRows = tgOutbox.readOutbox(matchStore.dayLogsAbsolute(date));
      assert.equal(outboxRows.length, 1);
      assert.equal(second.entry.messageId, -1);
      assert.equal(second.entry.attempts, first.entry.attempts);
      assert.equal(second.createdAt, first.createdAt);
    },
  );
  cleanupFutureDay(date);
});

test('enqueueEntry skips non-primary predictions without outbox write', async () => {
  const date = new Date('2099-02-03T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { enqueueEntry } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const row = await enqueueEntry({
        match: { matchId: 'M-T4-3' },
        prediction: { predictionType: 'LEAN_FT_TM05_FROM_60_75' },
        decisionKey: 'decision60',
        minute: 64,
        score: '0:0',
        date,
      });
      assert.equal(row, null);
      const outboxRows = tgOutbox.readOutbox(matchStore.dayLogsAbsolute(date));
      assert.equal(outboxRows.length, 0);
    },
  );
  cleanupFutureDay(date);
});

test('enqueueEntry disabled when LIVE_TG_ENABLED=0', async () => {
  const date = new Date('2099-02-04T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '0',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { enqueueEntry } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const row = await enqueueEntry({
        match: { matchId: 'M-T4-4' },
        prediction: { predictionType: 'FT_TM05_FROM_60_75' },
        decisionKey: 'decision60',
        minute: 65,
        score: '0:0',
        date,
      });
      assert.equal(row, null);
      const outboxRows = tgOutbox.readOutbox(matchStore.dayLogsAbsolute(date));
      assert.equal(outboxRows.length, 0);
    },
  );
  cleanupFutureDay(date);
});

test('enqueueEntry marks failed when sendMessage returns missing_credentials', async () => {
  const date = new Date('2099-02-05T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '0',
      TELEGRAM_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
    async () => {
      const { enqueueEntry } = reloadTelegramDispatcher();
      const row = await enqueueEntry({
        match: { matchId: 'M-T4-5', homeTeam: 'A', awayTeam: 'B', matchUrl: '/match/z/' },
        prediction: { predictionType: 'FT_TM05_FROM_60_75', modelMode: 'basic', useInTelegram: true },
        decisionKey: 'decision60',
        minute: 65,
        score: '0:0',
        date,
      });
      assert.equal(row.entry.lastError, 'missing_credentials');
      assert.equal(row.status, 'queued');
    },
  );
  cleanupFutureDay(date);
});

test('enqueueEntry prevents duplicate send for concurrent same key', async () => {
  const date = new Date('2099-02-08T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '0',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { enqueueEntry } = reloadTelegramDispatcher();
      const tgClient = require('../src/integrations/telegram/client');
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const originalSendMessage = tgClient.sendMessage;
      let calls = 0;

      try {
        tgClient.sendMessage = async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return {
            ok: true,
            messageId: 777,
            attempts: 1,
            dryRun: false,
            error: null,
          };
        };

        const match = {
          matchId: 'M-T4-6',
          homeTeam: 'Home FC',
          awayTeam: 'Away FC',
          league: 'Test League',
          matchUrl: '/match/concurrent/',
          odds: { home: 1.9, draw: 3.3, away: 4.2 },
        };
        const prediction = {
          predictionType: 'FT_TM05_FROM_60_75',
          modelMode: 'detailed',
          confidence: 0.8,
          components: {},
          riskFlags: [],
          reasons: [],
          useInTelegram: true,
        };

        await Promise.all([
          enqueueEntry({
            match,
            prediction,
            decisionKey: 'decision60',
            minute: 65,
            score: '0:0',
            date,
          }),
          enqueueEntry({
            match,
            prediction,
            decisionKey: 'decision60',
            minute: 65,
            score: '0:0',
            date,
          }),
        ]);

        assert.equal(calls, 1);
        const dayDir = matchStore.dayLogsAbsolute(date);
        const rows = tgOutbox.readOutbox(dayDir);
        assert.equal(rows.length, 1);
        const finalRecord = tgOutbox.findByKey(dayDir, 'M-T4-6', 'decision60');
        assert.equal(finalRecord.status, 'pending_result');
        assert.equal(finalRecord.entry.messageId, 777);
      } finally {
        tgClient.sendMessage = originalSendMessage;
      }
    },
  );
  cleanupFutureDay(date);
});

test('pendingResultRecords returns only sent pending entries', async () => {
  const date = new Date('2099-03-01T00:00:00Z');
  cleanupFutureDay(date);
  const matchStore = reloadModule('../src/store/matchStore');
  const tgOutbox = reloadModule('../src/store/tgOutbox');
  const { pendingResultRecords } = reloadTelegramDispatcher();
  const dayDir = matchStore.dayLogsAbsolute(date);

  tgOutbox.enqueue(dayDir, {
    matchId: 'M-T5-1',
    decisionKey: 'queued',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'basic',
    snapshot: { score: '0:0' },
  });
  tgOutbox.enqueue(dayDir, {
    matchId: 'M-T5-1',
    decisionKey: 'no-entry-msg',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'basic',
    snapshot: { score: '0:0' },
  });
  tgOutbox.enqueue(dayDir, {
    matchId: 'M-T5-1',
    decisionKey: 'valid',
    predictionType: 'FT_TM05_FROM_60_75',
    tier: null,
    modelMode: 'basic',
    snapshot: { score: '0:0' },
  });
  tgOutbox.markEntrySent(dayDir, 'M-T5-1', 'valid', {
    messageId: 111,
    sentAt: '2099-03-01T10:00:00.000Z',
  });
  tgOutbox.markEntrySent(dayDir, 'M-T5-1', 'no-entry-msg', {
    messageId: 222,
    sentAt: '2099-03-01T10:00:00.000Z',
  });
  tgOutbox.markResultSent(dayDir, 'M-T5-1', 'no-entry-msg', {
    messageId: 333,
    sentAt: '2099-03-01T11:00:00.000Z',
    hit: true,
  });

  const rows = pendingResultRecords(dayDir, 'M-T5-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decisionKey, 'valid');
  cleanupFutureDay(date);
});

test('resultHitForRecord reads audit hit from match prediction', () => {
  const { resultHitForRecord } = reloadTelegramDispatcher();
  const fromAudit = resultHitForRecord(
    { decisionKey: 'decision60', result: { hit: null } },
    { predictions: { decision60: { predictionAudit: { hit: true } } } },
  );
  assert.equal(fromAudit, true);

  const fromResult = resultHitForRecord(
    { decisionKey: 'decision60', result: { hit: false } },
    { predictions: { decision60: { predictionAudit: { hit: true } } } },
  );
  assert.equal(fromResult, false);
});

test('dispatchResults dry-run sends result as reply and marks resolved', async () => {
  const date = new Date('2099-03-02T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { dispatchResults } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);

      tgOutbox.enqueue(dayDir, {
        matchId: 'M-T5-2',
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });
      tgOutbox.markEntrySent(dayDir, 'M-T5-2', 'decision60', {
        messageId: 12345,
        sentAt: '2099-03-02T10:00:00.000Z',
      });

      const match = {
        matchId: 'M-T5-2',
        final: { score: '0:0', goals: [] },
        predictions: { decision60: { predictionAudit: { hit: true } } },
      };
      const updated = await dispatchResults({ match, date });
      assert.equal(updated.length, 1);
      assert.equal(updated[0].status, 'resolved');
      assert.equal(updated[0].result.messageId, -1);
      assert.equal(updated[0].result.hit, true);

      const rows = tgOutbox.readOutbox(dayDir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'resolved');
      assert.equal(rows[0].result.messageId, -1);
    },
  );
  cleanupFutureDay(date);
});

test('dispatchResults is idempotent and skips already resolved records', async () => {
  const date = new Date('2099-03-03T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { dispatchResults } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);

      tgOutbox.enqueue(dayDir, {
        matchId: 'M-T5-3',
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });
      tgOutbox.markEntrySent(dayDir, 'M-T5-3', 'decision60', {
        messageId: 12345,
        sentAt: '2099-03-03T10:00:00.000Z',
      });
      const match = {
        matchId: 'M-T5-3',
        final: { score: '0:0', goals: [] },
        predictions: { decision60: { predictionAudit: { hit: true } } },
      };

      const first = await dispatchResults({ match, date });
      const second = await dispatchResults({ match, date });
      assert.equal(first.length, 1);
      assert.equal(second.length, 0);
      const rows = tgOutbox.readOutbox(dayDir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'resolved');
    },
  );
  cleanupFutureDay(date);
});

test('dispatchResults sends TB80 result with replyToMessageId', async () => {
  const date = new Date('2099-03-04T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '0',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { dispatchResults } = reloadTelegramDispatcher();
      const tgClient = require('../src/integrations/telegram/client');
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);
      const originalSendMessage = tgClient.sendMessage;
      let captured = null;

      try {
        tgClient.sendMessage = async (args) => {
          captured = args;
          return { ok: true, messageId: 65432, error: null, attempts: 1, dryRun: false };
        };
        tgOutbox.enqueue(dayDir, {
          matchId: 'M-T5-4',
          decisionKey: 'decision80',
          predictionType: 'TB05_80_PLUS',
          tier: null,
          modelMode: 'basic',
          snapshot: { score: '0:0' },
        });
        tgOutbox.markEntrySent(dayDir, 'M-T5-4', 'decision80', {
          messageId: 54321,
          sentAt: '2099-03-04T10:00:00.000Z',
        });
        const match = {
          matchId: 'M-T5-4',
          final: { score: '1:0', goals: [{ minute: 87, scoreAfter: '1:0' }] },
          predictions: { decision80: { predictionAudit: { hit: true } } },
        };

        const updated = await dispatchResults({ match, date });
        assert.equal(updated.length, 1);
        assert.equal(updated[0].status, 'resolved');
        assert.equal(updated[0].result.messageId, 65432);
        assert.equal(updated[0].result.hit, true);
        assert.equal(captured.replyToMessageId, 54321);
      } finally {
        tgClient.sendMessage = originalSendMessage;
      }
    },
  );
  cleanupFutureDay(date);
});

test('dispatchResults prevents duplicate result send for concurrent same key', async () => {
  const date = new Date('2099-03-06T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '0',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { dispatchResults } = reloadTelegramDispatcher();
      const tgClient = require('../src/integrations/telegram/client');
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);
      const originalSendMessage = tgClient.sendMessage;
      let calls = 0;

      try {
        tgClient.sendMessage = async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { ok: true, messageId: 70001, error: null, attempts: 1, dryRun: false };
        };
        tgOutbox.enqueue(dayDir, {
          matchId: 'M-T5-4C',
          decisionKey: 'decision60',
          predictionType: 'FT_TM05_FROM_60_75',
          tier: null,
          modelMode: 'basic',
          snapshot: { score: '0:0' },
        });
        tgOutbox.markEntrySent(dayDir, 'M-T5-4C', 'decision60', {
          messageId: 54321,
          sentAt: '2099-03-06T10:00:00.000Z',
        });
        const match = {
          matchId: 'M-T5-4C',
          final: { score: '0:0', goals: [] },
          predictions: { decision60: { predictionAudit: { hit: true } } },
        };

        const [first, second] = await Promise.all([
          dispatchResults({ match, date }),
          dispatchResults({ match, date }),
        ]);
        assert.equal(calls, 1);
        assert.equal(first.length + second.length, 1);

        const rows = tgOutbox.readOutbox(dayDir);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, 'resolved');
        assert.equal(rows[0].result.messageId, 70001);

        const third = await dispatchResults({ match, date });
        assert.equal(third.length, 0);
      } finally {
        tgClient.sendMessage = originalSendMessage;
      }
    },
  );
  cleanupFutureDay(date);
});

test('dispatchResults marks result failure but keeps pending_result below max retries', async () => {
  const date = new Date('2099-03-05T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '0',
      LIVE_TG_MAX_RETRIES: '3',
      TELEGRAM_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
    async () => {
      const { dispatchResults } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);

      tgOutbox.enqueue(dayDir, {
        matchId: 'M-T5-5',
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });
      tgOutbox.markEntrySent(dayDir, 'M-T5-5', 'decision60', {
        messageId: 12345,
        sentAt: '2099-03-05T10:00:00.000Z',
      });

      const match = {
        matchId: 'M-T5-5',
        final: { score: '0:0', goals: [] },
        predictions: { decision60: { predictionAudit: { hit: true } } },
      };
      const updated = await dispatchResults({ match, date });
      assert.equal(updated.length, 1);
      assert.equal(updated[0].status, 'pending_result');
      assert.equal(updated[0].result.lastError, 'missing_credentials');
      assert.equal(updated[0].result.attempts, 0);
    },
  );
  cleanupFutureDay(date);
});

test('matchStore.finalize schedules Telegram result dispatch after persisting final', async () => {
  const date = new Date('2099-03-07T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);

      const matchId = 'M-T5-6';
      matchStore.upsertFromEnrichment({
        matchId,
        homeTeam: 'A',
        awayTeam: 'B',
        league: 'L',
        matchUrl: '/match/t5f/',
        statistics: null,
      }, date);
      matchStore.setPrediction(matchId, 'decision60', {
        predictionType: 'FT_TM05_FROM_60_75',
        predictionAudit: { hit: null, finalResult: null },
      }, date);

      tgOutbox.enqueue(dayDir, {
        matchId,
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });
      tgOutbox.markEntrySent(dayDir, matchId, 'decision60', {
        messageId: 12345,
        sentAt: '2099-03-07T10:00:00.000Z',
      });

      const final = { score: '0:0', goals: [], firstGoalMinute: null };
      const derived = { totalGoals: 0 };
      const finalized = matchStore.finalize(matchId, final, derived, date);
      assert.equal(finalized.final.score, '0:0');

      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      const persisted = matchStore.getMatch(matchId, date);
      assert.equal(persisted.final.score, '0:0');
      assert.equal(persisted.tracking.status, 'finished');

      const rows = tgOutbox.readOutbox(dayDir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'resolved');
      assert.equal(rows[0].result.messageId, -1);
    },
  );
  cleanupFutureDay(date);
});

test('matchStore.finalize skips Telegram dispatch if writeStore fails', async () => {
  const date = new Date('2099-03-08T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);
      const realWrite = fs.writeFileSync;

      const matchId = 'M-T5-7';
      matchStore.upsertFromEnrichment({
        matchId,
        homeTeam: 'A',
        awayTeam: 'B',
        league: 'L',
        matchUrl: '/match/t5f2/',
        statistics: null,
      }, date);
      matchStore.setPrediction(matchId, 'decision60', {
        predictionType: 'FT_TM05_FROM_60_75',
        predictionAudit: { hit: null, finalResult: null },
      }, date);

      tgOutbox.enqueue(dayDir, {
        matchId,
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });
      tgOutbox.markEntrySent(dayDir, matchId, 'decision60', {
        messageId: 12345,
        sentAt: '2099-03-08T10:00:00.000Z',
      });

      try {
        fs.writeFileSync = (p, ...rest) => {
          if (typeof p === 'string' && p.endsWith('matches.json')) {
            throw new Error('disk full');
          }
          return realWrite.call(fs, p, ...rest);
        };

        const final = { score: '0:0', goals: [], firstGoalMinute: null };
        const derived = { totalGoals: 0 };
        const finalized = matchStore.finalize(matchId, final, derived, date);
        assert.equal(finalized.matchId, matchId);

        await new Promise((resolve) => setImmediate(resolve));

        const rows = tgOutbox.readOutbox(dayDir);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, 'pending_result');
        assert.equal(rows[0].result.messageId, null);
      } finally {
        fs.writeFileSync = realWrite;
      }
    },
  );
  cleanupFutureDay(date);
});

test('flushPending disabled returns empty arrays', async () => {
  const date = new Date('2099-04-01T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '0',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { flushPending } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);

      const result = await flushPending({ date });

      assert.deepEqual(result, { entries: [], results: [] });
      assert.equal(tgOutbox.readOutbox(dayDir).length, 0);
    },
  );
  cleanupFutureDay(date);
});

test('flushPending recovers queued entry', async () => {
  const date = new Date('2099-04-02T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { flushPending } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);
      const matchId = 'M-T6-1';

      matchStore.upsertFromEnrichment({
        matchId,
        homeTeam: 'Home FC',
        awayTeam: 'Away FC',
        league: 'Test League',
        matchUrl: '/match/t6entry/',
        statistics: null,
      }, date);
      tgOutbox.enqueue(dayDir, {
        matchId,
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: 'tierA',
        modelMode: 'basic',
        snapshot: {
          minute: 65,
          score: '0:0',
          confidence: 0.72,
          components: {},
          riskFlags: [],
          reasons: [],
          aiVerdict: null,
        },
      });

      const result = await flushPending({ date });

      assert.equal(result.entries.length, 1);
      const row = tgOutbox.findByKey(dayDir, matchId, 'decision60');
      assert.equal(row.status, 'pending_result');
      assert.equal(row.entry.messageId, -1);
    },
  );
  cleanupFutureDay(date);
});

test('flushPending recovers pending_result for finished match', async () => {
  const date = new Date('2099-04-03T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { flushPending } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);
      const matchId = 'M-T6-2';

      matchStore.upsertFromEnrichment({
        matchId,
        homeTeam: 'Home FC',
        awayTeam: 'Away FC',
        league: 'Test League',
        matchUrl: '/match/t6result/',
        statistics: null,
      }, date);
      matchStore.setPrediction(matchId, 'decision60', {
        predictionType: 'FT_TM05_FROM_60_75',
        predictionAudit: { hit: true, finalResult: null },
      }, date);
      const store = matchStore.readStore(date);
      store[matchId].final = { score: '0:0', goals: [] };
      store[matchId].tracking.status = 'finished';
      store[matchId].predictions.decision60.predictionAudit.hit = true;
      matchStore.writeStore(store, date);
      tgOutbox.enqueue(dayDir, {
        matchId,
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });
      tgOutbox.markEntrySent(dayDir, matchId, 'decision60', {
        messageId: 12345,
        sentAt: '2099-04-03T10:00:00.000Z',
      });

      const result = await flushPending({ date });

      assert.equal(result.results.length, 1);
      const row = tgOutbox.findByKey(dayDir, matchId, 'decision60');
      assert.equal(row.status, 'resolved');
      assert.equal(row.result.messageId, -1);
    },
  );
  cleanupFutureDay(date);
});

test('flushPending skips queued without match', async () => {
  const date = new Date('2099-04-04T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { flushPending } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);

      tgOutbox.enqueue(dayDir, {
        matchId: 'GHOST',
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });

      const result = await flushPending({ date });

      assert.equal(result.entries.length, 0);
      const row = tgOutbox.findByKey(dayDir, 'GHOST', 'decision60');
      assert.equal(row.status, 'queued');
    },
  );
  cleanupFutureDay(date);
});

test('flushPending skips pending_result without finished match', async () => {
  const date = new Date('2099-04-05T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { flushPending } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);
      const matchId = 'M-T6-3';

      matchStore.upsertFromEnrichment({
        matchId,
        homeTeam: 'Home FC',
        awayTeam: 'Away FC',
        league: 'Test League',
        matchUrl: '/match/t6unfinished/',
        statistics: null,
      }, date);
      tgOutbox.enqueue(dayDir, {
        matchId,
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });
      tgOutbox.markEntrySent(dayDir, matchId, 'decision60', {
        messageId: 12345,
        sentAt: '2099-04-05T10:00:00.000Z',
      });

      const result = await flushPending({ date });

      assert.equal(result.results.length, 0);
      const row = tgOutbox.findByKey(dayDir, matchId, 'decision60');
      assert.equal(row.status, 'pending_result');
    },
  );
  cleanupFutureDay(date);
});

test('flushPending skips pending_result with final but tracking not finished', async () => {
  const date = new Date('2099-04-06T00:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const { flushPending } = reloadTelegramDispatcher();
      const matchStore = reloadModule('../src/store/matchStore');
      const tgOutbox = reloadModule('../src/store/tgOutbox');
      const dayDir = matchStore.dayLogsAbsolute(date);
      const matchId = 'M-T6-4';

      matchStore.upsertFromEnrichment({
        matchId,
        homeTeam: 'Home FC',
        awayTeam: 'Away FC',
        league: 'Test League',
        matchUrl: '/match/t6notfinished/',
        statistics: null,
      }, date);
      const store = matchStore.readStore(date);
      store[matchId].final = { score: '0:0', goals: [] };
      store[matchId].tracking.status = 'active';
      store[matchId].predictions = {
        decision60: { predictionAudit: { hit: true } },
      };
      matchStore.writeStore(store, date);
      tgOutbox.enqueue(dayDir, {
        matchId,
        decisionKey: 'decision60',
        predictionType: 'FT_TM05_FROM_60_75',
        tier: null,
        modelMode: 'basic',
        snapshot: { score: '0:0' },
      });
      tgOutbox.markEntrySent(dayDir, matchId, 'decision60', {
        messageId: 12345,
        sentAt: '2099-04-06T10:00:00.000Z',
      });

      const result = await flushPending({ date });

      assert.equal(result.results.length, 0);
      const row = tgOutbox.findByKey(dayDir, matchId, 'decision60');
      assert.equal(row.status, 'pending_result');
    },
  );
  cleanupFutureDay(date);
});

test('E2E FT: enqueue entry then finalize resolves outbox thread (dry-run)', async () => {
  const date = new Date('2099-04-10T20:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const modules = [
        '../src/config/env',
        '../src/integrations/telegram/client',
        '../src/integrations/telegram/dispatcher',
        '../src/store/matchStore',
        '../src/store/tgOutbox',
        '../src/store/predictionAuditResolver',
        '../src/store/predictionSignals',
      ];
      for (const modulePath of modules) {
        delete require.cache[require.resolve(modulePath)];
      }

      const matchStore = require('../src/store/matchStore');
      const tgOutbox = require('../src/store/tgOutbox');
      const predictionSignals = require('../src/store/predictionSignals');
      const tgDispatcher = require('../src/integrations/telegram/dispatcher');

      const dayDir = matchStore.dayLogsAbsolute(date);
      const match = {
        matchId: 'E2E1',
        homeTeam: 'Home FC',
        awayTeam: 'Away United',
        league: 'Test League',
        matchUrl: '/match/E2E1/?s=2',
        odds: { home: 1.5, draw: 4.0, away: 6.0 },
        tracking: { status: 'active', validForPrediction: true },
        snapshots: [],
        predictions: {
          decision60: {
            predictionType: 'FT_TM05_FROM_60_75',
            actionablePrimary: true,
            actionable: true,
            modelMode: 'detailed',
            confidence: 0.78,
            components: { fullTimeNilNilScore: 70 },
            reasons: [],
            riskFlags: [],
            checkpoint: 'decision60',
            predictionAudit: { components: {}, hit: null, finalResult: null },
            useInTelegram: true,
          },
        },
      };
      matchStore.writeStore({ E2E1: match }, date);

      predictionSignals.appendPredictionSignals(dayDir, {
        matchId: 'E2E1',
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league: match.league,
        recordedAt: new Date().toISOString(),
        checkpoint: 'decision60',
        signal: predictionSignals.deriveSignal(match.predictions.decision60),
        minute: 65,
        score: '0:0',
        predictionType: 'FT_TM05_FROM_60_75',
        confidence: 0.78,
        modelMode: 'detailed',
        components: { fullTimeNilNilScore: 70 },
        reasons: [],
        riskFlags: [],
      });

      const entryRecord = await tgDispatcher.enqueueEntry({
        match,
        prediction: match.predictions.decision60,
        decisionKey: 'decision60',
        minute: 65,
        score: '0:0',
        date,
      });
      assert.ok(entryRecord);
      assert.equal(entryRecord.status, 'pending_result');
      assert.equal(entryRecord.entry.messageId, -1);

      matchStore.finalize('E2E1', { scoreHome: 0, scoreAway: 0, score: '0:0', goals: [] }, { totalGoals: 0 }, date);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      const outbox = tgOutbox.readOutbox(dayDir);
      assert.equal(outbox.length, 1);
      const final = outbox[0];
      assert.equal(final.status, 'resolved');
      assert.equal(final.entry.messageId, -1);
      assert.equal(final.result.messageId, -1);
      assert.equal(final.result.hit, true);

      const signals = predictionSignals.readSignalsArray(dayDir);
      assert.equal(signals.length, 1);
      assert.equal(signals[0].matchId, 'E2E1');
      assert.equal(signals[0].checkpoint, 'decision60');
      assert.equal(signals[0].signal, 'FT_TM60_75');
      assert.equal(signals[0].predictionType, 'FT_TM05_FROM_60_75');
      assert.equal(signals[0].predictionOutcome, 'HIT');
    },
  );
  cleanupFutureDay(date);
});

test('E2E TB80: enqueue entry then finalize resolves outbox thread (dry-run)', async () => {
  const date = new Date('2099-04-11T20:00:00Z');
  cleanupFutureDay(date);
  await withEnv(
    {
      LIVE_TG_ENABLED: '1',
      LIVE_TG_DRY_RUN: '1',
      TELEGRAM_TOKEN: 'fake',
      TELEGRAM_CHAT_ID: '123',
    },
    async () => {
      const modules = [
        '../src/config/env',
        '../src/integrations/telegram/client',
        '../src/integrations/telegram/dispatcher',
        '../src/store/matchStore',
        '../src/store/tgOutbox',
        '../src/store/predictionAuditResolver',
        '../src/store/predictionSignals',
      ];
      for (const modulePath of modules) {
        delete require.cache[require.resolve(modulePath)];
      }

      const matchStore = require('../src/store/matchStore');
      const tgOutbox = require('../src/store/tgOutbox');
      const predictionSignals = require('../src/store/predictionSignals');
      const tgDispatcher = require('../src/integrations/telegram/dispatcher');

      const dayDir = matchStore.dayLogsAbsolute(date);
      const match = {
        matchId: 'E2E2',
        homeTeam: 'Goal FC',
        awayTeam: 'Late Goal United',
        league: 'Test League',
        matchUrl: '/match/E2E2/?s=2',
        odds: { home: 2.2, draw: 3.1, away: 3.3 },
        tracking: { status: 'active', validForPrediction: true },
        snapshots: [],
        predictions: {
          decision80: {
            predictionType: 'TB05_80_PLUS',
            actionablePrimary: true,
            actionable: true,
            modelMode: 'detailed',
            confidence: 0.81,
            components: { lateGoalScore80: 72 },
            reasons: [],
            riskFlags: [],
            checkpoint: 'decision80',
            predictionAudit: { components: {}, hit: null, finalResult: null },
            useInTelegram: true,
          },
        },
      };
      matchStore.writeStore({ E2E2: match }, date);

      predictionSignals.appendPredictionSignals(dayDir, {
        matchId: 'E2E2',
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league: match.league,
        recordedAt: new Date().toISOString(),
        checkpoint: 'decision80',
        signal: predictionSignals.deriveSignal(match.predictions.decision80),
        minute: 82,
        score: '0:0',
        predictionType: 'TB05_80_PLUS',
        confidence: 0.81,
        modelMode: 'detailed',
        components: { lateGoalScore80: 72 },
        reasons: [],
        riskFlags: [],
      });

      const entryRecord = await tgDispatcher.enqueueEntry({
        match,
        prediction: match.predictions.decision80,
        decisionKey: 'decision80',
        minute: 82,
        score: '0:0',
        date,
      });
      assert.ok(entryRecord);
      assert.equal(entryRecord.status, 'pending_result');
      assert.equal(entryRecord.entry.messageId, -1);

      matchStore.finalize(
        'E2E2',
        { scoreHome: 1, scoreAway: 0, score: '1:0', goals: [{ minute: 87, team: 'home', scoreAfter: '1:0' }] },
        { totalGoals: 1 },
        date,
      );
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      const outbox = tgOutbox.readOutbox(dayDir);
      assert.equal(outbox.length, 1);
      const final = outbox[0];
      assert.equal(final.status, 'resolved');
      assert.equal(final.entry.messageId, -1);
      assert.equal(final.result.messageId, -1);
      assert.equal(final.result.hit, true);

      const signals = predictionSignals.readSignalsArray(dayDir);
      assert.equal(signals.length, 1);
      assert.equal(signals[0].matchId, 'E2E2');
      assert.equal(signals[0].checkpoint, 'decision80');
      assert.equal(signals[0].signal, 'TB80_PLUS');
      assert.equal(signals[0].predictionType, 'TB05_80_PLUS');
      assert.equal(signals[0].predictionOutcome, 'HIT');
    },
  );
  cleanupFutureDay(date);
});
