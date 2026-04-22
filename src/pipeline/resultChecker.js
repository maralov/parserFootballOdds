const { loadDayMatches, saveDayMatches, saveDaySummary, saveDayPredictions, saveDayStakeRoi } = require('./dailyLogger');
const { yesterday, sessionDateKey, dateKeyLocal, toISO } = require('../helpers/date');
const { sanitizeLeagueName, sanitizeTeams, formatBetLabel } = require('../helpers/utils/normalizeMatchText');

const STAKE_ROI_MODEL = {
  bankStart: 10000,
  stakePct: 0.05,
  stakePerBet: 500,
  oddsByPeriod: {
    tm_60_70: 2.5,
    tm_or_tb_70_80: 1.8,
    tb_80_90: 2.5,
  },
};

function getYesterdayDate() {
  // Сесія закінчується о 10:00 — "вчора" = попередня сесія
  return sessionDateKey(yesterday());
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
  return collapseSignalsByFlip(signalHistoryFromEntry(entry)).map((s) => s.bet);
}

function signalHistoryFromEntry(entry) {
  if (Array.isArray(entry.betHistory) && entry.betHistory.length > 0) {
    return entry.betHistory
      .filter((h) => h?.bet && h.bet !== 'SKIP')
      .map((h) => ({
        bet: h.bet,
        timeWindow: h.timeWindow || null,
        minute: h.minute ?? null,
        confidence: h.confidence ?? null,
        pGoal: h.pGoal ?? null,
        pDry: h.pDry ?? null,
        signalQuality: h.signalQuality ?? null,
        snapshotCount: h.snapshotCount ?? null,
        edge: h.edge ?? null,
        reason: h.reason ?? null,
        impliedProb: h.impliedProb ?? null,
        odds1X2: h.odds1X2 ?? null,
        timestamp: h.timestamp ?? null,
      }));
  }
  if (entry.prediction?.bet && entry.prediction.bet !== 'SKIP') {
    return [{
      bet: entry.prediction.bet,
      timeWindow: entry.prediction.timeWindow || null,
      minute: entry.prediction.minute ?? entry.minute ?? null,
      confidence: entry.prediction.confidence ?? null,
      pGoal: entry.prediction.pGoal ?? null,
      pDry: entry.prediction.pDry ?? null,
      signalQuality: entry.prediction.signalQuality ?? null,
      snapshotCount: entry.prediction.snapshotCount ?? null,
      edge: entry.prediction.edge ?? null,
      reason: entry.prediction.reason ?? null,
      impliedProb: entry.prediction.impliedProb ?? null,
      odds1X2: entry.prediction.odds1X2 ?? null,
      timestamp: entry.prediction.timestamp ?? entry.timestamp ?? null,
    }];
  }
  return [];
}

/**
 * Правило обліку ставок:
 * - якщо в наступних вікнах той самий bet (ТМ→ТМ), лишається тільки перший;
 * - нова ставка додається тільки при зміні напряму (ТМ→ТБ або ТБ→ТМ).
 */
function collapseSignalsByFlip(signalHistory) {
  const out = [];
  let prevBet = null;
  for (const s of signalHistory) {
    if (!s?.bet || s.bet === 'SKIP') continue;
    if (s.bet === prevBet) continue;
    out.push(s);
    prevBet = s.bet;
  }
  return out;
}

function firstSignalOnly(signalHistory) {
  if (!Array.isArray(signalHistory) || signalHistory.length === 0) return [];
  const first = signalHistory.find((s) => s?.bet && s.bet !== 'SKIP');
  return first ? [first] : [];
}

async function checkSingleResult(page, entry) {
  const url = entry.mobileUrl || entry.desktopUrl;
  if (!url) return null;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    return await page.evaluate(() => {
      const bodyText = (document.body && document.body.innerText) || '';
      // AET = After Extra Time, AP = After Penalties (ua: після дод. часу / після пен.)
      const hadExtraTime = /\bAET\b|\bAP\b|після дод\.?\s*час|after extra time/i.test(bodyText);

      // Sum goals from section headers (wclHeaderSection--summary) by section index.
      // FlashScore shows sections in order: 1-й тайм, 2-й тайм, [ET 1-й тайм, ET 2-й тайм].
      // Regular time = first two sections. Score format inside section: "0 - 1" (home - away).
      function extractSectionScore(section) {
        const spans = section.querySelectorAll('span');
        for (const span of spans) {
          const div = span.querySelector('div');
          if (!div) continue;
          const m = div.textContent.trim().match(/^(\d+)\s*-\s*(\d+)$/);
          if (m) return { home: Number(m[1]), away: Number(m[2]) };
        }
        return null;
      }

      function getRegularTimeGoalsFromSections() {
        const sections = document.querySelectorAll('.wclHeaderSection--summary');
        if (sections.length < 2) return null;
        // Only the first two sections belong to regular time (1-й тайм + 2-й тайм)
        const half1 = extractSectionScore(sections[0]);
        const half2 = extractSectionScore(sections[1]);
        if (!half1 || !half2) return null;
        return half1.home + half1.away + half2.home + half2.away;
      }

      // Fallback: base minute only (before "+") — goals at base ≤ 90 are regular-time
      function parseBaseMinute(text) {
        const m = String(text || '').match(/(\d{1,3})(?:\+\d+)?/);
        return m ? Number(m[1]) : null;
      }

      function countGoalsByBaseMinute(maxBase) {
        const incidents = document.querySelectorAll('.incident.soccer, div.incident.soccer');
        if (!incidents.length) return null;
        let count = 0;
        incidents.forEach((row) => {
          const icon = row.querySelector('p.i-field.icon');
          if (!icon || !icon.classList.contains('ball')) return;
          const timeEl = row.querySelector('p.i-field.time, p.i-field.time-wide');
          if (!timeEl) return;
          const base = parseBaseMinute(timeEl.textContent);
          if (base !== null && base <= maxBase) count++;
        });
        return count;
      }

      let score = null;
      const detailBold = document.querySelector('div.detail > b');
      if (detailBold) {
        const m = detailBold.textContent.trim().match(/^(\d+):(\d+)/);
        if (m) score = { home: Number(m[1]), away: Number(m[2]) };
      }
      if (!score) {
        const liveLink = document.querySelector('a.live[href]');
        if (liveLink) {
          const m = liveLink.textContent.trim().match(/(\d+):(\d+)/);
          if (m) score = { home: Number(m[1]), away: Number(m[2]) };
        }
      }
      if (!score) {
        const title = document.title || '';
        const tm = title.match(/(\d+)\s*[-–:]\s*(\d+)/);
        if (tm) score = { home: Number(tm[1]), away: Number(tm[2]) };
      }

      if (score && hadExtraTime) {
        // Prefer section-based approach (1-й тайм + 2-й тайм headers), fall back to incident counting
        const regularTimeGoals =
          getRegularTimeGoalsFromSections() ?? countGoalsByBaseMinute(90);
        return { ...score, hadExtraTime: true, regularTimeGoals };
      }

      return score;
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
    if (payload.hadExtraTime) m.hadExtraTime = true;
    if (payload.regularTimeGoals !== undefined) m.regularTimeGoals = payload.regularTimeGoals;
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
    console.log(`  [result] No unchecked predictions for ${dateKeyLocal(dateRef)}`);
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

    // ET matches: evaluate bet on regular time only (base minute ≤ 90)
    let totalGoals;
    let scoreLabel;
    let hadExtraTime = false;
    let regularTimeGoals;

    if (finalScore.hadExtraTime && finalScore.regularTimeGoals !== null && finalScore.regularTimeGoals !== undefined) {
      hadExtraTime = true;
      regularTimeGoals = finalScore.regularTimeGoals;
      totalGoals = regularTimeGoals;
      scoreLabel = `${finalScore.home}:${finalScore.away} (ДЧ, осн.час: ${totalGoals} г.)`;
    } else {
      totalGoals = finalScore.home + finalScore.away;
      scoreLabel = `${finalScore.home}:${finalScore.away}`;
      if (finalScore.hadExtraTime) {
        hadExtraTime = true;
        scoreLabel += ' (ДЧ, голи не визначено)';
      }
    }

    const actualOver = totalGoals > 0;
    const legs = betLegsFromEntry(entry);
    const hitLegs = legs.map((bet) => ({
      bet,
      hit: actualOver === (bet === 'OVER_0_5'),
    }));
    const hit = hitLegs.length ? hitLegs[hitLegs.length - 1].hit : false;

    const actualResult = `${finalScore.home}:${finalScore.away}`;
    applyResultToAllRows(matches, entry.matchId, {
      actualResult,
      hit,
      hitLegs,
      hadExtraTime: hadExtraTime || undefined,
      regularTimeGoals: regularTimeGoals !== undefined ? regularTimeGoals : undefined,
    });

    const legStr = hitLegs.map((l) => `${l.bet === 'OVER_0_5' ? 'ТБ' : 'ТМ'}:${l.hit ? '✅' : '❌'}`).join(' ');
    const mark = hit ? '✅' : '❌';
    console.log(`  [result] ${entry.home} - ${entry.away}: ${scoreLabel} → ${mark} остання нога | ${legStr}`);

    checked++;
    if (hit === true) hits++;
    else if (hit === false) misses++;
  }

  saveDayMatches(dateRef, matches);
  return buildSummary(matches, dateRef, checked, hits, misses);
}

// For ET matches prefers regularTimeGoals over full-time total
function getEffectiveGoals(entry) {
  if (entry && entry.regularTimeGoals !== null && entry.regularTimeGoals !== undefined) {
    return entry.regularTimeGoals;
  }
  return parseActualGoals(entry && entry.actualResult);
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

function normalizePeriod(timeWindow) {
  if (timeWindow === '60-70' || timeWindow === '70-80' || timeWindow === '80-90+') return timeWindow;
  return 'other';
}

function getStakeOdds(signal) {
  const period = normalizePeriod(signal?.timeWindow);
  if (period === '60-70' && signal?.bet === 'UNDER_0_5') return STAKE_ROI_MODEL.oddsByPeriod.tm_60_70;
  if (period === '70-80' && (signal?.bet === 'UNDER_0_5' || signal?.bet === 'OVER_0_5')) {
    return STAKE_ROI_MODEL.oddsByPeriod.tm_or_tb_70_80;
  }
  if (period === '80-90+' && signal?.bet === 'OVER_0_5') return STAKE_ROI_MODEL.oddsByPeriod.tb_80_90;
  return null;
}

function emptyBucket() {
  return { total: 0, checked: 0, wins: 0, losses: 0, pending: 0, turnover: 0, profit: 0, roi: null, hitRate: null };
}

function finalizeBucket(bucket) {
  const checked = bucket.wins + bucket.losses;
  bucket.hitRate = checked > 0 ? Number((bucket.wins / checked).toFixed(3)) : null;
  bucket.roi = bucket.turnover > 0 ? Number((bucket.profit / bucket.turnover).toFixed(3)) : null;
  return bucket;
}

function calcScenario(stakeRows) {
  const out = {
    bets: 0,
    checked: 0,
    wins: 0,
    losses: 0,
    pending: 0,
    turnover: 0,
    profit: 0,
    roi: null,
    hitRate: null,
  };
  for (const row of stakeRows) {
    out.bets += 1;
    if (row.resolved) out.checked += 1;
    else out.pending += 1;
    if (row.hit === true) out.wins += 1;
    if (row.hit === false) out.losses += 1;
    out.turnover += row.stake;
    out.profit += row.profit;
  }
  out.hitRate = out.checked > 0 ? Number((out.wins / out.checked).toFixed(3)) : null;
  out.roi = out.turnover > 0 ? Number((out.profit / out.turnover).toFixed(3)) : null;
  return out;
}

function buildStakeRoiReport(matches, dateRef) {
  const unique = dedupeByMatchId(matches);
  const predictionMatches = unique.filter(isTelegramPrediction);
  const byPeriod = {
    '60-70': emptyBucket(),
    '70-80': emptyBucket(),
    '80-90+': emptyBucket(),
    other: emptyBucket(),
  };
  const byBetType = {
    UNDER_0_5: emptyBucket(),
    OVER_0_5: emptyBucket(),
  };

  const allStakeRows = [];
  const noFlipsStakeRows = [];
  const matchesSummary = [];

  for (const m of predictionMatches) {
    const teams = sanitizeTeams(m.home, m.away);
    const rawSignals = signalHistoryFromEntry(m);
    const stakeSignals = collapseSignalsByFlip(rawSignals);
    const firstOnlySignals = firstSignalOnly(stakeSignals);
    const totalGoals = getEffectiveGoals(m);

    const matchRows = stakeSignals.map((signal, idx) => {
      const period = normalizePeriod(signal.timeWindow);
      const odds = getStakeOdds(signal);
      const resolved = totalGoals !== null;
      const hit = resolved ? (totalGoals > 0) === (signal.bet === 'OVER_0_5') : null;
      const stake = STAKE_ROI_MODEL.stakePerBet;
      const profit = resolved && odds != null ? (hit ? stake * (odds - 1) : -stake) : 0;
      return {
        matchId: m.matchId,
        order: idx + 1,
        period,
        bet: signal.bet,
        odds,
        stake,
        resolved,
        hit,
        profit,
      };
    });

    const matchNoFlipRows = firstOnlySignals.map((signal) => {
      const period = normalizePeriod(signal.timeWindow);
      const odds = getStakeOdds(signal);
      const resolved = totalGoals !== null;
      const hit = resolved ? (totalGoals > 0) === (signal.bet === 'OVER_0_5') : null;
      const stake = STAKE_ROI_MODEL.stakePerBet;
      const profit = resolved && odds != null ? (hit ? stake * (odds - 1) : -stake) : 0;
      return {
        matchId: m.matchId,
        period,
        bet: signal.bet,
        odds,
        stake,
        resolved,
        hit,
        profit,
      };
    });

    for (const row of matchRows) {
      allStakeRows.push(row);
      const periodBucket = byPeriod[row.period] || byPeriod.other;
      periodBucket.total += 1;
      periodBucket.turnover += row.stake;
      periodBucket.profit += row.profit;
      if (!row.resolved) periodBucket.pending += 1;
      else if (row.hit === true) {
        periodBucket.checked += 1;
        periodBucket.wins += 1;
      } else if (row.hit === false) {
        periodBucket.checked += 1;
        periodBucket.losses += 1;
      }

      const typeBucket = byBetType[row.bet];
      if (typeBucket) {
        typeBucket.total += 1;
        typeBucket.turnover += row.stake;
        typeBucket.profit += row.profit;
        if (!row.resolved) typeBucket.pending += 1;
        else if (row.hit === true) {
          typeBucket.checked += 1;
          typeBucket.wins += 1;
        } else if (row.hit === false) {
          typeBucket.checked += 1;
          typeBucket.losses += 1;
        }
      }
    }

    noFlipsStakeRows.push(...matchNoFlipRows);

    matchesSummary.push({
      matchId: m.matchId,
      league: sanitizeLeagueName(m.league),
      home: teams.home,
      away: teams.away,
      finalResult: m.actualResult ?? null,
      totalGoals,
      uniqueSignals: matchRows.map((row) => ({
        order: row.order,
        period: row.period,
        bet: formatBetLabel(row.bet),
        hit: row.hit,
      })),
      wins: matchRows.filter((row) => row.hit === true).length,
      losses: matchRows.filter((row) => row.hit === false).length,
      pending: matchRows.filter((row) => row.hit === null).length,
    });
  }

  for (const key of Object.keys(byPeriod)) finalizeBucket(byPeriod[key]);
  for (const key of Object.keys(byBetType)) finalizeBucket(byBetType[key]);

  const overall = calcScenario(allStakeRows);
  const noFlipsScenario = calcScenario(noFlipsStakeRows);

  return {
    date: dateKeyLocal(dateRef),
    generatedAt: toISO(),
    rules: {
      uniqueSignalRule: 'Однаковий напрям ставки не дублюється; нова ставка тільки при зміні вектору.',
      settlementRule: 'Результат ставки визначається за фінальним тоталом матчу (>0 = ТБ, 0 = ТМ).',
    },
    model: STAKE_ROI_MODEL,
    overall: {
      ...overall,
      bankStart: STAKE_ROI_MODEL.bankStart,
      bankEnd: Number((STAKE_ROI_MODEL.bankStart + overall.profit).toFixed(2)),
    },
    byPeriod,
    byBetType,
    noFlipsScenario: {
      ...noFlipsScenario,
      bankStart: STAKE_ROI_MODEL.bankStart,
      bankEnd: Number((STAKE_ROI_MODEL.bankStart + noFlipsScenario.profit).toFixed(2)),
    },
    matches: matchesSummary,
  };
}

function isTelegramPrediction(entry) {
  return Boolean(
    entry &&
    entry.pipeline === 'decision_made' &&
    entry.prediction?.bet &&
    entry.prediction.bet !== 'SKIP' &&
    (entry.telegramInitialSent === true || entry.prediction?.signalEligible === true)
  );
}

function buildPredictionsFile(matches, dateRef) {
  const unique = dedupeByMatchId(matches);
  const predictionMatches = unique.filter(isTelegramPrediction);
  const windowKeys = ['60-70', '70-80', '80-90+', 'other'];
  const byWindow = Object.fromEntries(
    windowKeys.map((w) => [w, { total: 0, checked: 0, hits: 0, misses: 0, hitRate: null }])
  );

  const items = predictionMatches.map((m) => {
    const teams = sanitizeTeams(m.home, m.away);
    const rawSignals = signalHistoryFromEntry(m);
    const stakeSignals = collapseSignalsByFlip(rawSignals);
    const totalGoals = getEffectiveGoals(m);

    const periodPredictions = stakeSignals.map((s) => {
      const resolved = m.resultChecked === true && totalGoals !== null;
      const hit = resolved ? (totalGoals > 0) === (s.bet === 'OVER_0_5') : null;
      const key = windowKeys.includes(s.timeWindow) ? s.timeWindow : 'other';
      byWindow[key].total += 1;
      if (hit === true) {
        byWindow[key].checked += 1;
        byWindow[key].hits += 1;
      } else if (hit === false) {
        byWindow[key].checked += 1;
        byWindow[key].misses += 1;
      }
      return {
        period: s.timeWindow || 'unknown',
        minute: s.minute,
        snapshots: s.snapshotCount ?? m.modelV2?.snapshotHistoryUsed ?? null,
        bet: formatBetLabel(s.bet),
        confidence: s.confidence,
        pGoal: s.pGoal,
        pDry: s.pDry,
        signalQuality: s.signalQuality,
        timestamp: s.timestamp,
        hit,
      };
    });

    const wins = periodPredictions.filter((s) => s.hit === true).length;
    const losses = periodPredictions.filter((s) => s.hit === false).length;
    const resolvedCount = wins + losses;

    return {
      matchId: m.matchId,
      league: sanitizeLeagueName(m.league),
      home: teams.home,
      away: teams.away,
      periods: periodPredictions,
      finalResult: {
        resultChecked: m.resultChecked === true,
        actualResult: m.actualResult ?? null,
        totalGoals,
      },
      predictionOutcome: {
        stakesTotal: periodPredictions.length,
        stakesResolved: resolvedCount,
        wins,
        losses,
        hitRate: resolvedCount > 0 ? Number((wins / resolvedCount).toFixed(3)) : null,
      },
      keyMetrics: {
        statsStatus: m.statsStatus ?? null,
        currentState: m.modelV2?.currentState ?? null,
        dominanceStrength: m.modelV2?.dominanceStrength ?? null,
        latestSignalQuality: m.prediction?.signalQuality ?? null,
      },
    };
  });

  for (const key of windowKeys) {
    const row = byWindow[key];
    row.hitRate = row.checked > 0 ? Number((row.hits / row.checked).toFixed(3)) : null;
  }

  const totals = items.reduce(
    (acc, item) => {
      acc.matches += 1;
      acc.stakes += item.predictionOutcome.stakesTotal;
      acc.stakesResolved += item.predictionOutcome.stakesResolved;
      acc.wins += item.predictionOutcome.wins;
      acc.losses += item.predictionOutcome.losses;
      return acc;
    },
    { matches: 0, stakes: 0, stakesResolved: 0, wins: 0, losses: 0 }
  );
  totals.hitRate = totals.stakesResolved > 0 ? Number((totals.wins / totals.stakesResolved).toFixed(3)) : null;

  return {
    date: dateKeyLocal(dateRef),
    generatedAt: toISO(),
    source: 'telegram_signal_predictions_compact',
    totals,
    periodSummary: byWindow,
    matches: items,
  };
}

function resolvedLegsForMatch(m) {
  if (!m.resultChecked) return [];
  if (m.hitLegs && m.hitLegs.length > 0) return m.hitLegs;

  const legs = betLegsFromEntry(m);
  const totalGoals = getEffectiveGoals(m);
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
    date: dateKeyLocal(dateRef),
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

  if (persist) {
    saveDaySummary(dateRef, summary);
    saveDayPredictions(dateRef, buildPredictionsFile(matches, dateRef));
    saveDayStakeRoi(dateRef, buildStakeRoiReport(matches, dateRef));
  }
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
  getEffectiveGoals,
};
