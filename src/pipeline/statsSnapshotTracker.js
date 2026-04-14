/**
 * MVP: два послідовні зрізи raw2H по matchId (у межах одного worker-процесу).
 * Дельти = приріст накопиченої другої половини між тиками опитування (~3 хв).
 */

const SNAPSHOT_METRICS = [
  'shotsOnTarget',
  'expectedGoalsXg',
  'touchesInOppositionBox',
  'bigChances',
];

function sliceRaw2H(raw2H) {
  if (!raw2H) return null;
  const o = {};
  for (const k of SNAPSHOT_METRICS) {
    const v = raw2H[k];
    o[k] = v === undefined || v === null ? null : Number(v);
    if (o[k] !== null && !Number.isFinite(o[k])) o[k] = null;
  }
  return o;
}

/**
 * Записує поточний зріз і повертає дельти відносно попереднього візиту.
 * @param {Map<string, { matchMinute: number, slice: object }>} store
 * @returns {{ deltas: Record<string, number|null>|null, deltaMatchMinutes: number|null, snapshotCount: number, prevMinute: number|null }}
 */
function recordAndComputeDeltas(store, matchId, matchMinute, raw2H) {
  const slice = sliceRaw2H(raw2H);
  if (!slice || matchMinute == null || !Number.isFinite(Number(matchMinute))) {
    return {
      deltas: null,
      deltaMatchMinutes: null,
      snapshotCount: 0,
      prevMinute: null,
    };
  }

  const m = Number(matchMinute);
  const prev = store.get(matchId);
  let deltas = null;
  let deltaMatchMinutes = null;
  let snapshotCount = 1;

  if (prev && prev.slice) {
    snapshotCount = 2;
    deltas = {};
    for (const k of SNAPSHOT_METRICS) {
      const a = prev.slice[k];
      const b = slice[k];
      if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) {
        deltas[k] = Number((b - a).toFixed(4));
      } else {
        deltas[k] = null;
      }
    }
    if (prev.matchMinute != null && Number.isFinite(prev.matchMinute)) {
      deltaMatchMinutes = Math.max(0, m - prev.matchMinute);
    }
  }

  store.set(matchId, { matchMinute: m, slice });
  return { deltas, deltaMatchMinutes, snapshotCount, prevMinute: prev?.matchMinute ?? null };
}

function pruneSnapshotStore(store, activeMatchIds) {
  if (!store.size) return;
  const keep = activeMatchIds instanceof Set ? activeMatchIds : new Set(activeMatchIds);
  for (const id of store.keys()) {
    if (!keep.has(id)) store.delete(id);
  }
}

module.exports = {
  SNAPSHOT_METRICS,
  recordAndComputeDeltas,
  pruneSnapshotStore,
};
