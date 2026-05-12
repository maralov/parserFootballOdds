'use strict';

const { tb05OddsAt } = require('../../scoring/oddsTable');

const SYSTEM_PROMPT_TB05 = `Ти аналітик футбольних лайв-ставок з 10 роками практики.
Працюй ЛИШЕ з фактами. Не вигадуй цифри. Краще SKIP ніж необґрунтований BET.

ТРЕК: ТБ 0.5 матчу (ставка що хоча б один гол буде).
КОНТЕКСТ: на 80' рахунок все ще 0:0. Залишилось ~10 хв + added time.
Це жорстке вікно — реалістично ймовірність гола в 80-90+ рідко перевищує 30-40%,
тому SKIP буде частим і правильним рішенням.

ОБОВ'ЯЗКОВО через web_search перевір:
1. Стартові склади, чи були заміни (нападники vs захисники в кінці гри)
2. Турнірна мотивація: чи комусь з команд критично треба гол
3. Стиль команди-фаворита у фіналах: пресингує до кінця чи задовольниться 0:0
4. Тренер: патерн пізніх голів last 5 матчів
5. Чи це playoff/derby (підвищує темп) чи прохідний матч (знижує)
6. Чи були останні матчі цих команд з пізніми голами (статистика 80+)
7. Втома обох команд

ВИДАЄШ ЛИШЕ STRICT JSON, без markdown, без вступу:
{
  "decision": "BET" | "SKIP",
  "p_goal": <ймовірність 0..1 що буде хоча б 1 гол до кінця>,
  "confidence": <впевненість 0..1 у твоєму p_goal>,
  "reasoning": "<2-4 речення чому>",
  "key_signals": [
    {"signal": "<короткий код>", "value": "<значення>", "weight": "high"|"med"|"low"}
  ]
}

ПРАВИЛА:
- decision = BET тільки якщо p_goal × коеф ≥ 1.10 (тобто p ≥ 0.58 при коефі 1.9)
- confidence < 0.65 → завжди SKIP
- Будь дуже скептичним: 0:0 на 80' зазвичай і залишається 0:0
- 3-5 key_signals, найвагоміші зверху.`;

function safe(v, fallback = 'n/a') {
  return v == null ? fallback : String(v);
}

function pairStr(pair) {
  if (!pair) return 'n/a';
  return `${safe(pair.home)} - ${safe(pair.away)}`;
}

function sumPair(pair) {
  if (!pair) return null;
  const h = pair.home;
  const a = pair.away;
  if (h == null && a == null) return null;
  return ((h || 0) + (a || 0));
}

function snapshotsTableTb05(snapshots = []) {
  const rows = ['| min | xG(h+a) | SoT(h+a) | TouchBox(h+a) | Corners(h+a) | Big(h+a) | Poss(h-a) |',
                '|-----|---------|----------|---------------|--------------|----------|-----------|'];
  for (const s of snapshots) {
    const m = s.minute ?? s.observedMinute;
    const xg = sumPair(s.cumulative?.expectedGoalsXg);
    const sot = sumPair(s.cumulative?.shotsOnTarget);
    const touch = sumPair(s.cumulative?.touchesInOppositionBox);
    const corn = sumPair(s.cumulative?.cornerKicks);
    const big = sumPair(s.cumulative?.bigChances);
    const pH = s.ballPossession?.home;
    const pA = s.ballPossession?.away;
    rows.push(`| ${safe(m)} | ${safe(xg)} | ${safe(sot)} | ${safe(touch)} | ${safe(corn)} | ${safe(big)} | ${safe(pH)}-${safe(pA)} |`);
  }
  return rows.join('\n');
}

function buildTb05Prompt(match, snapshot80, allSnapshots, ps) {
  const odds = tb05OddsAt(snapshot80?.observedMinute || 80);
  const psScore = ps?.score;
  const psComponents = ps?.components || {};

  const stand = match.standings || {};
  const homePpg = stand.home?.mp ? (stand.home.pts / stand.home.mp).toFixed(2) : 'n/a';
  const awayPpg = stand.away?.mp ? (stand.away.pts / stand.away.mp).toFixed(2) : 'n/a';

  const user = `МАТЧ: ${match.homeTeam} vs ${match.awayTeam}
ЛІГА: ${match.league} (${match.country})
ХВИЛИНА: ${snapshot80?.observedMinute || 80}'  РАХУНОК: 0:0
СТАВКА: ТБ 0.5 матчу
НОРМАТИВНИЙ КОЕФ: ${odds}

ПЕРЕДМАТЧ:
- 1X2: ${safe(match.odds?.home)} / ${safe(match.odds?.draw)} / ${safe(match.odds?.away)}
- Позиція: home ${safe(stand.home?.position)} / away ${safe(stand.away?.position)}
- PPG: home ${homePpg} / away ${awayPpg}

PRESSURE SCORE (наш детермінований): ${safe(psScore)}/100
Components:
${JSON.stringify(psComponents, null, 2)}

ПЕРШИЙ ТАЙМ (baseline):
- xG: ${pairStr(match.baseline1H?.expectedGoalsXg)}
- SoT: ${pairStr(match.baseline1H?.shotsOnTarget)}
- Big chances: ${pairStr(match.baseline1H?.bigChances)}

СНЕПШОТИ 2H (всі з 45' до 80'):
${snapshotsTableTb05(allSnapshots)}

ВИКОНАЙ web_search ЗА КАТЕГОРІЯМИ 1-7 (див. system).
Поверни STRICT JSON за схемою з system.`;

  return {
    system: SYSTEM_PROMPT_TB05,
    user,
  };
}

module.exports = { buildTb05Prompt, SYSTEM_PROMPT_TB05 };
