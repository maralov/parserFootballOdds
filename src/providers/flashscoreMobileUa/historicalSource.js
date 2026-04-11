const ALLOWED_SCORES = new Set(['0:0', '1:0', '0:1', '1:1', '2:0', '0:2']);

function splitLeagueTitle(full) {
  const s = String(full || '')
    .replace(/\s*Таблиця\s*$/i, '')
    .replace(/\s*Standings\s*$/i, '')
    .trim();
  const idx = s.indexOf(':');
  if (idx === -1) return { country: null, leagueName: s || null, leagueFull: full };
  return {
    country: s.slice(0, idx).trim() || null,
    leagueName: s.slice(idx + 1).trim() || null,
    leagueFull: full,
  };
}

function parseFinishedMatchesFromDocument(feedUrl) {
  const scoreData = document.getElementById('score-data');
  if (!scoreData) return { matches: [], stats: { total: 0, filtered: 0, byScore: {} } };

  const lines = scoreData.innerHTML.split(/<br\s*\/?>/i);
  const matches = [];
  const byScore = {};
  let currentLeague = 'unknown';
  let total = 0;

  function getLeagueName(node) {
    if (!node) return 'unknown';
    return node.textContent.replace(/\s*Таблиця\s*$/i, '').replace(/\s*Standings\s*$/i, '').trim() || 'unknown';
  }

  for (const line of lines) {
    const leagueMatch = line.match(/<h4[^>]*>(.*?)<\/h4>/i);
    if (leagueMatch) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = leagueMatch[0];
      currentLeague = getLeagueName(wrapper.querySelector('h4'));
      continue;
    }

    const hasLink = /<a\s+[^>]*href/i.test(line);
    if (!hasLink) continue;

    total++;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = line;

    const link = wrapper.querySelector('a[href*="/match/"]');
    if (!link) continue;

    const scoreText = link.textContent.trim();
    const scoreMatch = scoreText.match(/^(\d+):(\d+)/);
    if (!scoreMatch) continue;

    const scoreKey = `${scoreMatch[1]}:${scoreMatch[2]}`;
    byScore[scoreKey] = (byScore[scoreKey] || 0) + 1;

    const href = link.getAttribute('href') || '';
    const idMatch = href.match(/\/match\/([^\/\?]+)/);
    const matchId = idMatch ? idMatch[1] : '';
    if (!matchId) continue;

    const textBefore = wrapper.textContent.split(scoreText)[0] || '';
    const timePart = textBefore.match(/(\d{1,2}:\d{2})/);
    const kickoffTime = timePart ? timePart[1] : null;

    const teamsPart = wrapper.textContent
      .replace(scoreText, '|||')
      .replace(/\d{1,2}:\d{2}/, '')
      .split('|||')[0] || '';

    const teams = teamsPart.split(' - ').map(t => t.trim()).filter(Boolean);
    if (teams.length !== 2) continue;

    const cleanUrl = href.split('?')[0];
    const fullUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://m.flashscore.ua${cleanUrl}`;

    matches.push({
      id: matchId,
      league: currentLeague,
      home: teams[0],
      away: teams[1],
      finalScore: { home: Number(scoreMatch[1]), away: Number(scoreMatch[2]) },
      scoreKey,
      matchDetailsUrl: fullUrl,
      kickoffTime,
      feed: feedUrl || null,
    });
  }

  return { matches, stats: { total, filtered: matches.length, byScore } };
}

async function collectFinishedMatches(page, dayOffset) {
  const url = `https://m.flashscore.ua/?d=${dayOffset}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#score-data', { timeout: 20000 });
  await page.waitForTimeout(1500);

  const { matches, stats } = await page.evaluate(parseFinishedMatchesFromDocument, url);

  const enriched = matches.map((m) => {
    const { country, leagueName, leagueFull } = splitLeagueTitle(m.league);
    return { ...m, country, leagueName, league: leagueFull };
  });

  const filtered = enriched.filter((m) => ALLOWED_SCORES.has(m.scoreKey));

  return {
    allMatches: enriched,
    filtered,
    stats: { ...stats, afterScoreFilter: filtered.length },
  };
}

module.exports = { collectFinishedMatches, ALLOWED_SCORES, splitLeagueTitle };
