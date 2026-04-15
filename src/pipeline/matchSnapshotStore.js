const { LIVE_SNAPSHOT_HISTORY_MAX } = require('../helpers/constants');

/**
 * Ключі sum, що зберігаємо в кожному зрізі (компактно для логу).
 */
const SNAPSHOT_SUM_KEYS = [
  'shotsOnTarget',
  'expectedGoalsXg',
  'touchesInOppositionBox',
  'bigChances',
  'cornerKicks',
  'goalkeeperSaves',
  'shotsInsideTheBox',
  'xgOnTargetXgot',
  'passesInFinalThird',
  'expectedAssistsXa',
  'totalShots',
  'crosses',
  'fouls',
  'freeKicks',
];

function sliceRaw2HForStore(raw2H) {
  if (!raw2H) return null;
  const o = {};
  for (const k of SNAPSHOT_SUM_KEYS) {
    const v = raw2H[k];
    if (v === undefined || v === null) {
      o[k] = null;
      continue;
    }
    const n = Number(v);
    o[k] = Number.isFinite(n) ? n : null;
  }
  return o;
}

function computeLiveTrajectoryFromHistory(snapshots) {
  const n = snapshots.length;
  if (n < 2) {
    return {
      deltas: null,
      deltaMatchMinutes: null,
      snapshotCount: n,
      prevMinute: n === 1 ? null : snapshots[n - 2].matchMinute,
    };
  }
  const prev = snapshots[n - 2];
  const cur = snapshots[n - 1];
  const deltas = {};
  for (const k of SNAPSHOT_SUM_KEYS) {
    const a = prev.raw2H[k];
    const b = cur.raw2H[k];
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) {
      deltas[k] = Number((b - a).toFixed(4));
    } else {
      deltas[k] = null;
    }
  }
  return {
    deltas,
    deltaMatchMinutes: Math.max(0, cur.matchMinute - prev.matchMinute),
    snapshotCount: n,
    prevMinute: prev.matchMinute,
  };
}

/**
 * @param {Map<string, { snapshots: object[] }>} store
 */
function appendSnapshot(store, matchId, { matchMinute, score, raw2H, redCards }) {
  const slice = sliceRaw2HForStore(raw2H);
  const m = Number(matchMinute);
  if (!slice || !Number.isFinite(m)) {
    const empty = store.get(matchId);
    const hist = empty?.snapshots || [];
    return { appended: false, history: hist, liveTrajectory: computeLiveTrajectoryFromHistory(hist) };
  }

  let entry = store.get(matchId);
  if (!entry) entry = { snapshots: [] };

  const last = entry.snapshots[entry.snapshots.length - 1];
  const sameMinute = last && last.matchMinute === m;
  const sameData = last && JSON.stringify(last.raw2H) === JSON.stringify(slice);
  if (sameMinute && sameData) {
    return {
      appended: false,
      history: entry.snapshots,
      liveTrajectory: computeLiveTrajectoryFromHistory(entry.snapshots),
    };
  }

  const snap = {
    matchMinute: m,
    score: score ? { home: String(score.home), away: String(score.away) } : null,
    raw2H: slice,
    homeRedCards: redCards?.homeRedCards ?? 0,
    awayRedCards: redCards?.awayRedCards ?? 0,
  };

  entry.snapshots.push(snap);
  if (entry.snapshots.length > LIVE_SNAPSHOT_HISTORY_MAX) {
    entry.snapshots = entry.snapshots.slice(-LIVE_SNAPSHOT_HISTORY_MAX);
  }
  store.set(matchId, entry);

  return {
    appended: true,
    history: entry.snapshots,
    liveTrajectory: computeLiveTrajectoryFromHistory(entry.snapshots),
  };
}

function pruneSnapshotStore(store, activeMatchIds) {
  if (!store.size) return;
  const keep = activeMatchIds instanceof Set ? activeMatchIds : new Set(activeMatchIds);
  for (const id of store.keys()) {
    if (!keep.has(id)) store.delete(id);
  }
}

/**
 * Відновлення з диска (рядки snapshotHistoryV2).
 * @param {Map<string, { snapshots: object[] }>} store
 */
function seedSnapshots(store, matchId, snapshots) {
  if (!matchId || !Array.isArray(snapshots) || snapshots.length === 0) return;
  const cleaned = snapshots
    .filter((s) => s && Number.isFinite(Number(s.matchMinute)) && s.raw2H)
    .map((s) => ({
      matchMinute: Number(s.matchMinute),
      score: s.score || null,
      raw2H: { ...sliceRaw2HForStore(s.raw2H) },
      homeRedCards: s.homeRedCards ?? 0,
      awayRedCards: s.awayRedCards ?? 0,
    }));
  if (cleaned.length === 0) return;
  const trimmed = cleaned.slice(-LIVE_SNAPSHOT_HISTORY_MAX);
  store.set(matchId, { snapshots: trimmed });
}

module.exports = {
  SNAPSHOT_SUM_KEYS,
  sliceRaw2HForStore,
  appendSnapshot,
  pruneSnapshotStore,
  seedSnapshots,
  computeLiveTrajectoryFromHistory,
};
