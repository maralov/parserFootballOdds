const { TELEGRAM_MODEL_TAG } = require('./constants');

/** Префікс для MarkdownV2-стилю Telegram (parse_mode Markdown у проєкті). */
function getTelegramMarkdownPrefix() {
  const t = String(TELEGRAM_MODEL_TAG || '').trim();
  if (!t) return '';
  return `*[${t}]*\n\n`;
}

/**
 * Футер з тегом моделі та лінії.
 * line: undefined | 'L1' | 'L2' → `v3.4` / `v3.4_L1` / `v3.4_L2` (моноширинний, щоб underscore не ламав markdown).
 */
function getTelegramModelFooter(line) {
  const t = String(TELEGRAM_MODEL_TAG || '').trim() || 'v3.4';
  const tag = line ? `${t}_${line}` : t;
  return `\n\n\`${tag}\``;
}

module.exports = { getTelegramMarkdownPrefix, getTelegramModelFooter };
