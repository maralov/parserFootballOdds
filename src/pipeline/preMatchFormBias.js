/**
 * Легкий зсув basePGoal у вікні 60–70 на основі форми + очних (preMatch).
 * Працює лише коли parseOk; обмежений капом; при сильній «нічиї» у кф зменшує подвійний тиск.
 */

const { LIVE_PREMATCH_BIAS_CAP } = require('../helpers/constants');

function impliedDraw(odds1X2) {
  if (!odds1X2?.home || !odds1X2?.draw || !odds1X2?.away) return null;
  const h = Number(odds1X2.home);
  const d = Number(odds1X2.draw);
  const a = Number(odds1X2.away);
  if (![h, d, a].every((x) => Number.isFinite(x) && x > 0)) return null;
  const inv = 1 / h + 1 / d + 1 / a;
  return (1 / d) / inv;
}

/**
 * @param {object|null} preMatch — результат parseFormH2hFromCommentaryInnerHtml
 * @param {'60-70'|string} timeWindow
 * @param {object|null} odds1X2
 * @returns {{ deltaPGoal: number, note: string }}
 */
function computePreMatchBasePBias(preMatch, timeWindow, odds1X2) {
  if (timeWindow !== '60-70' || !preMatch?.parseOk) {
    return { deltaPGoal: 0, note: '' };
  }

  const h = preMatch.aggregates?.home;
  const a = preMatch.aggregates?.away;
  const m = preMatch.aggregates?.mutual;

  const parts = [];
  let d = 0;

  const lowBlock = (x) => x && x.n >= 3 && x.avgTotalGoals <= 2.0;
  const highBlock = (x) => x && x.n >= 3 && x.avgTotalGoals >= 3.2;

  if (lowBlock(h) && lowBlock(a)) {
    d -= 0.028;
    parts.push('form_both_low_totals');
  } else if (highBlock(h) || highBlock(a)) {
    d += 0.024;
    parts.push('form_high_totals');
  }

  if (m && m.n >= 2 && m.avgTotalGoals <= 2.2) {
    let w = 1;
    if (m.staleYears != null && m.staleYears >= 4) w = 0.45;
    else if (m.staleYears != null && m.staleYears >= 2) w = 0.75;
    d -= 0.018 * w;
    parts.push('h2h_low_totals');
  }

  const id = impliedDraw(odds1X2);
  if (id != null && id > 0.34 && d < 0) {
    d *= 0.55;
    parts.push('odds_draw_damp');
  }

  const cap = LIVE_PREMATCH_BIAS_CAP;
  d = Math.max(-cap, Math.min(cap, d));
  return { deltaPGoal: Number(d.toFixed(4)), note: parts.join(',') };
}

module.exports = { computePreMatchBasePBias, impliedDraw };
