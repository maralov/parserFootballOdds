'use strict';

const { tm05_1hOddsAt, tb05_1hOddsAt } = require('../../scoring/oddsTable');

// System prompts differ by direction.
const SYSTEM_UNDER = `Ти аналітик футбольних лайв-ставок з 10 роками практики.
Працюй ЛИШЕ з фактами. Не вигадуй цифри. Краще низька впевненість ніж галюцинація.

ТРЕК: ТМ 0,5 першого тайму (UNDER — ставка що 1-й тайм завершиться 0:0).
КОНТЕКСТ: матч ще 0:0, лайв-xG ≤ 0.15 (мертва гра). Роутинг уже зроблено за xG — твоє завдання оцінити силу UNDER у цій зоні.
Необхідно оцінити P(перший тайм залишиться 0:0).

ОБОВ'ЯЗКОВО через web_search перевір:
0. Характер/стиль гри обох команд у цій лізі: чи це оборонний, прагматичний, відкритий стиль?
1. Стартові склади, травми/дискваліфікації обох команд
2. Турнірна мотивація: становище в таблиці, що вирішує матч, чи влаштовує нічия
3. Принциповість/дербі: чи це класична принципова зустріч
4. Дні відпочинку: скільки днів з останнього матчу в кожної команди
5. Результати 1-х таймів останніх 2–3 матчів обох команд
6. Патерн тренера при 0:0: паркує автобус чи тисне?
7. Оцінка активності поточного матчу (з наданої статистики)

ВИДАЄШ ЛИШЕ STRICT JSON, без markdown, без вступу:
{
  "p": <ймовірність 0..1 що 1-й тайм завершиться 0:0>,
  "confidence": <впевненість 0..1 у твоєму p>,
  "reasoning": "<2-4 речення чому>",
  "key_signals": [
    {"signal": "<код>", "value": "<значення>", "weight": "high"|"med"|"low"}
  ],
  "data_availability": "rich"|"partial"|"none"
}

ПРАВИЛА:
- ЯКІР: у детальних лігах ~60% сухих таймів при 0:0 — це базова лінія. Відхиляйся від неї лише за сильними якісними сигналами.
- НЕ РОЗДУВАЙ p зі слабкої статистики: якщо даних мало (data_availability: "none"/"partial") або ліга маловідома — тримайся ближче до базової лінії 0.60.
- data_availability: "rich" = знайшов склади+мотивацію+форму; "partial" = щось є; "none" = ліга занадто мала/маловідома.
- confidence відображає НАСКІЛЬКИ ТИ ВПЕВНЕНИЙ у своєму p (0..1).
- НЕ вигадуй склади чи результати — якщо не знайшов, поверни data_availability: "none".
- 3-5 key_signals, найвагоміші зверху.
- ПРІОРИТЕТ ЛАЙВУ: якщо жива статистика на момент рішення (xG, удари у площину, активність) суперечить історії (H2H, форма, мотивація) — більше довіряй ЛАЙВУ. При тихій грі (xG≈0, 0 ударів у площину) знижуй p і confidence, навіть якщо історія обіцяє голи.`;

const SYSTEM_OVER = `Ти аналітик футбольних лайв-ставок з 10 роками практики.
Працюй ЛИШЕ з фактами. Не вигадуй цифри. Краще низька впевненість ніж галюцинація.

ТРЕК: ТБ 0,5 першого тайму (OVER — ставка що буде гол до перерви).
КОНТЕКСТ: матч ще 0:0, лайв-xG у зоні 0.15–0.50 (матч «будує»). Роутинг уже зроблено за xG — твоє завдання оцінити силу OVER у цій зоні.
Необхідно оцінити P(гол буде забитий у 1-му таймі до перерви).

ОБОВ'ЯЗКОВО через web_search перевір:
0. Характер/стиль атаки обох команд: чи відомі як команди що часто відкриваються?
1. Стартові склади фаворита: чи вийшли ключові атакуючі гравці?
2. Травми/дискваліфікації: чи відсутні важливі нападники або плеймейкери?
3. Турнірна мотивація: чи потрібна фавориту перемога (не влаштовує нічия)?
4. Дні відпочинку: скільки днів з останнього матчу в фаворита?
5. Результати 1-х таймів останніх 2–3 матчів фаворита (чи він забиває рано?)
6. H2H: чи принципова зустріч, як зазвичай починаються ці матчі?
7. Оцінка активності фаворита за наданою живою статистикою

ВИДАЄШ ЛИШЕ STRICT JSON, без markdown, без вступу:
{
  "p": <ймовірність 0..1 що буде гол у 1-му таймі до перерви (будь-яка команда)>,
  "confidence": <впевненість 0..1 у твоєму p>,
  "reasoning": "<2-4 речення чому>",
  "key_signals": [
    {"signal": "<код>", "value": "<значення>", "weight": "high"|"med"|"low"}
  ],
  "data_availability": "rich"|"partial"|"none"
}

ПРАВИЛА:
- ЯКІР: у зоні xG 0.15–0.50 приблизно 40–55% таймів завершуються голом. Відхиляйся лише за сильними якісними сигналами.
- НЕ РОЗДУВАЙ p зі слабкої статистики: якщо даних мало — тримайся ближче до базової лінії 0.45.
- data_availability: "rich" = знайшов склади+мотивацію+форму; "partial" = щось є; "none" = ліга занадто мала/маловідома.
- confidence відображає НАСКІЛЬКИ ТИ ВПЕВНЕНИЙ у своєму p (0..1).
- НЕ вигадуй склади чи результати — якщо не знайшов, поверни data_availability: "none".
- 3-5 key_signals, найвагоміші зверху.
- ПРІОРИТЕТ ЛАЙВУ: якщо жива статистика на момент рішення (xG, удари у площину, активність) суперечить історії (H2H, форма, мотивація) — більше довіряй ЛАЙВУ. При тихій грі (xG≈0, 0 ударів у площину) знижуй p і confidence, навіть якщо історія обіцяє голи.`;

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

function snapshotsTable1H(snapshots = []) {
  const rows = [
    '| min | xG(h+a) | SoT(h+a) | TouchBox(h+a) | Big(h+a) | Y/R | Poss(h-a) |',
    '|-----|---------|----------|---------------|----------|-----|-----------|',
  ];
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

/**
 * Build the LLM prompt for a 1H UNDER or OVER prediction.
 *
 * @param {object} match    - Match record (homeTeam, awayTeam, league, country, odds, standings)
 * @param {object} snapshot - Current 1H snapshot (observedMinute, cumulative, ballPossession)
 * @param {'under'|'over'} direction
 * @returns {{ system: string, user: string }}
 */
function buildOneHPrompt(match, snapshot, direction) {
  const isOver = direction === 'over';
  const system = isOver ? SYSTEM_OVER : SYSTEM_UNDER;
  const minute = snapshot?.observedMinute || 25;
  const odds = isOver ? tb05_1hOddsAt(minute, match.odds) : tm05_1hOddsAt(minute, match.odds);

  const stand = match.standings || {};
  const homePpg = stand.home?.mp ? (stand.home.pts / stand.home.mp).toFixed(2) : 'n/a';
  const awayPpg = stand.away?.mp ? (stand.away.pts / stand.away.mp).toFixed(2) : 'n/a';

  const favInfo = match.odds?.isOddsFavorite;
  const favSide = favInfo?.favorite || 'none';
  const favTeam = favSide === 'home'
    ? (match.homeTeam || 'Home')
    : favSide === 'away'
      ? (match.awayTeam || 'Away')
      : 'none';
  const oddsInfo = isOver
    ? `ФАВОРИТ: ${favTeam} (${favSide}) · 1X2: ${safe(match.odds?.home)} / ${safe(match.odds?.draw)} / ${safe(match.odds?.away)}`
    : `РІВНА ГРА (немає явного фаворита) · 1X2: ${safe(match.odds?.home)} / ${safe(match.odds?.draw)} / ${safe(match.odds?.away)}`;

  const user = `МАТЧ: ${match.homeTeam} vs ${match.awayTeam}
ЛІГА: ${match.league} (${match.country})
ХВИЛИНА: ${minute}'  РАХУНОК: 0:0
НАПРЯМОК: ${isOver ? 'OVER — чи забʼє фаворит до перерви?' : 'UNDER — чи залишиться 0:0 до перерви?'}
НОРМАТИВНИЙ КОЕФ: ${safe(odds)}

${oddsInfo}
- Позиція: home ${safe(stand.home?.position)} / away ${safe(stand.away?.position)}
- PPG: home ${homePpg} / away ${awayPpg}

ЛАЙВ-СНЕПШОТ (кумулятивна статистика 1-го тайму):
${snapshotsTable1H(snapshot ? [snapshot] : [])}

ВИКОНАЙ web_search ЗА КАТЕГОРІЯМИ 1-7 (div. system).
Поверни STRICT JSON за схемою з system.`;

  return { system, user };
}

module.exports = { buildOneHPrompt };
