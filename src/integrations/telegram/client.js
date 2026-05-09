'use strict';

const axios = require('axios');
const {
  LIVE_TG_ENABLED,
  LIVE_TG_DRY_RUN,
  LIVE_TG_MAX_RETRIES,
  LIVE_TG_RETRY_BASE_MS,
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID,
} = require('../../config/env');
const logger = require('../../observability/logger');
const { escapeMarkdownV2 } = require('./formatters/markdown');

let hasLoggedMissingCredentials = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessage({
  text,
  replyToMessageId,
  parseMode = 'MarkdownV2',
  disableWebPagePreview = true,
  chatId,
  token,
}) {
  if (!LIVE_TG_ENABLED) {
    return { ok: false, messageId: null, error: 'disabled', attempts: 0, dryRun: false };
  }

  const resolvedToken = token ?? TELEGRAM_TOKEN;
  const resolvedChatId = chatId ?? TELEGRAM_CHAT_ID;
  if (!resolvedToken || !resolvedChatId) {
    if (!hasLoggedMissingCredentials) {
      hasLoggedMissingCredentials = true;
      logger.warn('telegram.disabled', { reason: 'missing_credentials' });
    }
    return { ok: false, messageId: null, error: 'missing_credentials', attempts: 0, dryRun: false };
  }

  if (LIVE_TG_DRY_RUN) {
    logger.info('telegram.dry_run', { textPreview: String(text ?? '').slice(0, 80), replyToMessageId });
    return { ok: true, messageId: -1, error: null, attempts: 0, dryRun: true };
  }

  const maxRetries = Math.max(1, LIVE_TG_MAX_RETRIES);
  let lastError = 'unknown_error';
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts += 1;
    const payload = {
      chat_id: resolvedChatId,
      text: String(text ?? ''),
      parse_mode: parseMode,
      disable_web_page_preview: disableWebPagePreview,
    };
    if (replyToMessageId != null) payload.reply_to_message_id = replyToMessageId;

    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${resolvedToken}/sendMessage`,
        payload,
        { timeout: 10_000, validateStatus: () => true },
      );

      const status = response?.status ?? 0;
      const body = response?.data ?? {};

      if (status === 200 && body.ok === true && body.result?.message_id != null) {
        const messageId = body.result.message_id;
        logger.info('telegram.send.ok', { messageId, attempts });
        return { ok: true, messageId, error: null, attempts, dryRun: false };
      }

      const description = body?.description || 'unknown_error';
      lastError = `${status}: ${description}`;

      if (status === 429) {
        const retryAfterSec = Number(body?.parameters?.retry_after) || 1;
        await sleep(Math.max(1, retryAfterSec) * 1_000);
        continue;
      }

      if (status >= 500 && status <= 599) {
        if (attempts < maxRetries) {
          const backoffMs = LIVE_TG_RETRY_BASE_MS * (2 ** (attempts - 1));
          await sleep(backoffMs);
          continue;
        }
        break;
      }

      logger.warn('telegram.send.failed', { error: lastError, attempts });
      return { ok: false, messageId: null, error: lastError, attempts, dryRun: false };
    } catch (error) {
      lastError = error?.message || 'network_error';
      if (attempts < maxRetries) {
        const backoffMs = LIVE_TG_RETRY_BASE_MS * (2 ** (attempts - 1));
        await sleep(backoffMs);
        continue;
      }
      break;
    }
  }

  const error = `max_retries_exhausted: ${lastError}`;
  logger.warn('telegram.send.failed', { error, attempts });
  return { ok: false, messageId: null, error, attempts, dryRun: false };
}

module.exports = {
  sendMessage,
  escapeMarkdownV2,
};
