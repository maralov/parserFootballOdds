const { createLiveMatchCandidate } = require('../../pipeline/contracts');
const { LIVE_MIN_CANDIDATE_MINUTE } = require('../../helpers/constants');

function parseLiveMatchesFromDocument(minMinute, feedLabel, feedUrl) {
  function parseMinute(text) {
    const minuteMatch = String(text || '')
      .trim()
      .match(/^(\d{1,3})(?:\+(\d{1,2}))?/);
    if (!minuteMatch) return null;
    return Number(minuteMatch[1]);
  }

  function getLeagueName(node) {
    if (!node) return 'unknown';
    return node.textContent.replace(/\s*Standings\s*$/i, '').trim() || 'unknown';
  }

  const scoreData = document.getElementById('score-data');
  if (!scoreData) {
    return { matches: [], health: { totalRows: 0, missingId: 0, missingMinute: 0, missingUrl: 0 } };
  }

  const lines = scoreData.innerHTML.split(/<br\s*\/?>/i);
  const matches = [];
  const skippedByMinute = [];
  const health = { totalRows: 0, missingId: 0, missingMinute: 0, missingUrl: 0, totalZeroZero: 0 };
  let currentLeague = 'unknown';

  for (const line of lines) {
    const leagueMatch = line.match(/<h4[^>]*>(.*?)<\/h4>/i);
    if (leagueMatch) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = leagueMatch[0];
      currentLeague = getLeagueName(wrapper.querySelector('h4'));
      continue;
    }

    if (!/class="live"/i.test(line)) continue;
    health.totalRows += 1;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = line;

    const liveTimeNode = wrapper.querySelector('span.live');
    const linkNode = wrapper.querySelector('a.live[href]');
    if (!liveTimeNode) {
      health.missingMinute += 1;
      continue;
    }

    const minute = parseMinute(liveTimeNode.textContent);
    if (minute === null) {
      health.missingMinute += 1;
      continue;
    }

    if (!linkNode) {
      health.missingUrl += 1;
      continue;
    }

    const scoreMatch = (linkNode.textContent || '').trim().match(/^(\d+):(\d+)$/);
    if (!scoreMatch) continue;
    const homeScore = scoreMatch[1];
    const awayScore = scoreMatch[2];
    if (homeScore !== '0' || awayScore !== '0') continue;
    health.totalZeroZero += 1;

    const matchLink = linkNode.getAttribute('href') || '';
    const idMatch = matchLink.match(/\/match\/([^\/\?]+)/);
    const matchId = idMatch ? idMatch[1] : '';
    if (!matchId) {
      health.missingId += 1;
      continue;
    }

    const teamsPart = (wrapper.innerHTML.split('</span>')[1] || '').split('<a')[0] || '';
    const teams = teamsPart
      .replace(/<[^>]+>/g, '')
      .split(' - ')
      .map((team) => team.trim())
      .filter(Boolean);
    if (teams.length !== 2) continue;

    if (minute < minMinute) {
      skippedByMinute.push({ home: teams[0], away: teams[1], minute, league: currentLeague });
      continue;
    }

    const cleanUrl = matchLink.split('?')[0];
    const fullUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://m.flashscore.ua${cleanUrl}`;

    matches.push({
      id: matchId,
      league: currentLeague,
      minute,
      matchDetailsUrl: fullUrl,
      home: teams[0],
      away: teams[1],
      score: { home: homeScore, away: awayScore },
      provider: 'flashscore-mobile-ua',
      feed: feedLabel || null,
      feedUrl: feedUrl || null,
    });
  }

  return { matches, skippedByMinute, health };
}

async function collectLiveMatches(page, liveUrl) {
  await page.goto(liveUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#score-data', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const { matches, skippedByMinute, health } = await page.evaluate(
    parseLiveMatchesFromDocument,
    LIVE_MIN_CANDIDATE_MINUTE,
    liveUrl.includes('s=1') ? 's=1' : 's=2',
    liveUrl
  );
  return {
    matches: matches.map((item) => createLiveMatchCandidate(item)),
    skippedByMinute: skippedByMinute || [],
    health,
  };
}

module.exports = {
  collectLiveMatches,
};
