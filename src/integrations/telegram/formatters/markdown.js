'use strict';

function escapeMarkdownV2(text) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') {
    if (typeof text !== 'number') return '';
    text = String(text);
  }
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function escapeMarkdownV2LinkUrl(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\\)]/g, '\\$&');
}

module.exports = {
  escapeMarkdownV2,
  escapeMarkdownV2LinkUrl,
};
