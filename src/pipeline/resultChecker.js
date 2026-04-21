const { loadDayMatches, saveDayMatches, saveDaySummary } = require('./dailyLogger');
const { previousSessionDateKey, sessionDateKey, toISO } = require('../helpers/date');

function getYesterdayDate() {
  return previousSessionDateKey();
}

function rowPriority(m) {
  if (m.pipeline === 'decision_made' && m.prediction?.bet && m.prediction.bet !== 'SKIP') return 2;
  if (m.pipeline === 'decision_made') return 1;
  return 0;
}

/**
 * Один запис на matchId для підсумків: пріоритет decision_made зі ставкою, не candidate_found.
 * betHistory зливається з усіх рядків матчу (хронологічно).
 */
function dedupeByMatchId(matches) {
  const groups = new Map();
  for (const m of matches) {
    if (!groups.has(m.matchId)) groups.set(m.matchId, []);
    groups.get(m.matchId).push(m);
  }
  const out = [];
  for (const [, rows] of groups) {
    let best = rows[0];
    for (const m of rows) {
      const mp = rowPriority(m);
      const bp = rowPriority(best);
      if (mp > bp) best = m;
      else if (mp === bp && String(m.timestamp || '') >= String(best.timestamp || '')) best = m;
    }
    const merged = [...rows]
      .filter((r) => r.betHistory && r.betHistory.length)
      .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    const betHistory = [];
    const seen = new Set();
    for (const r of merged) {
      for (const h of r.betHistory) {
        const key = `${h.bet}|${h.timeWindow}|${h.minute}|${h.timestamp}`;
        if (!seen.has(key)) {
          seen.add(key);
          betHistory.push(h);
        }
      }
    }
    // Старі логи: кілька рядків decision_made на той самий матч без betHistory
    if (betHistory.length === 0) {
      const legacy = [...rows]
        .filter((r) => r.pipeline === 'decision_made' && r.prediction?.bet && r.prediction.bet !== 'SKIP')
        .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
      for (const r of legacy) {
        const h = {
          bet: r.prediction.bet,
          timeWindow: r.prediction.timeWindow,
          minute: r.minute,
          timestamp: r.timestamp,
          confidence: r.prediction.confidence,
        };
        const key = `${h.bet}|${h.timeWindow}|${h.minute}`;
        if (!seen.has(key)) {
          seen.add(key);
          betHistory.push(h);
        }
      }
    }
    if (betHistory.length > 0) {
      out.push({ ...best, betHistory });
    } else {
      out.push(best);
    }
  }
  return out;
}

function betLegsFromEntry(entry) {
  if (entry.betHistory && entry.betHistory.length > 0) {
    return entry.betHistory.map((h) => h.bet).filter((b) => b && b !== 'SKIP');
  }
  if (entry.prediction?.bet && entry.prediction.bet !== 'SKIP') return [entry.prediction.bet];
  return [];
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

function applyResultToAllRows(matches, matchId, payload) {
  const ts = toISO();
  for (const m of matches) {
    if (m.matchId !== matchId) continue;
    m.resultChecked = true;
    m.actualResult = payload.actualResult;
    m.hit = payload.hit;
    if (payload.hitLegs) m.hitLegs = payload.hitLegs;
    m.resultTimestamp = ts;
  }
}

async function checkDayResults(page, dateRef) {
  const matches = loadDayMatches(dateRef);
  if (matches.length === 0) return null;

  const deduped = dedupeByMatchId(matches);
  const unchecked = deduped.filter(
    (m) => !m.resultChecked && m.pipeline === 'decision_made' && m.prediction?.bet && m.prediction.bet !== 'SKIP'
  );
  if (unchecked.length === 0) {
    console.log(`  [result] No unchecked predictions for ${sessionDateKey(dateRef)}`);
    return buildSummary(matches, dateRef, 0, 0, 0);
  }

  console.log(`  [result] Checking ${unchecked.length} prediction(s) (${deduped.length} унік. матчів у логу)...`);

  let checked = 0;
  let hits = 0;
  let misses = 0;

  for (const entry of unchecked) {
    const finalScore = await checkSingleResult(page, entry);
    if (!finalScore) {
      console.log(`  [result] ${entry.matchId} ${entry.home} - ${entry.away}: score not found`);
      continue;
    }

    const totalGoals = finalScore.home + finalScore.away;
    const actualOver = totalGoals > 0;
    const legs = betLegsFromEntry(entry);
    const hitLegs = legs.map((bet) => ({
      bet,
      hit: actualOver === (bet === 'OVER_0_5'),
    }));
    const hit = hitLegs.length ? hitLegs[hitLegs.length - 1].hit : false;

    const actualResult = `${finalScore.home}:${finalScore.away}`;
    applyResultToAllRows(matches, entry.matchId, { actualResult, hit, hitLegs });

    const legStr = hitLegs.map((l) => `${l.bet === 'OVER_0_5' ? 'ТБ' : 'ТМ'}:${l.hit ? '✅' : '❌'}`).join(' ');
    const mark = hit ? '✅' : '❌';
    console.log(`  [result] ${entry.home} - ${entry.away}: ${actualResult} → ${mark} остання нога | ${legStr}`);

    checked++;
    if (hit === true) hits++;
    else if (hit === false) misses++;
  }

  saveDayMatches(dateRef, matches);
  return buildSummary(matches, dateRef, checked, hits, misses);
}

function parseActualGoals(actualResult) {
  if (actualResult == null) return null;
  if (typeof actualResult === 'object' && actualResult.home != null && actualResult.away != null) {
    return Number(actualResult.home) + Number(actualResult.away);
  }
  const s = String(actualResult);
  const m = s.match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]);
}

function resolvedLegsForMatch(m) {
  if (!m.resultChecked) return [];
  if (m.hitLegs && m.hitLegs.length > 0) return m.hitLegs;

  const legs = betLegsFromEntry(m);
  const totalGoals = parseActualGoals(m.actualResult);
  if (legs.length > 1 && totalGoals !== null) {
    const actualOver = totalGoals > 0;
    return legs.map((bet) => ({ bet, hit: actualOver === (bet === 'OVER_0_5') }));
  }

  if (m.prediction?.bet && m.prediction.bet !== 'SKIP' && m.hit !== null && m.hit !== undefined) {
    return [{ bet: m.prediction.bet, hit: m.hit === true }];
  }
  return [];
}

function buildSummary(matches, dateRef, checked, hits, misses, options = {}) {
  const persist = options.persist !== false;
  const unique = dedupeByMatchId(matches);
  const actionable = unique.filter(
    (m) => m.pipeline === 'decision_made' && m.prediction?.bet && m.prediction.bet !== 'SKIP'
  );

  let stakeLegsPlanned = 0;
  for (const m of actionable) {
    const legs = betLegsFromEntry(m);
    stakeLegsPlanned += legs.length > 0 ? legs.length : 1;
  }

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

  const byBetType = { UNDER_0_5: { legs: 0, hits: 0, misses: 0 }, OVER_0_5: { legs: 0, hits: 0, misses: 0 } };
  for (const m of actionable) {
    const rl = resolvedLegsForMatch(m);
    if (rl.length === 0) continue;
    for (const leg of rl) {
      if (leg.bet !== 'UNDER_0_5' && leg.bet !== 'OVER_0_5') continue;
      const key = leg.bet;
      byBetType[key].legs += 1;
      if (leg.hit === true) byBetType[key].hits += 1;
      else if (leg.hit === false) byBetType[key].misses += 1;
    }
  }

  const byBetTypeFormatted = {};
  for (const betType of ['UNDER_0_5', 'OVER_0_5']) {
    const b = byBetType[betType];
    const checkedLegs = b.hits + b.misses;
    byBetTypeFormatted[betType] = {
      total: b.legs,
      checked: checkedLegs,
      hits: b.hits,
      misses: b.misses,
      hitRate: checkedLegs > 0 ? Number((b.hits / checkedLegs).toFixed(3)) : null,
    };
  }

  const flips = actionable.filter((m) => {
    if (!m.betHistory || m.betHistory.length < 2) return false;
    const bets = m.betHistory.map((b) => b.bet);
    return bets.includes('UNDER_0_5') && bets.includes('OVER_0_5');
  });

  let legHitsTotal = 0;
  let legMissesTotal = 0;
  for (const m of actionable) {
    for (const leg of resolvedLegsForMatch(m)) {
      if (leg.hit === true) legHitsTotal++;
      else if (leg.hit === false) legMissesTotal++;
    }
  }
  const legsResolved = legHitsTotal + legMissesTotal;

  const totalHitsAll = actionable.filter((m) => m.hit === true).length;
  const totalMissesAll = actionable.filter((m) => m.hit === false).length;
  const totalResolved = totalHitsAll + totalMissesAll;

  const summary = {
    date: sessionDateKey(dateRef),
    totalRowsInLog: matches.length,
    uniqueMatches: unique.length,
    actionable: actionable.length,
    stakeLegsPlanned,
    checkedThisRun: checked,
    hitsThisRun: hits,
    missesThisRun: misses,
    resolved: totalResolved,
    hits: totalHitsAll,
    misses: totalMissesAll,
    hitRate: totalResolved > 0 ? Number((totalHitsAll / totalResolved).toFixed(3)) : null,
    legsResolved,
    legHits: legHitsTotal,
    legMisses: legMissesTotal,
    legHitRate: legsResolved > 0 ? Number((legHitsTotal / legsResolved).toFixed(3)) : null,
    byConfidence,
    byBetType: byBetTypeFormatted,
    flips: flips.length,
    generatedAt: toISO(),
  };

  if (persist) saveDaySummary(dateRef, summary);
  return summary;
}

async function checkYesterdayResults(page) {
  return checkDayResults(page, getYesterdayDate());
}

module.exports = {
  checkYesterdayResults,
  checkDayResults,
  getYesterdayDate,
  dedupeByMatchId,
  betLegsFromEntry,
  resolvedLegsForMatch,
  buildSummary,
};
