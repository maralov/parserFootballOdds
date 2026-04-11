const TIMEOUT = 25000;

/**
 * Парсинг вкладки подій m.flashscore.ua: #detail-tab-content → .incident.soccer,
 * гол: p.i-field.icon.ball, хвилина: p.i-field.time | p.i-field.time-wide.
 * finalScoreHint — рахунок зі списку дня (для home/away і проміжного рахунку).
 */
function parseMatchDetailFromDocument(finalScoreHint) {
  const result = { goals: [], odds1X2: null, kickoffTime: null };
  const scoreByMinute = new Map();

  function parseMinuteFromText(text) {
    const m = String(text || '').match(/(\d{1,3})(?:\+(\d{1,2}))?[''′`]/);
    if (!m) return null;
    const base = Number(m[1]);
    const extra = m[2] ? Number(m[2]) : 0;
    const minute = base + extra;
    if (!Number.isFinite(minute) || minute < 1 || minute > 130) return null;
    return minute;
  }

  function tryScoreFromPage() {
    const detailBold = document.querySelector('div.detail > b');
    if (detailBold) {
      const m = detailBold.textContent.trim().match(/^(\d+):(\d+)/);
      if (m) return { home: Number(m[1]), away: Number(m[2]) };
    }
    const candidates = document.querySelectorAll(
      '.detail__matchInfo .score, .m-score, [class*="match-score"] span, .detail__score'
    );
    for (const el of candidates) {
      const m = (el.textContent || '').trim().match(/(\d+)\s*[-:]\s*(\d+)/);
      if (m) return { home: Number(m[1]), away: Number(m[2]) };
    }
    return null;
  }

  if (finalScoreHint && Number.isFinite(finalScoreHint.home) && Number.isFinite(finalScoreHint.away)) {
    result.confirmedScore = { home: finalScoreHint.home, away: finalScoreHint.away };
  } else {
    const pageScore = tryScoreFromPage();
    if (pageScore) result.confirmedScore = pageScore;
  }

  function participantHints() {
    const homeEl =
      document.querySelector('.duelParticipant--home .duelParticipant__name') ||
      document.querySelector('.duelParticipant__home .duelParticipant__name');
    const awayEl =
      document.querySelector('.duelParticipant--away .duelParticipant__name') ||
      document.querySelector('.duelParticipant__away .duelParticipant__name');
    return {
      home: homeEl ? homeEl.textContent.trim() : '',
      away: awayEl ? awayEl.textContent.trim() : '',
    };
  }

  function extractTeamCode(text) {
    const m = String(text || '').trim().match(/\[([^\]]+)\]\s*$/);
    return m ? m[1].trim() : null;
  }

  function assignSidesByFinal(raw, finalH, finalA) {
    const n = raw.length;
    const sides = new Array(n);
    function walk(i, h, a) {
      if (i === n) return h === finalH && a === finalA;
      if (h < finalH) {
        sides[i] = 'home';
        if (walk(i + 1, h + 1, a)) return true;
      }
      if (a < finalA) {
        sides[i] = 'away';
        if (walk(i + 1, h, a + 1)) return true;
      }
      return false;
    }
    return walk(0, 0, 0) ? sides : null;
  }

  function guessSideFromCode(code, hints) {
    if (!code) return null;
    const inHome = hints.home && hints.home.includes(code);
    const inAway = hints.away && hints.away.includes(code);
    if (inHome && !inAway) return 'home';
    if (inAway && !inHome) return 'away';
    return null;
  }

  const root = document.querySelector('#detail-tab-content') || document.body;
  const rawGoals = [];

  root.querySelectorAll('div.incident.soccer, .incident.soccer').forEach((row) => {
    const iconP = row.querySelector('p.i-field.icon');
    if (!iconP || !iconP.classList.contains('ball')) return;

    const timeEl = row.querySelector('p.i-field.time, p.i-field.time-wide');
    const minute = parseMinuteFromText(timeEl ? timeEl.textContent : '');
    if (minute === null) return;

    const text = (row.textContent || '').trim();
    const isOwnGoal = /\b(?:власний гол|own goal|автогол|og)\b/i.test(text);
    const isPenaltyGoal = /\(пен\.\)|penalty|пенальті/i.test(text) && !/промах|missed/i.test(text);
    const code = extractTeamCode(text);

    rawGoals.push({ minute, code, isOwnGoal, isPenaltyGoal, text });
  });

  rawGoals.sort((a, b) => a.minute - b.minute || 0);

  const hints = participantHints();
  const finalH = result.confirmedScore ? result.confirmedScore.home : null;
  const finalA = result.confirmedScore ? result.confirmedScore.away : null;
  const n = rawGoals.length;
  const totalExpected = finalH !== null && finalA !== null ? finalH + finalA : null;

  let goals = [];
  if (totalExpected !== null && n === totalExpected) {
    const sides = assignSidesByFinal(rawGoals, finalH, finalA);
    if (sides) {
      let runningHome = 0;
      let runningAway = 0;
      for (let i = 0; i < n; i++) {
        const g = rawGoals[i];
        const team = sides[i];
        if (team === 'home') runningHome++;
        else runningAway++;
        const scoreStr = `${runningHome}:${runningAway}`;
        goals.push({
          minute: g.minute,
          team,
          type: g.isOwnGoal ? 'own_goal' : g.isPenaltyGoal ? 'penalty' : 'goal',
          score: scoreStr,
        });
        scoreByMinute.set(g.minute, scoreStr);
      }
    }
  }

  if (goals.length === 0 && n > 0) {
    for (const g of rawGoals) {
      const team = guessSideFromCode(g.code, hints) || 'unknown';
      goals.push({
        minute: g.minute,
        team,
        type: g.isOwnGoal ? 'own_goal' : g.isPenaltyGoal ? 'penalty' : 'goal',
        score: null,
      });
    }
  }

  result.goals = goals
    .filter((g) => Number.isFinite(g.minute) && g.minute >= 1 && g.minute <= 130)
    .sort((a, b) => a.minute - b.minute)
    .map((g) => ({ ...g, score: scoreByMinute.get(g.minute) || g.score || null }));

  const oddsEl = document.querySelector('p.odds-detail, p[class*="odds-detail"]');
  if (oddsEl) {
    const links = oddsEl.querySelectorAll('a');
    if (links.length >= 3) {
      const vals = Array.from(links).map(a => parseFloat(a.textContent.trim()));
      if (vals.every(v => !isNaN(v) && v > 0)) {
        result.odds1X2 = { home: vals[0], draw: vals[1], away: vals[2] };
      }
    }
    if (!result.odds1X2) {
      const txt = oddsEl.textContent || '';
      const parts = txt.split('|').map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v > 0);
      if (parts.length >= 3) {
        result.odds1X2 = { home: parts[0], draw: parts[1], away: parts[2] };
      }
    }
  }

  return result;
}

async function parseMatchDetail(page, matchUrl, finalScoreHint) {
  try {
    await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    const detail = await page.evaluate(parseMatchDetailFromDocument, finalScoreHint || null);
    return detail;
  } catch (e) {
    return { goals: [], odds1X2: null, error: e.message };
  }
}

function normalizePathNoQuery(url) {
  return String(url || '')
    .split('?')[0]
    .replace(/\/+$/, '');
}

async function checkStatsAvailability(page, matchUrl) {
  const basePath = normalizePathNoQuery(matchUrl);
  const statsUrl = `${basePath}/?t=stats`;
  try {
    const currentPath = normalizePathNoQuery(page.url());
    if (currentPath !== basePath) {
      await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(1500);
    }

    const hasStatsTab = await page.evaluate(() => {
      const tabs = document.querySelector('#detail-tabs');
      if (!tabs) return false;
      const links = tabs.querySelectorAll('a[href]');
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (href.includes('t=stats')) return true;
      }
      return false;
    });

    if (!hasStatsTab) return false;

    await page.goto(statsUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(1500);

    const hasStats = await page.evaluate(() => {
      const mobi = document.querySelector('#statistics-mobi');
      if (mobi && mobi.textContent.trim().length > 20) return true;
      const wcl = document.querySelectorAll('[class*="statisticsMobi"]');
      if (wcl.length > 0) return true;
      return false;
    });

    return hasStats;
  } catch (e) {
    return false;
  }
}

function analyzeGoalTimeline(goals, finalScore) {
  const sorted = [...goals].sort((a, b) => a.minute - b.minute);
  const goalMinutes = [...new Set(sorted.map((g) => g.minute))].sort((a, b) => a - b);
  const firstGoalMinute = sorted.length > 0 ? sorted[0].minute : null;
  const hasEarlyGoal = sorted.some((g) => g.minute < 60);
  const hasLateGoal = sorted.some((g) => g.minute >= 60);

  const totalGoals = finalScore ? Number(finalScore.home) + Number(finalScore.away) : 0;
  let timelineIncomplete = false;
  let goalsAfter60 = null;

  if (totalGoals === 0) {
    goalsAfter60 = 0;
    timelineIncomplete = false;
  } else if (goalMinutes.length === 0) {
    goalsAfter60 = null;
    timelineIncomplete = true;
  } else if (goalMinutes.length !== totalGoals) {
    timelineIncomplete = true;
    goalsAfter60 = goalMinutes.filter((m) => m >= 60).length;
  } else {
    goalsAfter60 = goalMinutes.filter((m) => m >= 60).length;
    timelineIncomplete = false;
  }

  let wasZeroZeroAt60 = true;
  if (hasEarlyGoal) wasZeroZeroAt60 = false;
  else if (totalGoals > 0 && sorted.length === 0) wasZeroZeroAt60 = null;

  return {
    firstGoalMinute,
    hasEarlyGoal,
    hasLateGoal,
    wasZeroZeroAt60,
    goalsAfter60,
    goalMinutes,
    timelineIncomplete,
  };
}

function computeImpliedProbabilities(odds) {
  if (!odds) return null;
  const total = 1 / odds.home + 1 / odds.draw + 1 / odds.away;
  return {
    home: Number((1 / odds.home / total).toFixed(3)),
    draw: Number((1 / odds.draw / total).toFixed(3)),
    away: Number((1 / odds.away / total).toFixed(3)),
  };
}

module.exports = { parseMatchDetail, checkStatsAvailability, analyzeGoalTimeline, computeImpliedProbabilities };
