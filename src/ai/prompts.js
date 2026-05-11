'use strict';

const { SYSTEM_PROMPT, SYSTEM_PROMPT_HALFTIME } = require('./constants');
const { buildDecision60Prompt } = require('./prompts/decision60Prompt');
const { buildDecision80Prompt } = require('./prompts/decision80Prompt');

function safeNumber(value, fallback = 'n/a') {
  return value == null ? fallback : String(value);
}

function safeAdd(a, b) {
  if (a == null && b == null) return null;
  return Math.round((((a || 0) + (b || 0)) * 100)) / 100;
}

function summarizeH2H(h2h) {
  if (!h2h) return 'немає даних';
  const home = h2h.recentForm?.home?.map(item => item.result).join('/');
  const away = h2h.recentForm?.away?.map(item => item.result).join('/');
  const faceToFace = h2h.faceToFace?.map(item => item.score).join(', ');
  return `home:${home || 'n/a'}; away:${away || 'n/a'}; h2h:${faceToFace || 'n/a'}`;
}

function buildFiveMinWindows(snapshots = []) {
  return snapshots
    .filter(snapshot => snapshot?.delta)
    .map(snapshot => ({
      minute: snapshot.minute,
      shots_total: (snapshot.delta.totalShots?.home || 0) + (snapshot.delta.totalShots?.away || 0),
      sot_total: (snapshot.delta.shotsOnTarget?.home || 0) + (snapshot.delta.shotsOnTarget?.away || 0),
      xg_total: safeAdd(snapshot.delta.expectedGoalsXg?.home, snapshot.delta.expectedGoalsXg?.away),
      corners: (snapshot.delta.cornerKicks?.home || 0) + (snapshot.delta.cornerKicks?.away || 0),
    }));
}

function halftimeProbs(ht) {
  if (!ht) return null;
  if (typeof ht.p_match_ends_0_0 === 'number') return { p00: ht.p_match_ends_0_0, pGoal: ht.p_match_has_goal, conf: ht.confidence };
  const pq = ht.probabilities || {};
  if (typeof pq.p_match_ends_0_0 !== 'number') return null;
  return {
    p00: pq.p_match_ends_0_0,
    pGoal: pq.p_match_has_goal,
    conf: ht.confidence,
  };
}

function summarizeHtSide(side) {
  if (!side || typeof side !== 'object') return 'n/a';
  const gaps = Array.isArray(side.key_absences) ? side.key_absences.length : 0;
  const situation = side.form_quality_assessment || side.team_internal_state || side.tournament_situation || 'n/a';
  const rot = side.rotation_risk ?? side.lineup_strength_vs_normal;
  return `${safeNumber(situation)}, rot=${safeNumber(rot)}, abs=${gaps}`;
}

function buildHalftimeSection(match) {
  const ht = match.aiAnalysis?.halftime?.output;
  if (!ht) return '';
  const probs = halftimeProbs(ht);
  const legacy = probs
    ? `p(0:0): ${safeNumber(probs.p00)}\np(goal): ${safeNumber(probs.pGoal)}\nВпевненість: ${safeNumber(probs.conf)}`
    : '';
  let research = '';
  if (typeof ht.research_meta?.research_quality === 'number') {
    research += `Якість research: ${safeNumber(ht.research_meta.research_quality)}\n`;
  }
  if (ht.first_half_interpretation?.expected_2h_pattern || ht.first_half_context?.expected_2h_pattern) {
    research += `Очікування 2H: ${safeNumber(
      ht.first_half_interpretation?.expected_2h_pattern || ht.first_half_context?.expected_2h_pattern,
    )}\n`;
  }
  const homeAway = [`${match.homeTeam}: ${summarizeHtSide(ht.home_team)}`, `${match.awayTeam}: ${summarizeHtSide(ht.away_team)}`];

  return `ОЦІНКА В ПЕРЕРВІ (AI research):
${legacy}
${research}${homeAway.join('\n')}
Ключ фактор: ${safeNumber(ht.first_half_interpretation?.key_factor_driving_pattern || ht.first_half_context?.key_factor)}`;
}

/**
 * @param {object} match
 * @param {{ timezone?: string, now?: Date }} [ctx]
 */
function buildHalftimeUserPrompt(match, ctx = {}) {
  const timezone = ctx.timezone || 'UTC';
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const matchDateTime = match.matchDateTime || match.match_datetime || 'not_found';
  const round = match.round || 'not_found';
  const fatigueHome = match?.h2h?.daysSinceLastMatch?.home;
  const fatigueAway = match?.h2h?.daysSinceLastMatch?.away;
  const standings = match.standings || {};
  const homePpg = standings.home?.mp > 0 ? (standings.home.pts / standings.home.mp).toFixed(2) : 'not_found';
  const awayPpg = standings.away?.mp > 0 ? (standings.away.pts / standings.away.mp).toFixed(2) : 'not_found';

  const ht1 = match.statistics?.['1half'];
  const cap = match.statistics?.capturedAtStatus;

  return `МАТЧ:
- Дім: ${match.homeTeam}
- Гості: ${match.awayTeam}
- Ліга: ${match.league} (${match.country})
- Дата і час: ${safeNumber(matchDateTime)} (${timezone})
- Тур: ${safeNumber(round)}

ПОТОЧНИЙ СТАН:
- Перерва, рахунок 0:0
- Поточний час: ${now.toISOString()}

СТАТИСТИКА ПЕРШОГО ТАЙМУ (знімок зі stats-сторінки: ${safeNumber(cap, 'невідомо')}):
| Показник       | Дім | Гості |
| Удари          | ${safeNumber(match.baseline1H?.totalShots?.home)} | ${safeNumber(match.baseline1H?.totalShots?.away)} |
| Удари повз     | ${safeNumber(ht1?.home?.shotsOffTarget)} | ${safeNumber(ht1?.away?.shotsOffTarget)} |
| Удари у створ  | ${safeNumber(match.baseline1H?.shotsOnTarget?.home)} | ${safeNumber(match.baseline1H?.shotsOnTarget?.away)} |
| Кутові         | ${safeNumber(match.baseline1H?.cornerKicks?.home)} | ${safeNumber(match.baseline1H?.cornerKicks?.away)} |
| xG             | ${safeNumber(match.baseline1H?.expectedGoalsXg?.home)} | ${safeNumber(match.baseline1H?.expectedGoalsXg?.away)} |
| Володіння      | ${safeNumber(match.baseline1H?.ballPossession?.home)}% | ${safeNumber(match.baseline1H?.ballPossession?.away)}% |
| Жовті картки   | ${safeNumber(match.baseline1H?.yellowCards?.home)} | ${safeNumber(match.baseline1H?.yellowCards?.away)} |
| Червоні        | ${safeNumber(match.baseline1H?.redCards?.home)} | ${safeNumber(match.baseline1H?.redCards?.away)} |

Сирі рядки статистики (як на Flashscore): ${match.statistics?.rawRows?.length
    ? JSON.stringify(match.statistics.rawRows, null, 0)
    : 'немає'}

ПЕРЕДМАТЧЕВИЙ КОНТЕКСТ (з нашої системи):
- Коефіцієнти 1X2: ${safeNumber(match.odds?.home)} / ${safeNumber(match.odds?.draw)} / ${safeNumber(match.odds?.away)}
- Market signal: ${safeNumber(match.derived?.marketSignal)} (від -1 до +1, мінус = фаворит гості)
- Table signal: ${safeNumber(match.derived?.tableSignal)}
- Положення в таблиці: дім ${safeNumber(standings.home?.position, 'not_found')} / гості ${safeNumber(standings.away?.position, 'not_found')}
- Очки за гру: дім ${safeNumber(homePpg, 'not_found')} / гості ${safeNumber(awayPpg, 'not_found')}
- H2H останні 5: ${summarizeH2H(match.h2h)}
- Дні відпочинку: дім ${safeNumber(fatigueHome, 'not_found')} / гості ${safeNumber(fatigueAway, 'not_found')}

ЗАВДАННЯ:
Виконай контекстне дослідження для цього матчу за categories 1-7
(склади, мотивація, форма, тактика, зовнішні фактори, ринкові
сигнали, H2H контекст). Зроби 3-5 цілеспрямованих пошуків.
Поверни структуровану оцінку у строгому JSON-форматі.`;
}

function buildHalftimePrompt(match, ctx = {}) {
  return {
    system: SYSTEM_PROMPT_HALFTIME,
    user: buildHalftimeUserPrompt(match, ctx),
  };
}

module.exports = {
  SYSTEM_PROMPT,
  buildFiveMinWindows,
  buildHalftimePrompt,
  buildHalftimeUserPrompt,
  buildHalftimeSection,
  summarizeH2H,
  safeAdd,
  buildDecision60Prompt,
  buildDecision80Prompt,
};
