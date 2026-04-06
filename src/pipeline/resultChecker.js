const { loadDayMatches, saveDayMatches, saveDaySummary } = require('./dailyLogger');

function getYesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

async function checkSingleResult(page, entry) {
  if (!entry.matchDetailsUrl) return null;

  try {
    await page.goto(entry.matchDetailsUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      const scoreLink = document.querySelector('a.live[href], a[href*="/match/"]');
      if (scoreLink) {
        const match = scoreLink.textContent.trim().match(/(\d+):(\d+)/);
        if (match) return { home: Number(match[1]), away: Number(match[2]) };
      }
      const bodyText = document.body?.textContent || '';
      const scoreMatch = bodyText.match(/(\d+)\s*:\s*(\d+)/);
      if (scoreMatch) return { home: Number(scoreMatch[1]), away: Number(scoreMatch[2]) };
      return null;
    });

    return result;
  } catch (e) {
    return null;
  }
}

async function checkYesterdayResults(page) {
  const yesterday = getYesterdayDate();
  const matches = loadDayMatches(yesterday);

  if (matches.length === 0) return null;

  const unchecked = matches.filter((m) => !m.resultChecked);
  if (unchecked.length === 0) return null;

  let checked = 0;
  let hits = 0;
  let misses = 0;

  for (const entry of unchecked) {
    const finalScore = await checkSingleResult(page, entry);
    if (!finalScore) continue;

    entry.resultChecked = true;
    entry.actualResult = `${finalScore.home}:${finalScore.away}`;
    const totalGoals = finalScore.home + finalScore.away;

    if (entry.prediction.bet === 'OVER_0_5') {
      entry.hit = totalGoals > 0;
    } else if (entry.prediction.bet === 'UNDER_0_5') {
      entry.hit = totalGoals === 0;
    } else {
      entry.hit = null;
    }

    checked++;
    if (entry.hit === true) hits++;
    else if (entry.hit === false) misses++;
  }

  saveDayMatches(yesterday, matches);

  const actionable = matches.filter((m) => m.prediction.bet !== 'SKIP');
  const summary = {
    date: yesterday.toISOString().slice(0, 10),
    totalMatches: matches.length,
    actionable: actionable.length,
    checked,
    hits,
    misses,
    hitRate: actionable.length > 0
      ? Number((actionable.filter((m) => m.hit === true).length / actionable.length).toFixed(3))
      : null,
    generatedAt: new Date().toISOString(),
  };

  saveDaySummary(yesterday, summary);
  return summary;
}

module.exports = { checkYesterdayResults, getYesterdayDate };
