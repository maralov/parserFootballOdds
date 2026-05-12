'use strict';

const { tm05OddsAt } = require('../../scoring/oddsTable');

const SYSTEM_PROMPT_TM05 = `Ти аналітик футбольних лайв-ставок з 10 роками практики.
Працюй ЛИШЕ з фактами. Не вигадуй цифри. Краще SKIP ніж необґрунтований BET.

ТРЕК: ТМ 0.5 матчу (ставка що матч завершиться 0:0).
КОНТЕКСТ: матч відбирається кандидатом коли на 45' рахунок 0:0
з детальною статистикою. На 60' рахунок все ще 0:0.

ОБОВ'ЯЗКОВО через web_search перевір:
1. Стартові склади, травми/дискваліфікації обох команд (для цього матчу або останні новини)
2. Турнірна мотивація: положення в таблиці, що вирішує цей матч,
   чи комусь треба перемога або обом нічия влаштовує
3. Форма last 5 матчів обох команд, патерн пізніх голів/0:0
4. H2H — останні очні зустрічі, чи це derby/playoff
5. Тренер: як грає на 60-90' при 0:0 (паркує автобус vs тисне)
6. Патерн замін останні 5 матчів (атакувальні в 70-80' чи оборонні)
7. Погода в місті матчу зараз (якщо доступно)
8. Втома: дні з останнього матчу, чи грали єврокубки в середу

ВИДАЄШ ЛИШЕ STRICT JSON, без markdown, без вступу:
{
  "decision": "BET" | "SKIP",
  "p_no_goal": <ймовірність 0..1 що матч закінчиться 0:0>,
  "confidence": <впевненість 0..1 у твоєму p_no_goal>,
  "reasoning": "<2-4 речення чому>",
  "key_signals": [
    {"signal": "<короткий код>", "value": "<значення>", "weight": "high"|"med"|"low"}
  ]
}

ПРАВИЛА:
- decision = BET тільки якщо p_no_goal × коеф ≥ 1.10 (тобто p ≥ 0.55 при коефі 2.0)
- confidence < 0.65 → завжди SKIP
- Будь чесний з p_no_goal. Краще оцінити нижче і SKIP, ніж завищити і програти.
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

function snapshotsTableTm05(snapshots = []) {
  const rows = ['| min | xG(h+a) | SoT(h+a) | TouchBox(h+a) | Big(h+a) | Y/R | Poss(h-a) |',
                '|-----|---------|----------|---------------|----------|-----|-----------|'];
  for (const s of snapshots) {
    const m = s.minute ?? s.observedMinute;
    const xg = sumPair(s.cumulative?.expectedGoalsXg);
    const sot = sumPair(s.cumulative?.shotsOnTarget);
    const touch = sumPair(s.cumulative?.touchesInOppositionBox);
    const big = sumPair(s.cumulative?.bigChances);
    const y = sumPair(s.cumulative?.yellowCards) || 0;
    const r = sumPair(s.cumulative?.redCards) || 0;
    const pH = s.ballPossession?.home;
    const pA = s.ballPossession?.away;
    rows.push(`| ${safe(m)} | ${safe(xg)} | ${safe(sot)} | ${safe(touch)} | ${safe(big)} | ${y}/${r} | ${safe(pH)}-${safe(pA)} |`);
  }
  return rows.join('\n');
}

function buildTm05Prompt(match, snapshot60, snapshotsBefore60, ds) {
  const allSnapshots = [...snapshotsBefore60, snapshot60].filter(Boolean);
  const odds = tm05OddsAt(snapshot60?.observedMinute || 60);
  const dsScore = ds?.score;
  const dsComponents = ds?.components || {};

  const stand = match.standings || {};
  const homePpg = stand.home?.mp ? (stand.home.pts / stand.home.mp).toFixed(2) : 'n/a';
  const awayPpg = stand.away?.mp ? (stand.away.pts / stand.away.mp).toFixed(2) : 'n/a';

  const user = `МАТЧ: ${match.homeTeam} vs ${match.awayTeam}
ЛІГА: ${match.league} (${match.country})
ХВИЛИНА: ${snapshot60?.observedMinute || 60}'  РАХУНОК: 0:0
СТАВКА: ТМ 0.5 матчу
НОРМАТИВНИЙ КОЕФ: ${odds}

ПЕРЕДМАТЧ:
- 1X2: ${safe(match.odds?.home)} / ${safe(match.odds?.draw)} / ${safe(match.odds?.away)}
- Позиція в таблиці: home ${safe(stand.home?.position)} / away ${safe(stand.away?.position)}
- PPG: home ${homePpg} / away ${awayPpg}

DRYNESS SCORE (наш детермінований): ${safe(dsScore)}/100
Components:
${JSON.stringify(dsComponents, null, 2)}

ПЕРШИЙ ТАЙМ (baseline статистика):
- xG: ${pairStr(match.baseline1H?.expectedGoalsXg)}
- SoT: ${pairStr(match.baseline1H?.shotsOnTarget)}
- Big chances: ${pairStr(match.baseline1H?.bigChances)}
- Corners: ${pairStr(match.baseline1H?.cornerKicks)}
- Possession: ${pairStr(match.baseline1H?.ballPossession)}

СНЕПШОТИ 2H (cumulative since HT):
${snapshotsTableTm05(allSnapshots)}

ВИКОНАЙ web_search ЗА КАТЕГОРІЯМИ 1-8 (див. system).
Поверни STRICT JSON за схемою з system.`;

  return {
    system: SYSTEM_PROMPT_TM05,
    user,
  };
}

module.exports = { buildTm05Prompt, SYSTEM_PROMPT_TM05 };
