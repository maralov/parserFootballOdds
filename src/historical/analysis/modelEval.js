function pct(n, total) {
  if (!total) return 0;
  return Number(((n / total) * 100).toFixed(1));
}

function computeModelStats(matches) {
  const total = matches.length;

  const overAll = matches.filter(m => m.modelPrediction?.bet === 'OVER_0_5');
  const underAll = matches.filter(m => m.modelPrediction?.bet === 'UNDER_0_5');
  const skipAll = matches.filter(m => !m.modelPrediction?.bet || m.modelPrediction.bet === 'SKIP');
  const withPred = [...overAll, ...underAll];

  const hits = withPred.filter(m => m.result?.label === 'HIT');
  const misses = withPred.filter(m => m.result?.label === 'MISS');

  function betTypeBlock(arr) {
    const h = arr.filter(m => m.result?.label === 'HIT').length;
    const mi = arr.filter(m => m.result?.label === 'MISS').length;
    return { count: arr.length, hits: h, misses: mi, hitRate: pct(h, h + mi) };
  }

  const skipLateGoal = skipAll.filter(m => m.result?.totalGoals > 0).length;
  const skipDry = skipAll.filter(m => m.result?.totalGoals === 0).length;

  const byConfidence = {};
  for (const level of ['high', 'medium', 'low', 'none']) {
    const group = withPred.filter(m => m.modelPrediction?.confidence === level);
    const h = group.filter(m => m.result?.label === 'HIT').length;
    const mi = group.filter(m => m.result?.label === 'MISS').length;
    const ov = group.filter(m => m.modelPrediction?.bet === 'OVER_0_5').length;
    const un = group.filter(m => m.modelPrediction?.bet === 'UNDER_0_5').length;
    byConfidence[level] = {
      count: group.length,
      hits: h,
      misses: mi,
      hitRate: pct(h, h + mi),
      overCount: ov,
      underCount: un,
    };
  }

  return {
    total,
    predictions: withPred.length,
    overCount: overAll.length,
    underCount: underAll.length,
    skipCount: skipAll.length,
    hits: hits.length,
    misses: misses.length,
    hitRate: pct(hits.length, withPred.length),
    byBetType: {
      OVER_0_5: betTypeBlock(overAll),
      UNDER_0_5: betTypeBlock(underAll),
      SKIP: {
        count: skipAll.length,
        actualLateGoalRate: pct(skipLateGoal, skipAll.length),
        actualDryRate: pct(skipDry, skipAll.length),
      },
    },
    byConfidence,
  };
}

module.exports = { computeModelStats, pct };
