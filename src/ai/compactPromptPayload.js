'use strict';

/** Minify JSON for chat API user messages (fewer input tokens than pretty-print). */
function compactPromptPayload(obj) {
  return JSON.stringify(obj);
}

module.exports = { compactPromptPayload };
