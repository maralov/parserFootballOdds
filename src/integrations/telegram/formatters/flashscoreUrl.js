'use strict';

function buildFlashscoreDesktopUrl(matchUrl) {
  if (typeof matchUrl !== 'string' || !matchUrl.trim()) return null;
  const normalized = matchUrl.trim();
  const match = normalized.match(/\/match\/([^/?#]+)/i);
  if (!match || !match[1]) return null;
  return `https://www.flashscore.com/match/${match[1]}/#match-summary`;
}

module.exports = {
  buildFlashscoreDesktopUrl,
};
