'use strict';
const { subtractStats } = require('./deltaCalculator');

// Returns a shallow clone of `snap` with since2H/delta filled from cumulative.
function hydrateSnapshot(snap, baseline1H, prevSnap) {
  if (!snap) return snap;
  const cumulative = snap.cumulative || null;
  const since2H = cumulative && baseline1H ? subtractStats(cumulative, baseline1H) : null;
  const delta = cumulative && prevSnap?.cumulative
    ? subtractStats(cumulative, prevSnap.cumulative) : null;
  return { ...snap, since2H, delta };
}

function hydrateAll(snapshots, baseline1H) {
  const out = [];
  let prev = null;
  for (const s of snapshots || []) {
    const h = hydrateSnapshot(s, baseline1H, prev);
    out.push(h);
    prev = s;
  }
  return out;
}

module.exports = { hydrateSnapshot, hydrateAll };
