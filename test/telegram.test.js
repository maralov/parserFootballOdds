'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

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
