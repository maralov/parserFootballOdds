const { loadDayMatches, saveDayMatches, saveDaySummary } = require('./dailyLogger');
const { yesterday, dateKeyLocal, toISO } = require('../helpers/date');

function getYesterdayDate() {
  return yesterday();
}

async function checkSingleResult(page, entry) {
  const url = entry.mobileUrl || entry.desktopUrl;
  if (!url) return null;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    return await page.evaluate(() => {
      const detailBold = document.querySelector('div.detail > b');
      if (detailBold) {
        const m = detailBold.textContent.trim().match(/^(\d+):(\d+)/);
        if (m) return { home: Number(m[1]), away: Number(m[2]) };
      }

      const liveLink = document.querySelector('a.live[href]');
      if (liveLink) {
        const m = liveLink.textContent.trim().match(/(\d+):(\d+)/);
        if (m) return { home: Number(m[1]), away: Number(m[2]) };
      }

      const title = document.title || '';
      const tm = title.match(/(\d+)\s*[-–:]\s*(\d+)/);
      if (tm) return { home: Number(tm[1]), away: Number(tm[2]) };

      return null;
    });
  } catch (e) {
    console.log(`  [result] Error checking ${entry.matchId}: ${e.message}`);
    return null;
  }
}

async function checkDayResults(page, dateRef) {
  const matches = loadDayMatches(dateRef);
  if (matches.length === 0) return null;

  const unchecked = matches.filter(
    (m) => !m.resultChecked && m.pipeline === 'decision_made' && m.prediction?.bet && m.prediction.bet !== 'SKIP'
  );
  if (unchecked.length === 0) {
    console.log(`  [result] No unchecked predictions for ${dateKeyLocal(dateRef)}`);
    return buildSummary(matches, dateRef, 0, 0, 0);
  }

  console.log(`  [result] Checking ${unchecked.length} predictions for ${dateKeyLocal(dateRef)}...`);

  let checked = 0;
  let hits = 0;
  let misses = 0;

  for (const entry of unchecked) {
    const finalScore = await checkSingleResult(page, entry);
    if (!finalScore) {
      console.log(`  [result] ${entry.matchId} ${entry.home} - ${entry.away}: score not found`);
      continue;
    }

    entry.resultChecked = true;
    entry.actualResult = `${finalScore.home}:${finalScore.away}`;
    const totalGoals = finalScore.home + finalScore.away;

    if (entry.prediction.bet === 'OVER_0_5') {
      entry.hit = totalGoals > 0;
    } else if (entry.prediction.bet === 'UNDER_0_5') {
      entry.hit = totalGoals === 0;
    }

    const mark = entry.hit ? '✅' : '❌';
    console.log(`  [result] ${entry.home} - ${entry.away}: ${entry.actualResult} → ${mark} (${entry.prediction.bet}, ${entry.prediction.confidence})`);

    checked++;
    if (entry.hit === true) hits++;
    else if (entry.hit === false) misses++;
  }

  saveDayMatches(dateRef, matches);
  return buildSummary(matches, dateRef, checked, hits, misses);
}

function buildSummary(matches, dateRef, checked, hits, misses) {
  const actionable = matches.filter(
    (m) => m.pipeline === 'decision_made' && m.prediction?.bet && m.prediction.bet !== 'SKIP'
  );

  const byConfidence = {};
  for (const conf of ['high', 'medium', 'low']) {
    const group = actionable.filter((m) => m.prediction.confidence === conf);
    const groupHits = group.filter((m) => m.hit === true).length;
    const groupMisses = group.filter((m) => m.hit === false).length;
    const groupChecked = groupHits + groupMisses;
    byConfidence[conf] = {
      total: group.length,
      checked: groupChecked,
      hits: groupHits,
      misses: groupMisses,
      hitRate: groupChecked > 0 ? Number((groupHits / groupChecked).toFixed(3)) : null,
    };
  }

  const totalChecked = actionable.filter((m) => m.hit === true || m.hit === false);
  const totalHits = actionable.filter((m) => m.hit === true).length;

  const summary = {
    date: dateKeyLocal(dateRef),
    totalMatches: matches.length,
    actionable: actionable.length,
    checked,
    hits,
    misses,
    hitRate: totalChecked.length > 0 ? Number((totalHits / totalChecked.length).toFixed(3)) : null,
    byConfidence,
    generatedAt: toISO(),
  };

  saveDaySummary(dateRef, summary);
  return summary;
}

async function checkYesterdayResults(page) {
  return checkDayResults(page, getYesterdayDate());
}

module.exports = { checkYesterdayResults, checkDayResults, getYesterdayDate };
