/**
 * Блок I: проксі-аналіз "ранній dry → пізній goal" (flip under→over).
 * Без live-snapshot-ів — оцінюємо за derived drynessIndex та факт late goal.
 */

const { pct } = require('./modelEval');
const { computeAllDerived } = require('./derivedMetrics');

const DRYNESS_HIGH_THRESHOLD = 0.6;

function flipProxies(matches) {
  const enriched = matches.map(m => ({
    ...m,
    _derived: computeAllDerived(m),
  }));

  const earlyDryProfile = enriched.filter(m => m._derived.dryness >= DRYNESS_HIGH_THRESHOLD);
  const earlyDryThenGoal = earlyDryProfile.filter(m => m.result?.totalGoals > 0);
  const earlyDryThenDry = earlyDryProfile.filter(m => m.result?.totalGoals === 0);

  const lowPressureHighDry = enriched.filter(m =>
    m._derived.dryness >= DRYNESS_HIGH_THRESHOLD && m._derived.pressure <= 0.3
  );
  const lphdThenGoal = lowPressureHighDry.filter(m => m.result?.totalGoals > 0);

  const highPressureLowDry = enriched.filter(m =>
    m._derived.pressure >= 0.5 && m._derived.dryness < 0.4
  );
  const hpldThenGoal = highPressureLowDry.filter(m => m.result?.totalGoals > 0);
  const hpldThenDry = highPressureLowDry.filter(m => m.result?.totalGoals === 0);

  return {
    disclaimer:
      'Flip proxies are estimated from end-of-match derived indices, not from per-minute snapshots. ' +
      'True flip detection requires live re-evaluation at multiple time windows (planned).',
    drynessThreshold: DRYNESS_HIGH_THRESHOLD,
    earlyDryProfile: {
      total: earlyDryProfile.length,
      thenGoal: earlyDryThenGoal.length,
      thenDry: earlyDryThenDry.length,
      flipRate: pct(earlyDryThenGoal.length, earlyDryProfile.length),
    },
    lowPressureHighDry: {
      total: lowPressureHighDry.length,
      thenGoal: lphdThenGoal.length,
      flipRate: pct(lphdThenGoal.length, lowPressureHighDry.length),
    },
    highPressureLowDry: {
      total: highPressureLowDry.length,
      thenGoal: hpldThenGoal.length,
      thenDry: hpldThenDry.length,
      goalRate: pct(hpldThenGoal.length, highPressureLowDry.length),
    },
  };
}

module.exports = { flipProxies };
