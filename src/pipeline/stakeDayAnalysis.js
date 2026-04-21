const { sessionDateKey } = require('../helpers/date');
const {
  dedupeByMatchId,
  resolvedLegsForMatch,
  buildSummary,
} = require('./resultChecker');

const DEFAULT_AVG_ODDS = 2.5;
const DEFAULT_STAKE_FRAC = 0.05;

function isFlipMatch(m) {
  if (!m.betHistory || m.betHistory.length < 2) return false;
  const bets = m.betHistory.map((b) => b.bet);
  return bets.includes('UNDER_0_5') && bets.includes('OVER_0_5');
}

function bucketConfidence(conf) {
  if (conf === 'high' || conf === 'medium' || conf === 'low') return conf;
  return 'unknown';
}

/**
 * Аналіз ніг ставок за день (після дедупу логів).
 * Прибуток: кожна нога — окрема ставка `stakeFrac` від банку при середньому кф `avgOdds`.
 */
function analyzeStakeLegs(matches, dateRef, opts = {}) {
  const avgOdds = Number(opts.avgOdds) > 0 ? Number(opts.avgOdds) : DEFAULT_AVG_ODDS;
  const stakeFrac = Number(opts.stakeFrac) > 0 ? Number(opts.stakeFrac) : DEFAULT_STAKE_FRAC;
  const winUnit = stakeFrac * (avgOdds - 1);
  const loseUnit = stakeFrac;

  const unique = dedupeByMatchId(matches);
  const actionable = unique.filter(
    (m) => m.pipeline === 'decision_made' && m.prediction?.bet && m.prediction.bet !== 'SKIP'
  );

  const byConfidence = {
    high: { legs: 0, hits: 0, misses: 0, profitBank: 0 },
    medium: { legs: 0, hits: 0, misses: 0, profitBank: 0 },
    low: { legs: 0, hits: 0, misses: 0, profitBank: 0 },
    unknown: { legs: 0, hits: 0, misses: 0, profitBank: 0 },
  };

  const byBet = {
    UNDER_0_5: { legs: 0, hits: 0, misses: 0, profitBank: 0 },
    OVER_0_5: { legs: 0, hits: 0, misses: 0, profitBank: 0 },
  };

  let legsTotal = 0;
  let profitBankTotal = 0;
  let flipLegs = 0;
  let flipProfitBank = 0;
  let flipHits = 0;
  let flipMisses = 0;

  for (const m of actionable) {
    const rl = resolvedLegsForMatch(m);
    if (rl.length === 0) continue;

    const hist = m.betHistory || [];
    const flip = isFlipMatch(m);

    rl.forEach((leg, i) => {
      if (leg.bet !== 'UNDER_0_5' && leg.bet !== 'OVER_0_5') return;

      const conf = bucketConfidence(hist[i]?.confidence || m.prediction?.confidence);
      const pnl = leg.hit ? winUnit : -loseUnit;

      byConfidence[conf].legs += 1;
      if (leg.hit) byConfidence[conf].hits += 1;
      else byConfidence[conf].misses += 1;
      byConfidence[conf].profitBank += pnl;

      byBet[leg.bet].legs += 1;
      if (leg.hit) byBet[leg.bet].hits += 1;
      else byBet[leg.bet].misses += 1;
      byBet[leg.bet].profitBank += pnl;

      legsTotal += 1;
      profitBankTotal += pnl;

      if (flip) {
        flipLegs += 1;
        flipProfitBank += pnl;
        if (leg.hit) flipHits += 1;
        else flipMisses += 1;
      }
    });
  }

  const summary = buildSummary(matches, dateRef, 0, 0, 0, { persist: true });

  const flipMatches = actionable.filter(isFlipMatch);

  return {
    dateKey: sessionDateKey(dateRef),
    avgOdds,
    stakeFrac,
    stakePct: stakeFrac * 100,
    summary,
    byConfidence,
    byBet,
    legsTotal,
    profitBankTotal,
    flipMatches: flipMatches.length,
    flipLegs,
    flipHits,
    flipMisses,
    flipProfitBank,
  };
}

function formatStakeAnalysisMessage(analysis) {
  const {
    dateKey, avgOdds, stakePct, summary, byConfidence, byBet,
    legsTotal, profitBankTotal, flipMatches, flipLegs, flipHits, flipMisses, flipProfitBank,
  } = analysis;

  const pct = (x) => (x * 100).toFixed(2) + '%';
  const line = (label, b) => {
    if (!b || b.legs === 0) return null;
    const hr = b.hits + b.misses > 0 ? ((b.hits / (b.hits + b.misses)) * 100).toFixed(0) + '%' : '—';
    return `${label}: ніг ${b.legs} (${b.hits}✅ / ${b.misses}❌, hit ${hr}) → *${pct(b.profitBank)}* банку`;
  };

  if (legsTotal === 0) {
    return `📉 *Аналіз ставок ${dateKey}*\n\nНемає закритих ніг (немає resultChecked + рахунку) у логах за цей день.\nУнік. матчів у лозі: ${summary.uniqueMatches ?? '—'}.`;
  }

  let msg = `📉 *Аналіз ставок ${dateKey}*

*Модель P&L:* ставка *${stakePct.toFixed(0)}%* банку на кожну ногу, середній кф *${avgOdds}* (чистий виграш при заході: *${(analysis.stakeFrac * (avgOdds - 1) * 100).toFixed(2)}%* банку за ногу).

*Загалом (ніги):* ${legsTotal} → *${pct(profitBankTotal)}* банку
Остання нога по матчах: ${summary.hits}✅ / ${summary.misses}❌ (${summary.resolved} матчів)
Усі ноги: ${summary.legHits}✅ / ${summary.legMisses}❌ (hit ${summary.legHitRate != null ? (summary.legHitRate * 100).toFixed(1) : '—'}%)

*По впевненості (ніги):*
${[
    line('🔥 High', byConfidence.high),
    line('⚠️ Medium', byConfidence.medium),
    line('🔅 Low', byConfidence.low),
    line('❔ Невідомо', byConfidence.unknown),
  ].filter(Boolean).join('\n')}

*По прогнозу ТМ / ТБ (ніги):*
${[
    line('📉 ТМ 0,5', byBet.UNDER_0_5),
    line('📈 ТБ 0,5', byBet.OVER_0_5),
  ].filter(Boolean).join('\n')}

*Фліпи ТМ→ТБ:* матчів ${flipMatches}, ніг ${flipLegs} (${flipHits}✅ / ${flipMisses}❌) → *${pct(flipProfitBank)}* банку`;

  if (summary.totalRowsInLog != null && summary.uniqueMatches != null && summary.totalRowsInLog > summary.uniqueMatches) {
    msg += `\n\n_У логу ${summary.totalRowsInLog} рядків / ${summary.uniqueMatches} унік. матчів (дедуп у звіті)._`;
  }

  return msg;
}

module.exports = { analyzeStakeLegs, formatStakeAnalysisMessage, isFlipMatch };
