const { sanitizeLeagueName, sanitizeTeams, formatBetLabel } = require('./normalizeMatchText');
const { getTelegramModelFooter } = require('../telegramModelTag');

function getTimingLabel(minute) {
  if (minute <= 65) return '🟢 Раннє вікно';
  if (minute <= 75) return '🟡 Основне вікно';
  if (minute <= 89) return '🟠 Пізнє вікно';
  return '🔴 Занадто пізно';
}

/**
 * Будує блок «Параметри», які враховувались при прийнятті рішення.
 * Кожен параметр — окремий рядок «  • назва: значення».
 */
function buildParamsBlock(lines) {
  const filtered = lines.filter((l) => l != null && l !== false && l !== '');
  if (filtered.length === 0) return '';
  return `\n\n📐 *Параметри:*\n${filtered.map((l) => `  • ${l}`).join('\n')}`;
}

function formatTelegramMessage(match, decision, desktopUrl, opts = {}) {
  const { home, away } = sanitizeTeams(match.home, match.away);
  const league = sanitizeLeagueName(match.league);
  const { score, minute } = match;
  const {
    bet, confidence, pGoal, pDry, edge, reason,
    odds1X2, impliedProb, timeWindow, signalQuality, filtersApplied,
    kellyStakePct, kellyStakeAmount, assumedOdds,
  } = decision;
  const { redCards, modelV2, ggbet, ggbetKelly } = opts;

  const betLabel = formatBetLabel(bet);
  const emoji = bet === 'OVER_0_5' ? '📈' : bet === 'UNDER_0_5' ? '📉' : '⏸️';
  const confMap = { high: '🔥 Висока', medium: '⚠️ Середня', low: '🔅 Низька' };
  const confText = confMap[confidence] || confidence;
  const timing = getTimingLabel(minute);
  const windowLabel = timeWindow ? ` [${timeWindow}]` : '';

  const params = [];
  params.push(`P(гол): ${pGoal ?? 'N/A'}  /  P(сухий): ${pDry ?? 'N/A'}`);
  if (edge != null) params.push(`Edge: ${edge}`);
  if (signalQuality != null) params.push(`Signal quality: ${signalQuality}`);
  if (modelV2?.currentState) params.push(`Стан матчу: ${modelV2.currentState}`);
  if (confText) params.push(`Впевненість: ${confText}`);
  params.push(`Вікно: ${timeWindow || '—'}  /  ${timing}`);
  if (filtersApplied) params.push(`Фільтри: ${filtersApplied}`);

  if (odds1X2) {
    const drawImpl = impliedProb?.draw != null ? ` (нічия ${(impliedProb.draw * 100).toFixed(1)}%)` : '';
    params.push(`Кф 1X2: ${odds1X2.home} / ${odds1X2.draw} / ${odds1X2.away}${drawImpl}`);
  }
  if (kellyStakePct > 0 && kellyStakeAmount > 0) {
    const pctDisplay = (kellyStakePct * 100).toFixed(1);
    const oddsNote = assumedOdds ? ` (кф ~${assumedOdds})` : '';
    params.push(`Ставка (Kelly): ${pctDisplay}% банку ≈ ${kellyStakeAmount} грн${oddsNote}`);
  }
  if (ggbet?.url || (ggbet && (bet === 'UNDER_0_5' ? ggbet.underOdds : ggbet.overOdds))) {
    const ggbetOdds = bet === 'UNDER_0_5' ? ggbet.underOdds : ggbet.overOdds;
    if (ggbetOdds && ggbetKelly && ggbetKelly.amount > 0) {
      const pctReal = (ggbetKelly.pct * 100).toFixed(1);
      params.push(`GGBet кф: ${ggbetOdds} → ${pctReal}% ≈ ${ggbetKelly.amount} грн`);
    } else if (ggbetOdds) {
      params.push(`GGBet кф: ${ggbetOdds}`);
    }
  }
  if (redCards && (redCards.homeRedCards > 0 || redCards.awayRedCards > 0 || redCards.unknownRedCards > 0)) {
    const unknown = redCards.unknownRedCards > 0 ? ` / невизн. ×${redCards.unknownRedCards}` : '';
    params.push(`🟥 Червоні: ${home} ×${redCards.homeRedCards} / ${away} ×${redCards.awayRedCards}${unknown}`);
  }

  let msg = `🏆 ${home} - ${away}\n` +
            `📊 ${league}\n` +
            `⚽ Рахунок: ${score.home}:${score.away} (${minute}')\n\n` +
            `${emoji} *${betLabel}*${windowLabel}`;

  msg += buildParamsBlock(params);

  if (reason) msg += `\n\n📝 ${reason}`;
  if (ggbet?.url) msg += `\n🔗 [GGBet Live](${ggbet.url})`;
  if (desktopUrl) msg += `\n🔗 [Flashscore](${desktopUrl})`;
  msg += getTelegramModelFooter();

  return msg;
}

function formatStatLine(label, data) {
  if (!data || data.total === 0) return null;
  const rate = data.hitRate !== null ? (data.hitRate * 100).toFixed(0) + '%' : '—';
  const unchecked = data.total - data.checked;
  const uncheckedStr = unchecked > 0 ? ` (+${unchecked} без фіналу)` : '';
  return `${label}: ${data.hits}/${data.checked} (${rate})${uncheckedStr}`;
}

function formatDailySummary(summary) {
  if (!summary) return null;

  const resolved = summary.resolved ?? (summary.hits + summary.misses);
  const hitRateStr = summary.hitRate !== null ? (summary.hitRate * 100).toFixed(1) + '%' : 'N/A';
  const pending = summary.actionable - resolved;

  const rowsNote = summary.totalRowsInLog != null && summary.uniqueMatches != null && summary.totalRowsInLog > summary.uniqueMatches
    ? `\n⚠️ У файлі ${summary.totalRowsInLog} рядків / ${summary.uniqueMatches} унік. матчів (старі дублікати враховані в підсумку)`
    : '';

  const legsResolved = summary.legsResolved ?? 0;
  const legHitStr = summary.legHitRate != null ? (summary.legHitRate * 100).toFixed(1) + '%' : 'N/A';

  let msg = `📊 *Підсумок ${summary.date}*${rowsNote}

🔢 Унікальних матчів зі ставкою: ${summary.actionable}
📎 Ніг ставок (ТМ/ТБ за історією): ${summary.stakeLegsPlanned ?? '—'}
✅ Влучень (остання нога): ${summary.hits} | ❌ Промахів: ${summary.misses}
📋 Матчів з фіналом: ${resolved}${pending > 0 ? ` (${pending} без фіналу)` : ''}
📈 *Hit-rate (остання нога): ${hitRateStr}*
🧩 Ніг з результатом: ${legsResolved} → ✅ ${summary.legHits ?? 0} | ❌ ${summary.legMisses ?? 0}
📊 *Hit-rate по ногах: ${legHitStr}*`;

  if (summary.byBetType) {
    const tmLine = formatStatLine('📉 ТМ 0,5 (ніги)', summary.byBetType.UNDER_0_5);
    const tbLine = formatStatLine('📈 ТБ 0,5 (ніги)', summary.byBetType.OVER_0_5);
    const lines = [tmLine, tbLine].filter(Boolean);
    if (lines.length > 0) {
      msg += '\n\n*По типу ставки (ніги):*\n' + lines.join('\n');
    }
  }

  if (summary.byConfidence) {
    const lines = [
      formatStatLine('🔥 High', summary.byConfidence.high),
      formatStatLine('⚠️ Medium', summary.byConfidence.medium),
      formatStatLine('🔅 Low', summary.byConfidence.low),
    ].filter(Boolean);
    if (lines.length > 0) {
      msg += '\n\n*По впевненості (ост. прогноз):*\n' + lines.join('\n');
    }
  }

  if (summary.flips > 0) {
    msg += `\n\n🔀 Матчів з фліпом ТМ→ТБ: ${summary.flips}`;
  }

  return msg;
}

module.exports = { formatTelegramMessage, formatDailySummary };
