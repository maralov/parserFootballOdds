const { TELEGRAM_MODEL_TAG } = require('./constants');

/** Префікс для MarkdownV2-стилю Telegram (parse_mode Markdown у проєкті). */
function getTelegramMarkdownPrefix() {
  const t = String(TELEGRAM_MODEL_TAG || '').trim();
  if (!t) return '';
  return `*[${t}]*\n\n`;
}

module.exports = { getTelegramMarkdownPrefix };
