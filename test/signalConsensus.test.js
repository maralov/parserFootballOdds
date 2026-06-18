const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateConsensus } = require('../src/prediction/signalConsensus');

test('under + high-weight goal-leaning signals → flip (Kuressaare)', () => {
  const r = evaluateConsensus({ direction: 'under', keySignals: [
    { signal: 'Kuressaare_defensive_issues', value: 'Пропустили в 5 з останніх 6 матчів', weight: 'high' },
    { signal: 'H2H_first_half_goals', value: 'Голи в першому таймі в 4 з останніх 5', weight: 'med' },
  ]});
  assert.equal(r.verdict, 'flip');
});

test('under + only med/low goal-leaning → skip (Akranes)', () => {
  const r = evaluateConsensus({ direction: 'under', keySignals: [
    { signal: 'low_xG', value: '0.41', weight: 'high' },
    { signal: 'recent_first_half_goals', value: 'frequent', weight: 'med' },
  ]});
  assert.equal(r.verdict, 'skip'); // low_xG is under-context; recent_first_half_goals only 'med'
});

test('over + dead-live (xG≈0/SoT0) → flip (France)', () => {
  const r = evaluateConsensus({ direction: 'over', keySignals: [
    { signal: 'shots_on_target', value: '0', weight: 'med' },
    { signal: 'xG', value: '0.06', weight: 'med' },
  ]});
  assert.equal(r.verdict, 'flip');
});

test('consistent signals → ok (no contradiction)', () => {
  const under = evaluateConsensus({ direction: 'under', keySignals: [
    { signal: 'low_first_half_goals', value: '0.8/0.8', weight: 'high' },
  ]});
  const over = evaluateConsensus({ direction: 'over', keySignals: [
    { signal: 'home_form', value: '69% перемог вдома', weight: 'high' },
    { signal: 'live_shots_on_target', value: '2', weight: 'low' },
  ]});
  assert.equal(under.verdict, 'ok');
  assert.equal(over.verdict, 'ok');
});
