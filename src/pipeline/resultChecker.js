const { loadDayMatches, saveDayMatches, saveDaySummary } = require('./dailyLogger');
const { yesterday, dateKeyLocal, toISO } = require('../helpers/date');

function getYesterdayDate() {
  return yesterday();
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
  const yesterdayRef = getYesterdayDate();
  const matches = loadDayMatches(yesterdayRef);

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

    const bet = entry.prediction?.bet;
    if (bet === 'OVER_0_5') {
      entry.hit = totalGoals > 0;
    } else if (bet === 'UNDER_0_5') {
      entry.hit = totalGoals === 0;
    } else {
      entry.hit = null;
    }

    checked++;
    if (entry.hit === true) hits++;
    else if (entry.hit === false) misses++;
  }

  saveDayMatches(yesterdayRef, matches);

  const actionable = matches.filter((m) => m.prediction?.bet && m.prediction.bet !== 'SKIP');
  const summary = {
    date: dateKeyLocal(yesterdayRef),
    totalMatches: matches.length,
    actionable: actionable.length,
    checked,
    hits,
    misses,
    hitRate: actionable.length > 0
      ? Number((actionable.filter((m) => m.hit === true).length / actionable.length).toFixed(3))
      : null,
    generatedAt: toISO(),
  };

  saveDaySummary(yesterdayRef, summary);
  return summary;
}

module.exports = { checkYesterdayResults, getYesterdayDate };
