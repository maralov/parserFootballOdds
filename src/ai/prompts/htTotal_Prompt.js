'use strict';

const SYSTEM = `Ти аналітик футбольних ставок з 10 роками практики.
Працюй ЛИШЕ з фактами. Не вигадуй цифри. Краще низька впевненість ніж галюцинація.

ТРЕК: підсумковий тотал матчу (прогноз на перерві).
КОНТЕКСТ: 1-й тайм закінчився. Оціни P(тотал≥1.5) та P(тотал≥2.5) для всього матчу.

БАЗОВА ЛІНІЯ (для зони 0:0 на перерві):
- Матчі 0:0 на HT помірно малорезультативні — значно нижче середнього тоталу
- P(тотал≥1.5) базово ~55–65%, P(тотал≥2.5) базово ~25–35%
- 2-й тайм зазвичай результативніший за 1-й
- Низький 1H-xG (≤0.15) → схиляйся до UNDER

ОБОВ'ЯЗКОВО через web_search перевір:
0. Ігрова ситуація: що зміниться у 2-му таймі (тактика, необхідність перемогти)?
1. Склади: чи є вихід ключових бомбардирів/атакуючих гравців?
2. Замни і тактичні зміни: очікувані зміни на перерві
3. Червоні картки / вилучення у 1-му таймі (зменшують або збільшують результативність)
4. Погодні умови: дощ/слизьке поле → менше голів
5. Мотивація: що вирішує матч, чи є команди у серії без голів
6. Характер ліги: mid-week vs вихідні, рівень захисту

ЯКІР: без сильного фактора — тримайся біля базової лінії, confidence ≤ 0.40.
НЕ РОЗДУВАЙ p: слабкі сигнали (H2H загальний, загальне володіння) не підвищують прогноз вище бази.

ВИДАЄШ ЛИШЕ STRICT JSON, без markdown, без вступу:
{
  "expected_goals": <очікувані голи всього матчу 0..6>,
  "p_over_1_5": <P(тотал≥2) 0..1>,
  "p_over_2_5": <P(тотал≥3) 0..1>,
  "confidence": <впевненість 0..1 у прогнозі>,
  "reasoning": "<2-4 речення чому>",
  "key_signals": [{"signal":"<код>","value":"<значення>","weight":"high"|"med"|"low"}],
  "found_factors": <true якщо знайшов сильний фактор 2H, false якщо ні>
}`;

function safe(v, fallback = 'n/a') {
  return v == null ? fallback : String(v);
}

/**
 * Build the LLM prompt for a HT Total prediction.
 *
 * @param {object} match     - Match record (homeTeam, awayTeam, league, country, odds, standings)
 * @param {object} snapshot  - Last 1H snapshot (with cumulative stats)
 * @param {object} htScore   - HT score { home: number, away: number }
 * @returns {{ system: string, user: string }}
 */
function buildHtTotalPrompt(match, snapshot, htScore) {
  const htHome = htScore != null ? safe(htScore.home, '0') : '0';
  const htAway = htScore != null ? safe(htScore.away, '0') : '0';

  const cum = snapshot?.cumulative || {};

  const xgHomeVal = cum.expectedGoalsXg?.home;
  const xgAwayVal = cum.expectedGoalsXg?.away;
  const xGHome = xgHomeVal == null ? 'n/a' : String(xgHomeVal);
  const xGAway = xgAwayVal == null ? 'n/a' : String(xgAwayVal);
  const xGTotal = (xgHomeVal == null && xgAwayVal == null)
    ? 'n/a'
    : String((xgHomeVal || 0) + (xgAwayVal || 0));

  const sotHomeVal = cum.shotsOnTarget?.home;
  const sotAwayVal = cum.shotsOnTarget?.away;
  const SoTTotal = (sotHomeVal == null && sotAwayVal == null)
    ? 'n/a'
    : String((sotHomeVal || 0) + (sotAwayVal || 0));

  const tbHomeVal = cum.touchesInOppositionBox?.home;
  const tbAwayVal = cum.touchesInOppositionBox?.away;
  const TouchBoxTotal = (tbHomeVal == null && tbAwayVal == null)
    ? 'n/a'
    : String((tbHomeVal || 0) + (tbAwayVal || 0));

  const odds = match.odds || {};
  const draw = safe(odds.draw);

  const stand = match.standings || {};
  const homePOS = safe(stand.home?.position);
  const awayPOS = safe(stand.away?.position);
  const homePPG = stand.home?.mp ? (stand.home.pts / stand.home.mp).toFixed(2) : 'n/a';
  const awayPPG = stand.away?.mp ? (stand.away.pts / stand.away.mp).toFixed(2) : 'n/a';

  const favInfo = odds.isOddsFavorite;
  const favSide = favInfo?.favorite || 'none';
  const favTeam = favSide === 'home'
    ? (match.homeTeam || 'Home')
    : favSide === 'away'
      ? (match.awayTeam || 'Away')
      : 'none';

  const user = `МАТЧ: ${safe(match.homeTeam)} vs ${safe(match.awayTeam)}
ЛІГА: ${safe(match.league)} (${safe(match.country)})
HT-РАХУНОК: ${htHome}:${htAway}
XВИЛИНИ 1H xG: ${xGTotal} (h:${xGHome} / a:${xGAway})
1H SoT: ${SoTTotal}  TouchBox: ${TouchBoxTotal}

КЕФ НІЧИЄЇ (1X2): ${draw}
ФАВОРИТ: ${favTeam} (${favSide})
- Позиція: home ${homePOS} / away ${awayPOS}
- PPG: home ${homePPG} / away ${awayPPG}

ВИКОНАЙ web_search ЗА КАТЕГОРІЯМИ 0-6 (div. system).
Поверни STRICT JSON за схемою з system.`;

  return { system: SYSTEM, user };
}

module.exports = { buildHtTotalPrompt };
