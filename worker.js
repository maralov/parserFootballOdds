require('dotenv').config();

const { parentPort, workerData } = require('worker_threads');
const { launchBrowser } = require('./src/browser');
const scrapeLiveMatches = require('./src/scrapeLiveMatches');
const { resolveDesktopUrl, scrapeDesktopStats, checkMatchResult } = require('./src/scrapeDesktopStats');
const { buildFeatures } = require('./src/pipeline/featureBuilder');
const { evaluateLiveModelV2 } = require('./src/pipeline/liveModelV2');
const { evaluateLiveModelV3 } = require('./src/pipeline/liveModelV3');
const { applyLiveModelGates } = require('./src/pipeline/liveModelGates');
const { fetchOdds1X2 } = require('./src/scrapeLiveOdds');
const { scrapeMatchIncidents } = require('./src/scrapeMatchIncidents');
const { createRunContext } = require('./src/pipeline/contracts');
const { appendMatchEntry, createMatchLogEntry, updateMatchResult, markTelegramInitialSent } = require('./src/pipeline/dailyLogger');
const { checkYesterdayResults } = require('./src/pipeline/resultChecker');
const { loadDayMatches } = require('./src/pipeline/dailyLogger');
const sendTelegramMessage = require('./src/helpers/utils/sendTelegramMessage');
const { formatTelegramMessage } = require('./src/helpers/utils/formatTelegramMessage');
const { sanitizeLeagueName, sanitizeTeams, formatBetLabel } = require('./src/helpers/utils/normalizeMatchText');
const {
  USER_AGENT,
  STATS_CONCURRENCY,
  MAX_TELEGRAM_MINUTE,
  isWithinWorkingHours,
  LIVE_SNAPSHOT_MIN_MINUTE,
  LIVE_SNAPSHOT_SECOND_PASS_MS,
  LIVE_DECISION_WINDOW_START_MINUTE,
  LIVE_V2_UNDER_CONFIRM_SNAPSHOTS,
  LIVE_FORM_H2H_ENABLED,
  LIVE_EVAL_MODEL,
} = require('./src/helpers/constants');
const { scrapeMatchFormAndH2h } = require('./src/scrapeMatchFormAndH2h');
const { getTelegramMarkdownPrefix } = require('./src/helpers/telegramModelTag');

const evaluateLiveModel = LIVE_EVAL_MODEL === 'v3' ? evaluateLiveModelV3 : evaluateLiveModelV2;
const { appendSnapshot, pruneSnapshotStore, seedSnapshots } = require('./src/pipeline/matchSnapshotStore');
const { dayjs } = require('./src/helpers/date');

const processedMatchIds = workerData?.processedMatchIds
  ? new Set(workerData.processedMatchIds)
  : new Set();

const sentTelegramIds = workerData?.sentTelegramIds
  ? new Set(workerData.sentTelegramIds)
  : new Set();

const activePredictions = workerData?.activePredictions
  ? new Map(workerData.activePredictions)
  : new Map();

/** Історія зрізів raw2H на матч (відновлюється з snapshotHistoryV2 у лозі кожного циклу воркера). */
const matchSnapshotStore = new Map();
/** Останній currentState моделі v2 для зміни сценарію між тиками. */
const lastModelStateByMatchId = new Map();
/** Кеш форми/H2H з ?t=h2h (один запис на matchId за цикл життя воркера). */
const formH2hCache = new Map();

// Відновлення снэпшотів і стану v2 з лога + при першому проході — TG / predictions
try {
  const todayEntries = loadDayMatches();
  for (const m of todayEntries) {
    if (m.matchId && Array.isArray(m.snapshotHistoryV2) && m.snapshotHistoryV2.length > 0) {
      seedSnapshots(matchSnapshotStore, m.matchId, m.snapshotHistoryV2);
    }
    if (m.matchId && m.modelV2 && m.modelV2.currentState != null) {
      lastModelStateByMatchId.set(m.matchId, m.modelV2.currentState);
    }
    if (LIVE_EVAL_MODEL === 'v3' && m.matchId && m.preMatchV3 !== undefined) {
      formH2hCache.set(m.matchId, m.preMatchV3);
    }
  }
} catch (e) {
  console.log(`  [restore] snapshot/modelV2: ${e.message}`);
}

if (sentTelegramIds.size === 0 && processedMatchIds.size === 0) {
  try {
    const todayEntries = loadDayMatches();
    for (const m of todayEntries) {
      // Відновлюємо матчі що вже були оброблені (без статистики або перманентний скіп)
      if (m.pipeline === 'no_decision_data' || m.pipeline === 'resolve_failed') {
        processedMatchIds.add(m.matchId);
      }
      if (
        m.telegramInitialSent === true ||
        (m.prediction?.signalEligible === true && m.prediction?.bet && m.prediction.bet !== 'SKIP')
      ) {
        sentTelegramIds.add(m.matchId);
      }
      if (m.prediction?.bet && m.prediction.bet !== 'SKIP' && !m.resultChecked) {
        activePredictions.set(m.matchId, {
          bet: m.prediction.bet,
          confidence: m.prediction.confidence,
          desktopUrl: m.desktopUrl,
          mobileUrl: m.mobileUrl,
          home: m.home,
          away: m.away,
          league: m.league,
          betHistory: Array.isArray(m.betHistory) && m.betHistory.length > 0
            ? m.betHistory.map((h) => ({ bet: h.bet, timeWindow: h.timeWindow, minute: h.minute, filtersApplied: h.filtersApplied || '' }))
            : [{ bet: m.prediction.bet, timeWindow: m.prediction.timeWindow, minute: m.minute, filtersApplied: '' }],
        });
      }
    }
    if (sentTelegramIds.size > 0 || processedMatchIds.size > 0) {
      console.log(`  [restore] Відновлено з лога: ${processedMatchIds.size} оброблених, ${sentTelegramIds.size} надісланих TG, ${activePredictions.size} активних ставок`);
    }
  } catch (e) {
    console.log(`  [restore] Помилка відновлення стану: ${e.message}`);
  }
}

let lastResultCheckHour = workerData?.lastResultCheckHour ?? -1;

async function mapWithConcurrency(items, limit, fn) {
  const result = [];
  let idx = 0;
  async function w() { while (idx < items.length) { const i = idx++; result[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => w()));
  return result;
}

function slimPreMatchForLog(ctx) {
  if (!ctx) return null;
  return {
    parseOk: ctx.parseOk,
    error: ctx.error || null,
    fetchedAt: ctx.fetchedAt || null,
    aggregates: ctx.aggregates || null,
    counts: {
      formHome: ctx.formHome?.length ?? 0,
      formAway: ctx.formAway?.length ?? 0,
      h2h: ctx.h2hMutual?.length ?? 0,
    },
  };
}

function collapseBetHistoryForResult(betHistory = [], fallbackBet = null) {
  const src = Array.isArray(betHistory) && betHistory.length > 0
    ? betHistory
    : (fallbackBet ? [{ bet: fallbackBet, timeWindow: null, minute: null }] : []);

  const out = [];
  let prevBet = null;
  for (const h of src) {
    const bet = h?.bet;
    if (!bet || bet === 'SKIP') continue;
    if (bet === prevBet) continue;
    out.push({ bet, timeWindow: h.timeWindow || 'unknown', minute: h.minute ?? null });
    prevBet = bet;
  }
  return out;
}

(async () => {
  const runCtx = createRunContext();
  const now = dayjs();
  console.log(`[${now.format('HH:mm:ss')}] Live scan`);

  const hr = now.hour();
  const isFirstRun = lastResultCheckHour === -1;
  const needResultCheck = (hr === 10 && lastResultCheckHour !== 10) || isFirstRun;

  // Фаза A: перевірка «вчора» + усі ранкові Telegram (підсумок + аналіз ніг/P&L). Live-скрапінг — лише після цього.
  if (needResultCheck) {
    console.log(`  ${isFirstRun ? 'First run' : '10:00'} — checking yesterday results`);
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    try {
      const summary = await checkYesterdayResults(page);
      if (summary) {
        const r = summary.resolved ?? (summary.hits + summary.misses);
        console.log(`  Yesterday: ${summary.hits}/${r} hits (${summary.actionable} з прогнозом)`);
        console.log(`  Daily summary Telegram disabled (date=${summary.date})`);
      }
      lastResultCheckHour = hr;
    } catch (e) { console.log(`  Result check err: ${e.message}`); }
    await browser.close();
  }

  if (!isWithinWorkingHours()) {
    console.log(`  Outside working hours → skip`);
    parentPort.postMessage({ runId: runCtx.runId, matchesAnalyzed: 0, signalsSent: 0, processedMatchIds: Array.from(processedMatchIds), sentTelegramIds: Array.from(sentTelegramIds), activePredictions: Array.from(activePredictions.entries()), lastResultCheckHour, skipped: 'outside_hours' });
    return;
  }

  console.log('  Запуск live-скрапера (після ранкових Telegram, якщо були).');
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  const allMatches = await scrapeLiveMatches(page);
  const newMatches = allMatches.filter((m) => !processedMatchIds.has(m.id));

  console.log(`  Found: ${allMatches.length} candidates, ${newMatches.length} new, ${processedMatchIds.size} permanently skipped`);

  const results = [];

  await mapWithConcurrency(newMatches, STATS_CONCURRENCY, async (match) => {
    const tag = `${match.home} - ${match.away} (${match.minute}')`;
    console.log(`\n→ ${tag} [${match.league}]`);

    const logCandidate = createMatchLogEntry(match, null, null, null, {
      pipeline: 'candidate_found',
      feed: match.feed,
      feedUrl: match.feedUrl,
    });
    appendMatchEntry(logCandidate);

    const statPage = await browser.newPage();
    await statPage.setUserAgent(USER_AGENT);

    try {
      const { odds1X2 } = await fetchOdds1X2(statPage, match.matchDetailsUrl);
      if (odds1X2) {
        console.log(`  Кф 1X2: ${odds1X2.home} / ${odds1X2.draw} / ${odds1X2.away}`);
      } else {
        console.log(`  Кф 1X2: немає на сторінці огляду`);
      }

      const { desktopUrl, resolved } = await resolveDesktopUrl(statPage, match.id);
      if (!resolved || !desktopUrl) {
        console.log(`  ✗ Desktop URL resolve failed → permanent skip`);
        appendMatchEntry({ ...logCandidate, pipeline: 'resolve_failed' });
        processedMatchIds.add(match.id);
        return;
      }
      console.log(`  Desktop: ${desktopUrl}`);

      const statsResult = await scrapeDesktopStats(statPage, desktopUrl, match.id);
      let incidents = await scrapeMatchIncidents(statPage, match.id);

      let preMatchContext = null;
      if (LIVE_FORM_H2H_ENABLED && LIVE_EVAL_MODEL === 'v3') {
        if (formH2hCache.has(match.id)) {
          preMatchContext = formH2hCache.get(match.id);
        } else if (match.minute >= LIVE_DECISION_WINDOW_START_MINUTE) {
          preMatchContext = await scrapeMatchFormAndH2h(statPage, match.id, {
            home: match.home,
            away: match.away,
          });
          formH2hCache.set(match.id, preMatchContext);
        }
      }

      let features = {
        ...buildFeatures(match, statsResult),
        odds1X2: odds1X2 || null,
        redCards: incidents,
      };
      let history = [];
      let liveTrajectory = null;
      if (match.minute >= LIVE_SNAPSHOT_MIN_MINUTE && features.raw2H) {
        let snap = appendSnapshot(matchSnapshotStore, match.id, {
          matchMinute: match.minute,
          score: match.score,
          raw2H: features.raw2H,
          redCards: incidents,
        });
        history = snap.history;
        liveTrajectory = snap.liveTrajectory;
        features.liveTrajectory = liveTrajectory;

        const secondPassMs = LIVE_SNAPSHOT_SECOND_PASS_MS;
        if (
          secondPassMs > 0 &&
          match.minute >= LIVE_DECISION_WINDOW_START_MINUTE &&
          history.length < LIVE_V2_UNDER_CONFIRM_SNAPSHOTS
        ) {
          console.log(
            `  ⏳ Другий зріз у циклі: пауза ${secondPassMs / 1000}s (зараз зрізів ${history.length}/${LIVE_V2_UNDER_CONFIRM_SNAPSHOTS})…`
          );
          await new Promise((r) => setTimeout(r, secondPassMs));
          const statsResult2 = await scrapeDesktopStats(statPage, desktopUrl, match.id);
          incidents = await scrapeMatchIncidents(statPage, match.id);
          features = {
            ...buildFeatures(match, statsResult2),
            odds1X2: odds1X2 || null,
            redCards: incidents,
          };
          if (features.raw2H) {
            const snap2 = appendSnapshot(matchSnapshotStore, match.id, {
              matchMinute: match.minute,
              score: match.score,
              raw2H: features.raw2H,
              redCards: incidents,
            });
            history = snap2.history;
            liveTrajectory = snap2.liveTrajectory;
            features.liveTrajectory = liveTrajectory;
          }
        }
      } else {
        features.liveTrajectory = null;
      }
      const rcLog = incidents && (incidents.homeRedCards + incidents.awayRedCards) > 0
        ? ` | redCards=${incidents.homeRedCards}H+${incidents.awayRedCards}A` : '';
      console.log(`  Features: quality=${features.dataQualityScore}, primary=${features.availablePrimary}, status=${features.statsStatus}${rcLog}`);

      if (!features.allowDecision) {
        const isNoStats = features.statsStatus === 'unavailable';
        const skipReason = isNoStats ? 'no_stats' : 'insufficient_metrics';
        appendMatchEntry(createMatchLogEntry(match, features, null, null, {
          desktopUrl,
          pipeline: 'no_decision_data',
          feed: match.feed,
          feedUrl: match.feedUrl,
          skipReason,
        }));
        if (isNoStats) {
          processedMatchIds.add(match.id);
          console.log(`  ✗ No stats at all → permanent skip`);
        } else {
          console.log(`  ✗ Insufficient metrics (primary=${features.availablePrimary}) — will retry`);
        }
        return;
      }

      if (match.minute < LIVE_DECISION_WINDOW_START_MINUTE) {
        console.log(
          `  ⏳ До вікна рішень (${LIVE_DECISION_WINDOW_START_MINUTE}′): зрізів=${history.length}, хв=${match.minute} — без моделі`
        );
        appendMatchEntry(
          createMatchLogEntry(match, features, null, null, {
            desktopUrl,
            pipeline: 'snapshot_warmup',
            feed: match.feed,
            feedUrl: match.feedUrl,
            skipReason: 'before_decision_window',
            snapshotHistoryV2: history.length ? history : null,
          })
        );
        return;
      }

      const prevBet = activePredictions.get(match.id)?.bet ?? null;
      const previousState = lastModelStateByMatchId.get(match.id) ?? null;
      const { modelV2, decision: rawDecision, scoredSummary } = evaluateLiveModel({
        match,
        features,
        odds1X2: odds1X2 || null,
        incidents,
        history,
        secondHalfSides: statsResult.secondHalf,
        previousState,
        prevBet,
        liveTrajectory,
        preMatchContext,
      });
      lastModelStateByMatchId.set(match.id, modelV2.currentState);

      const decision = applyLiveModelGates(features, rawDecision);
      const lt = features.liveTrajectory;
      const deltaLine =
        lt && lt.snapshotCount >= 2 && lt.deltas
          ? ` | Δ2H SOT=${lt.deltas.shotsOnTarget ?? '—'} xG=${lt.deltas.expectedGoalsXg ?? '—'} (Δ${lt.deltaMatchMinutes ?? '—'}′ матчу)`
          : '';
      console.log(
        `  Model v2: pGoal=${decision.pGoal}, pDry=${decision.pDry} sq=${decision.signalQuality ?? '—'} state=${modelV2.currentState} | ${decision.timeWindow} → ${decision.bet}` +
        deltaLine +
        (decision.signalEligible ? ' [TG]' : '')
      );

      const logEntry = createMatchLogEntry(match, features, scoredSummary, decision, {
        desktopUrl,
        pipeline: 'decision_made',
        feed: match.feed,
        feedUrl: match.feedUrl,
        skipReason: decision.bet === 'SKIP' ? 'v2_wait_or_skip' : null,
        modelV2,
        snapshotHistoryV2: history,
        preMatchV3: slimPreMatchForLog(preMatchContext),
      });
      appendMatchEntry(logEntry);

      let telegramSent = false;

      if (decision.bet !== 'SKIP') {
        const prev = activePredictions.get(match.id);
        const betChanged = prev && prev.bet !== decision.bet;

        const prevHist = prev?.betHistory && prev.betHistory.length > 0
          ? [...prev.betHistory]
          : (prev?.bet ? [{ bet: prev.bet, timeWindow: prev.timeWindow, minute: prev.minute }] : []);
        let betHistory = prevHist;
        if (decision.bet !== 'SKIP') {
          const last = betHistory[betHistory.length - 1];
          if (!last || last.bet !== decision.bet || last.timeWindow !== decision.timeWindow) {
            betHistory = [...betHistory, { bet: decision.bet, timeWindow: decision.timeWindow, minute: match.minute, filtersApplied: decision.filtersApplied || '' }];
          }
        }

        activePredictions.set(match.id, {
          bet: decision.bet,
          confidence: decision.confidence,
          desktopUrl,
          mobileUrl: match.matchDetailsUrl,
          home: match.home,
          away: match.away,
          league: match.league,
          betHistory,
        });

        const matchUrl = desktopUrl || `https://m.flashscore.ua/match/${match.id}/`;

        const alreadySentTg = sentTelegramIds.has(match.id);
        const canPush = decision.signalEligible && match.minute <= MAX_TELEGRAM_MINUTE;
        const isNewSignal = !alreadySentTg && canPush;
        const isFlipToOver = betChanged && prev?.bet === 'UNDER_0_5' && decision.bet === 'OVER_0_5';
        const isUpdate = alreadySentTg && canPush && (betChanged);

        if (isNewSignal) {
          try {
            await sendTelegramMessage(formatTelegramMessage(match, decision, desktopUrl, { redCards: incidents, modelV2 }));
            sentTelegramIds.add(match.id);
            markTelegramInitialSent(match.id);
            telegramSent = true;
            console.log(`  ✓ Telegram sent`);
          } catch (e) { console.log(`  Telegram err: ${e.message}`); }
        } else if (isUpdate) {
          const cleanLeague = sanitizeLeagueName(match.league);
          const { home: cleanHome, away: cleanAway } = sanitizeTeams(match.home, match.away);
          const changeLabel = isFlipToOver
            ? '🔀 Фліп ТМ→ТБ (оновлення сценарію)'
            : (betChanged ? `📊 Прогноз → ${decision.bet === 'OVER_0_5' ? 'ТБ 0,5' : 'ТМ 0,5'}` : `📶 Впевненість → ${decision.confidence}`);
          try {
            const flipMsg =
              `${getTelegramMarkdownPrefix()}` +
              `🔄 *Оновлення (${match.minute}')* — ${decision.timeWindow}\n` +
              `🏆 ${cleanLeague}\n` +
              `⚽ ${cleanHome} - ${cleanAway}\n` +
              `${changeLabel}\n` +
              `🎯 P(гол): ${decision.pGoal} | P(сухий): ${decision.pDry}${decision.signalQuality != null ? ` | SQ: ${decision.signalQuality}` : ''}\n` +
              `📝 ${decision.reason}\n\n` +
              `🔗 [Flashscore](${matchUrl})`;
            await sendTelegramMessage(flipMsg);
            telegramSent = true;
            console.log(`  ✓ Telegram update sent (${changeLabel})`);
          } catch (e) { console.log(`  Telegram update err: ${e.message}`); }
        } else if (alreadySentTg) {
          console.log(`  ↻ Re-analysis done (no change)`);
        } else if (!decision.signalEligible) {
          console.log(`  ⏸ сигнал не пройшов (вікно ${decision.timeWindow}, впевненість: ${features.confidence}, bet: ${decision.bet})`);
        }
      }

      results.push({ match, decision, logEntry, telegramSent });
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
    } finally {
      await statPage.close();
    }
  });

  const actionable = results.filter((r) => r.decision.bet !== 'SKIP');
  const tgSent = results.filter((r) => r.telegramSent).length;
  console.log(`\nDone: ${results.length} analyzed, ${actionable.length} actionable, ${tgSent} TG sent`);

  const currentCandidateIds = new Set(allMatches.map((m) => m.id));
  pruneSnapshotStore(matchSnapshotStore, currentCandidateIds);

  // --- Check finished matches ---
  const maybeFinished = [...activePredictions.entries()].filter(([id]) => !currentCandidateIds.has(id));

  if (maybeFinished.length > 0) {
    console.log(`\n🔍 Checking ${maybeFinished.length} possibly finished match(es)...`);
    for (const [matchId, pred] of maybeFinished) {
      const rPage = await browser.newPage();
      await rPage.setUserAgent(USER_AGENT);
      try {
        const res = await checkMatchResult(rPage, matchId);
        const isResolved = res.finished || res.resolvedByGoal;
        if (isResolved && res.homeScore !== null) {
          const total = res.homeScore + res.awayScore;
          const actualOver = total > 0;
          const finalScore = { home: res.homeScore, away: res.awayScore };
          const statusLabel = res.finished ? 'FT' : `${res.homeScore}:${res.awayScore} (ще триває, гол вирішив)`;

          const stakeSignals = collapseBetHistoryForResult(pred.betHistory, pred.bet);
          const hitLegs = stakeSignals.map((signal) => ({
            bet: signal.bet,
            timeWindow: signal.timeWindow,
            hit: actualOver === (signal.bet === 'OVER_0_5'),
          }));
          const hit = hitLegs.length ? hitLegs[hitLegs.length - 1].hit : actualOver === (pred.bet === 'OVER_0_5');

          console.log(
            `  ⚽ ${pred.home} - ${pred.away}: ${res.homeScore}:${res.awayScore} ${res.finished ? '[FT]' : '[GOAL→resolved]'} → ` +
            hitLegs.map((l) => `${l.bet === 'OVER_0_5' ? 'ТБ' : 'ТМ'}:${l.hit ? '✅' : '❌'}`).join(' ')
          );
          updateMatchResult(matchId, finalScore, { hit, hitLegs });

          if (sentTelegramIds.has(matchId)) {
            const league = sanitizeLeagueName(pred.league);
            const { home, away } = sanitizeTeams(pred.home, pred.away);
            const suffix = res.finished
              ? `⚽ Рахунок: ${res.homeScore}:${res.awayScore} (FT)`
              : `⚽ Рахунок: ${res.homeScore}:${res.awayScore} — прогноз вирішено`;
            const wins = hitLegs.filter((l) => l.hit === true).length;
            const losses = hitLegs.filter((l) => l.hit === false).length;
            const resultEmoji = losses === 0 ? '✅' : wins === 0 ? '❌' : '⚠️';
            const lastSig = stakeSignals[stakeSignals.length - 1];
            const filtersLine = lastSig?.filtersApplied
              ? `\n🔍 *Фільтри:* ${lastSig.filtersApplied} [${lastSig.timeWindow || ''}]`
              : '';
            const resultUrl = pred.desktopUrl || pred.mobileUrl || `https://m.flashscore.ua/match/${matchId}/`;
            try {
              await sendTelegramMessage(
                `${getTelegramMarkdownPrefix()}` +
                `🏆 ${league}\n` +
                `⚽ ${home} - ${away}\n` +
                `${suffix}\n\n` +
                `📊 *Підсумок прогнозу:* ${resultEmoji}${filtersLine}\n\n` +
                `🔗 [Flashscore](${resultUrl})`
              );
              console.log(`  ✓ Telegram result sent (${statusLabel})`);
            } catch (e) { console.log(`  Telegram result err: ${e.message}`); }
          }

          activePredictions.delete(matchId);
        } else if (res.finished) {
          console.log(`  ⚽ ${pred.home} - ${pred.away}: FT but score not parsed`);
        } else {
          console.log(`  ⏳ ${pred.home} - ${pred.away}: still live 0:0`);
        }
      } catch (e) {
        console.log(`  ✗ Result check ${matchId}: ${e.message}`);
      } finally {
        await rPage.close();
      }
    }
  }

  if (activePredictions.size > 0) {
    console.log(`📌 Tracking ${activePredictions.size} active prediction(s)`);
  }

  await browser.close();

  parentPort.postMessage({
    runId: runCtx.runId,
    matchesAnalyzed: results.length,
    signalsSent: tgSent,
    processedMatchIds: Array.from(processedMatchIds),
    sentTelegramIds: Array.from(sentTelegramIds),
    activePredictions: Array.from(activePredictions.entries()),
    lastResultCheckHour,
  });
})();
