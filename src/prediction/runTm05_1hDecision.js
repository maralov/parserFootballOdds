'use strict';

const env = require('../config/env');
const logger = require('../observability/logger');
const matchStore = require('../store/matchStore');
const { computeDS1H } = require('../scoring/drynessScore1H');
const { passesFavoriteGate1H } = require('../scoring/favoriteGate1H');
const { dsToProbability1H } = require('./dsToProbability1H');
const { tm05_1hOddsAt } = require('../scoring/oddsTable');
const { evaluateEvGate } = require('./evGate');
const { isLockedPhase } = require('./lockPolicy');

/**
 * Re-read the live score from a cache-busted fetch of the match page. Used to
 * confirm the board is still 0:0 immediately before sending a signal, so a
 * stale 0:0 (live page lagging the real match) can't fire a doomed bet.
 *
 * @param {string} matchId
 * @returns {Promise<{scoreHome:number, scoreAway:number, minute:number|null}>}
 */
async function defaultConfirmLiveScore(matchId) {
  const { fetchResilient } = require('../fetcher/resilientFetcher');
  const { buildLiveStatsUrl, withCacheBuster } = require('../enrichment/helpers/urlBuilder');
  const { parseLiveHeader } = require('../tracker/parsers/liveHeaderParser');
  const { html } = await fetchResilient(withCacheBuster(buildLiveStatsUrl(matchId)));
  const h = parseLiveHeader(html);
  return { scoreHome: h.scoreHome, scoreAway: h.scoreAway, minute: h.minute };
}

/**
 * Decide on 1HUNDER (ТМ 0.5 першого тайму) in the 25–35' window.
 * No AI — probability comes from DS1H → dsToProbability1H. Idempotent via
 * predictions.tm05_1h (locked on terminal phases).
 *
 * @param {string} matchId
 * @param {Object} snapshot  the just-stored 1H snapshot (cumulative + ballPossession)
 * @param {Date}   [date]
 * @param {Object} [deps]
 * @returns {Promise<{status: string, ev?: number, gateReason?: string}>}
 */
async function runTm05_1hDecision(matchId, snapshot, date = new Date(), deps = {}) {
  const cfg = deps.env || env;
  const store = deps.matchStore || matchStore;
  const tgDispatcher = deps.tgDispatcher || null;
  const confirmLiveScore = deps.confirmLiveScore || defaultConfirmLiveScore;

  const match = store.getMatch(matchId, date);
  if (!match) return { status: 'no_match' };
  if (match.tracking?.status !== 'active') return { status: 'not_active' };
  if (isLockedPhase(match.predictions?.tm05_1h?.phase)) return { status: 'already_decided' };

  const minute = snapshot.observedMinute || snapshot.minute || cfg.LIVE_1H_DECISION_MIN;

  const ds = computeDS1H(match, snapshot);
  store.setTm05_1hDecision(matchId, {
    phase: 'ds_computed',
    dsScore: ds.score,
    dsComponents: ds.components,
    favorite: ds.favorite,
    decidedAt: new Date().toISOString(),
  }, date);

  // Favorite bet-gate: optionally exclude heavy and/or home favorites. This only
  // suppresses the SIGNAL — the match stays tracked and is resolved at HT, so the
  // dataset remains complete for offline analysis of every favorite.
  const favGate = passesFavoriteGate1H(match.odds, cfg);
  if (!favGate.pass) {
    store.setTm05_1hDecision(matchId, {
      phase: 'skipped_by_fav',
      dsScore: ds.score,
      decision: 'SKIP',
      favGateReason: favGate.reason,
      decidedAt: new Date().toISOString(),
    }, date);
    logger.info('runTm05_1hDecision: SKIP by favorite gate', {
      matchId, reason: favGate.reason, favOdd: favGate.favOdd, ds: ds.score, minute,
    });
    return { status: 'skipped_by_fav', dsScore: ds.score, gateReason: favGate.reason };
  }

  // DS-off mode: DS does NOT gate the bet (it is still computed & recorded for
  // analysis). We bet the whole favorite-band population and the EV gate is
  // bypassed below — used to collect a clean base-rate dataset.
  const dsOff = cfg.LIVE_1H_DISABLE_DS === true;

  // Inverted TEST mode: bet exactly on the band the normal gate skips, and skip
  // everything else. The DS-band membership IS the BET/SKIP decision here — the
  // EV gate (built on the non-inverted probability mapping) is bypassed below.
  const inverted = cfg.LIVE_1H_INVERT_DECISION === true;
  const inBand = ds.score != null
    && ds.score >= cfg.LIVE_1H_INVERT_DS_MIN
    && ds.score <= cfg.LIVE_1H_INVERT_DS_MAX;

  const skip = dsOff
    ? false
    : inverted
      ? !inBand
      : (ds.score == null || ds.score < cfg.LIVE_1H_DS_THRESHOLD_MIN);

  if (skip) {
    store.setTm05_1hDecision(matchId, {
      phase: 'skipped_by_ds',
      dsScore: ds.score,
      decision: inverted ? 'SKIP_INVERTED' : 'SKIP',
      decidedAt: new Date().toISOString(),
    }, date);
    logger.info('runTm05_1hDecision: SKIP by DS', { matchId, ds: ds.score, minute, inverted });
    return { status: 'skipped_by_ds', dsScore: ds.score };
  }

  const probability = dsToProbability1H(ds.score);
  const confidence = cfg.LIVE_1H_CONFIDENCE;
  const odds = tm05_1hOddsAt(minute, match.odds);

  const gate = (dsOff || inverted)
    ? { pass: true, reason: dsOff ? 'ds_off' : 'inverted_test', ev: null, pAdj: null }
    : evaluateEvGate({
      probability,
      confidence,
      odds,
      baseline: cfg.LIVE_1H_BASELINE_P,
    });

  // Goal-during-decision race: any goal before halftime kills the line.
  const fresh = store.getMatch(matchId, date);
  const goalBeforeHalftime = fresh?.tracking?.firstGoalMinute != null
    && fresh.tracking.firstGoalMinute <= 45;

  let finalPhase = goalBeforeHalftime ? 'goal_during_decision'
    : gate.pass ? 'signal' : 'gate_blocked';

  // Stale-0:0 guard: before committing a signal, re-read the live score from a
  // cache-busted fetch. The live page can lag the real match by 1-3 min, so a
  // 0:0 snapshot may be stale and the goal already scored. If the confirm read
  // shows any goal, abort the signal — the next poll's discard path resolves it.
  let confirm = null;
  if (finalPhase === 'signal' && cfg.LIVE_1H_CONFIRM_BEFORE_SIGNAL === true) {
    try {
      const live = await confirmLiveScore(matchId);
      if (live && (live.scoreHome + live.scoreAway) > 0) {
        finalPhase = 'goal_during_decision';
        confirm = { ok: false, score: `${live.scoreHome}:${live.scoreAway}`, minute: live.minute ?? null };
        logger.info('runTm05_1hDecision: signal aborted — goal on confirm read', {
          matchId, confirmScore: confirm.score, confirmMinute: confirm.minute, snapshotMinute: minute,
        });
      } else if (live) {
        confirm = { ok: true, score: `${live.scoreHome}:${live.scoreAway}`, minute: live.minute ?? null };
      } else {
        confirm = { ok: null, reason: 'no_data' };
      }
    } catch (err) {
      // Transient fetch failure — don't drop a legit signal; the snapshot was
      // read seconds ago. Proceed but record that confirmation didn't run.
      confirm = { ok: null, reason: err.message };
      logger.warn('runTm05_1hDecision: confirm read failed, proceeding with signal', {
        matchId, err: err.message,
      });
    }
  }

  const keySignals = buildKeySignals(ds, snapshot);
  const reasoning = buildReasoning(match, ds, snapshot, minute);

  const payload = {
    phase: finalPhase,
    dsScore: ds.score,
    dsComponents: ds.components,
    favorite: ds.favorite,
    pNoGoal: probability,
    confidence,
    reasoning,
    keySignals,
    odds,
    evGate: gate,
    calibrated: cfg.LIVE_1H_CALIBRATED === true,
    requestedAtMinute: minute,
    ...(confirm ? { confirm } : {}),
    decidedAt: new Date().toISOString(),
  };

  store.setTm05_1hDecision(matchId, payload, date);

  if (finalPhase === 'signal' && tgDispatcher && cfg.LIVE_1H_TG_ENABLED) {
    setImmediate(() => {
      tgDispatcher.enqueueEntry({
        match: store.getMatch(matchId, date) || match,
        prediction: payload,
        decisionKey: 'tm05_1h',
        minute,
        score: '0:0',
        date,
      }).catch((err) => {
        logger.warn('tg.entry.tm05_1h_enqueue_failed', { matchId, err: err?.message || String(err) });
      });
    });
  }

  logger.info('runTm05_1hDecision: done', {
    matchId, ds: ds.score, p: probability, odds, ev: gate.ev, pass: gate.pass, phase: finalPhase,
  });

  return { status: finalPhase, ev: gate.ev, gateReason: gate.reason };
}

function fav(side, pair) {
  if (!side || !pair) return null;
  return pair[side];
}

/** Format a numeric stat to `digits` decimals, or null when absent/non-finite. */
function numOrNull(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function buildReasoning(match, ds, snapshot, minute) {
  const side = ds.favorite;
  if (!side) return `Низький темп до ${minute}' (DS1H=${ds.score}).`;
  const favName = side === 'home' ? (match.homeTeam || 'фаворит') : (match.awayTeam || 'фаворит');
  const cum = snapshot?.cumulative || {};
  const favXg = numOrNull(fav(side, cum.expectedGoalsXg));
  const favSot = fav(side, cum.shotsOnTarget);
  const favShots = fav(side, cum.totalShots);

  // Build only from metrics that exist — never emit a bare "?" (basic-stats matches lack xG).
  const parts = [];
  if (favXg != null) parts.push(`xG=${favXg}`);
  if (favSot != null) parts.push(`у площину=${favSot}`);
  else if (favShots != null) parts.push(`удари=${favShots}`);
  const tail = parts.length ? ` (${parts.join(', ')})` : '';
  return `Фаворит (${favName}) не пробиває до ${minute}'${tail}. DS1H=${ds.score}.`;
}

function buildKeySignals(ds, snapshot) {
  const side = ds.favorite;
  const cum = snapshot?.cumulative || {};
  const signals = [];
  if (side) {
    const favXg = numOrNull(fav(side, cum.expectedGoalsXg));
    if (favXg != null) signals.push({ signal: 'fav_xg', value: favXg, weight: 'high' });
    const favSot = fav(side, cum.shotsOnTarget);
    if (favSot != null) signals.push({ signal: 'fav_shots_on_target', value: favSot, weight: 'high' });
  }
  const totXg = ds.components?.total_tempo;
  if (totXg != null) signals.push({ signal: 'tempo_dryness', value: totXg, weight: 'med' });
  return signals;
}

module.exports = { runTm05_1hDecision };
