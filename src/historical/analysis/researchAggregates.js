/**
 * Блоки A, C, D, G, H з ТЗ — агреговані summary по outcome,
 * рівню статистики, сирих метриках, ринку, типу турніру.
 */

const { pct } = require('./modelEval');
const { computeModelStats } = require('./modelEval');
const {
  getStatsSum, getFeatureFlags, getGoalMinutesBuckets,
  inferTournamentType,
} = require('./matchNormalizer');
const { computeAllDerived } = require('./derivedMetrics');
const {
  groupBy, byCountry, byLeague,
  byFavorite, byDrawProb, byBalance,
} = require('./grouper');

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(arr) {
  if (!arr.length) return null;
  return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3));
}

// --- Блок A ---

function blockA(matches) {
  const total = matches.length;
  const dry = matches.filter(m => m.result?.totalGoals === 0);
  const lateGoal = matches.filter(m => m.result?.totalGoals > 0);
  const goalsAfter60 = matches.map(m => m.result?.goalsAfter60 ?? 0);

  const withGoalAfter70 = matches.filter(m => {
    const mins = m.finalScore?.goalMinutes || [];
    return mins.some(min => min >= 70);
  }).length;
  const withGoalAfter80 = matches.filter(m => {
    const mins = m.finalScore?.goalMinutes || [];
    return mins.some(min => min >= 80);
  }).length;

  const scoreGroups = { '0:0': 0, '1:0_0:1': 0, '1:1': 0, '2:0_0:2': 0 };
  for (const m of matches) {
    const h = m.finalScore.home, a = m.finalScore.away;
    if (h === 0 && a === 0) scoreGroups['0:0']++;
    else if ((h === 1 && a === 0) || (h === 0 && a === 1)) scoreGroups['1:0_0:1']++;
    else if (h === 1 && a === 1) scoreGroups['1:1']++;
    else if ((h === 2 && a === 0) || (h === 0 && a === 2)) scoreGroups['2:0_0:2']++;
  }

  return {
    matchesCount: total,
    dryCount: dry.length,
    lateGoalCount: lateGoal.length,
    pOver05: total > 0 ? Number((lateGoal.length / total).toFixed(3)) : 0,
    pUnder05: total > 0 ? Number((dry.length / total).toFixed(3)) : 0,
    avgGoalsAfter60: mean(goalsAfter60),
    pctWithGoalAfter60: pct(lateGoal.length, total),
    pctWithGoalAfter70: pct(withGoalAfter70, total),
    pctWithGoalAfter80: pct(withGoalAfter80, total),
    scoreGroups,
    scoreGroupsPct: {
      '0:0': pct(scoreGroups['0:0'], total),
      '1:0_0:1': pct(scoreGroups['1:0_0:1'], total),
      '1:1': pct(scoreGroups['1:1'], total),
      '2:0_0:2': pct(scoreGroups['2:0_0:2'], total),
    },
  };
}

// --- Блок C ---

function blockC(matches) {
  const levels = {};
  for (const m of matches) {
    const flags = getFeatureFlags(m);
    const lv = flags.statsLevel;
    if (!levels[lv]) levels[lv] = { matches: [], flags: {} };
    levels[lv].matches.push(m);
    for (const [k, v] of Object.entries(flags)) {
      if (k === 'statsLevel') continue;
      if (!levels[lv].flags[k]) levels[lv].flags[k] = { true: 0, false: 0 };
      levels[lv].flags[k][v ? 'true' : 'false']++;
    }
  }

  const result = {};
  for (const [lv, data] of Object.entries(levels)) {
    const ms = data.matches;
    const lateGoal = ms.filter(m => m.result?.totalGoals > 0).length;
    const withGoal70 = ms.filter(m => (m.finalScore?.goalMinutes || []).some(min => min >= 70)).length;
    const withGoal80 = ms.filter(m => (m.finalScore?.goalMinutes || []).some(min => min >= 80)).length;
    result[lv] = {
      count: ms.length,
      pctGoalAfter60: pct(lateGoal, ms.length),
      pctGoalAfter70: pct(withGoal70, ms.length),
      pctGoalAfter80: pct(withGoal80, ms.length),
      model: computeModelStats(ms),
      flags: data.flags,
    };
  }

  const byFlag = {};
  const flagKeys = ['hasXG', 'hasXGOT', 'hasBigChances', 'hasTouchesInOppositionBox', 'hasExpectedAssists'];
  for (const fk of flagKeys) {
    const withFlag = matches.filter(m => getFeatureFlags(m)[fk]);
    const withoutFlag = matches.filter(m => !getFeatureFlags(m)[fk]);
    byFlag[fk] = {
      with: { count: withFlag.length, model: computeModelStats(withFlag) },
      without: { count: withoutFlag.length, model: computeModelStats(withoutFlag) },
    };
  }

  return { byLevel: result, byFlag };
}

// --- Блок D ---

const RAW_METRICS = {
  attack: ['totalShots', 'shotsOnTarget', 'cornerKicks', 'touchesInOppositionBox', 'shotsInsideTheBox', 'crosses', 'passesInFinalThird'],
  quality: ['expectedGoalsXg', 'xgOnTargetXgot', 'bigChances', 'expectedAssistsXa'],
  tempo: ['ballPossession', 'throwIns', 'freeKicks', 'fouls', 'offsides'],
  defence: ['goalkeeperSaves', 'clearances', 'interceptions', 'errorsLeadingToShot', 'errorsLeadingToGoal'],
  discipline: ['yellowCards', 'redCards'],
};

function blockD(matches) {
  const dry = matches.filter(m => m.result?.totalGoals === 0);
  const lateGoal = matches.filter(m => m.result?.totalGoals > 0);

  function collect(group) {
    const out = {};
    for (const [cat, keys] of Object.entries(RAW_METRICS)) {
      out[cat] = {};
      for (const k of keys) {
        const vals = group
          .map(m => getStatsSum(m).sum[k])
          .filter(v => v != null && Number.isFinite(v));
        out[cat][k] = { mean: mean(vals), median: median(vals), n: vals.length };
      }
    }
    return out;
  }

  return { dry: collect(dry), lateGoal: collect(lateGoal) };
}

// --- Блок G (ринок) ---

function blockG(matches) {
  function outcomeForGroup(ms) {
    const total = ms.length;
    const late = ms.filter(m => m.result?.totalGoals > 0).length;
    const dryN = ms.filter(m => m.result?.totalGoals === 0).length;
    return {
      count: total,
      lateGoalRate: pct(late, total),
      dryRate: pct(dryN, total),
      model: computeModelStats(ms),
    };
  }

  function buildDim(groups) {
    const out = {};
    for (const [k, ms] of Object.entries(groups)) out[k] = outcomeForGroup(ms);
    return out;
  }

  return {
    byFavorite: buildDim(byFavorite(matches)),
    byDrawProb: buildDim(byDrawProb(matches)),
    byBalance: buildDim(byBalance(matches)),
  };
}

// --- Блок H (тип турніру) ---

function blockH(matches) {
  const groups = groupBy(matches, m => inferTournamentType(m.league));
  const out = {};
  for (const [type, ms] of Object.entries(groups)) {
    const late = ms.filter(m => m.result?.totalGoals > 0).length;
    out[type] = {
      count: ms.length,
      lateGoalRate: pct(late, ms.length),
      dryRate: pct(ms.length - late, ms.length),
      model: computeModelStats(ms),
    };
  }
  return out;
}

// --- Derived index summary ---

function derivedSummary(matches) {
  const dry = matches.filter(m => m.result?.totalGoals === 0);
  const lateGoal = matches.filter(m => m.result?.totalGoals > 0);

  function agg(group) {
    const indices = group.map(m => computeAllDerived(m));
    const keys = ['pressure', 'dryness', 'momentum', 'imbalance', 'conversionPressure', 'chaos'];
    const out = {};
    for (const k of keys) {
      const vals = indices.map(i => i[k]).filter(v => v != null);
      out[k] = { mean: mean(vals), median: median(vals), n: vals.length };
    }
    return out;
  }

  return { dry: agg(dry), lateGoal: agg(lateGoal) };
}

module.exports = { blockA, blockC, blockD, blockG, blockH, derivedSummary, RAW_METRICS };
