'use strict';

const { SYSTEM_PROMPT } = require('./constants');

function safeNumber(value, fallback = 'n/a') {
  return value == null ? fallback : String(value);
}

function safeAdd(a, b) {
  if (a == null && b == null) return null;
  return Math.round((((a || 0) + (b || 0)) * 100)) / 100;
}

function summarizeStandings(standings) {
  if (!standings?.home || !standings?.away) return 'немає даних';
  return `home #${standings.home.position}, away #${standings.away.position}`;
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

function formatWindowsTable(windows) {
  if (!windows.length) return 'немає даних';

  const lines = ['хв  | удари | у_створ | xG    | кутові'];
  for (const item of windows) {
    lines.push(
      `${item.minute}  | ${item.shots_total} | ${item.sot_total} | ${safeNumber(item.xg_total)} | ${item.corners}`,
    );
  }
  return lines.join('\n');
}

function findSnapshotForMinute(match, minute) {
  const eligible = (match.snapshots || []).filter(snapshot => snapshot.minute <= minute);
  return eligible[eligible.length - 1] || null;
}

function buildHalftimeSection(match) {
  const ht = match.aiAnalysis?.halftime?.output;
  if (!ht) return '';
  return `ОЦІНКА В ПЕРЕРВІ (AI):
- p(0:0): ${safeNumber(ht.p_match_ends_0_0)}
- Стан: ${safeNumber(ht.match_state)}
- Домінує: ${safeNumber(ht.dominant_side)}
- Впевненість: ${safeNumber(ht.confidence)}`;
}

function buildDecision60Section(match) {
  const d60 = match.aiAnalysis?.decision60?.output;
  if (!d60) return '';
  return `ОЦІНКА НА 60-Й ХВИЛИНІ (AI):
- p(0:0): ${safeNumber(d60.p_match_ends_0_0)}
- p(goal): ${safeNumber(d60.p_match_has_goal)}
- Стан: ${safeNumber(d60.match_state)}
- Домінує: ${safeNumber(d60.dominant_side)}
- Впевненість: ${safeNumber(d60.confidence)}`;
}

function buildHalftimePrompt(match) {
  const user = `Матч на перерві з рахунком 0:0.

КОМАНДИ:
${match.homeTeam} (дім) vs ${match.awayTeam} (гості)
Ліга: ${match.league}, ${match.country}

ПЕРЕДМАТЧЕВИЙ КОНТЕКСТ:
- Коефіцієнти 1X2: ${safeNumber(match.odds?.home)} / ${safeNumber(match.odds?.draw)} / ${safeNumber(match.odds?.away)}
- Market signal (чисті ймовірності): ${safeNumber(match.derived?.marketSignal)}
- Table signal: ${safeNumber(match.derived?.tableSignal)}
- H2H останні 5: ${summarizeH2H(match.h2h)}
- Турнірне положення: ${summarizeStandings(match.standings)}

СТАТИСТИКА ПЕРШОГО ТАЙМУ:
- Удари: ${safeNumber(match.baseline1H?.totalShots?.home)} - ${safeNumber(match.baseline1H?.totalShots?.away)}
- Удари у створ: ${safeNumber(match.baseline1H?.shotsOnTarget?.home)} - ${safeNumber(match.baseline1H?.shotsOnTarget?.away)}
- Кутові: ${safeNumber(match.baseline1H?.cornerKicks?.home)} - ${safeNumber(match.baseline1H?.cornerKicks?.away)}
- Очікувані голи (xG): ${safeNumber(match.baseline1H?.expectedGoalsXg?.home)} - ${safeNumber(match.baseline1H?.expectedGoalsXg?.away)}
- Володіння: ${safeNumber(match.baseline1H?.ballPossession?.home)}% - ${safeNumber(match.baseline1H?.ballPossession?.away)}%
- Жовті картки: ${safeNumber(match.baseline1H?.yellowCards?.home)} - ${safeNumber(match.baseline1H?.yellowCards?.away)}
- Червоні: ${safeNumber(match.baseline1H?.redCards?.home)} - ${safeNumber(match.baseline1H?.redCards?.away)}

Оціни ймовірності розвитку матчу.`;

  return { system: SYSTEM_PROMPT, user };
}

function buildDecisionPrompt(match, minute, options = {}) {
  const currentSnapshot = findSnapshotForMinute(match, minute);
  const windows = buildFiveMinWindows((match.snapshots || []).filter(snapshot => snapshot.minute <= minute));
  const totalXg = safeAdd(match.baseline1H?.expectedGoalsXg?.home, match.baseline1H?.expectedGoalsXg?.away);
  const half1Tempo = totalXg == null ? 'n/a' : Math.round((totalXg / 45) * 1000) / 1000;
  const sections = [buildHalftimeSection(match)];

  if (options.includeDecision60Summary) sections.push(buildDecision60Section(match));

  const user = `Матч триває, поточна хвилина ${minute}, рахунок 0:0.

КОМАНДИ: ${match.homeTeam} vs ${match.awayTeam}

ПЕРШИЙ ТАЙМ (baseline):
- Удари: ${safeNumber(match.baseline1H?.totalShots?.home)} - ${safeNumber(match.baseline1H?.totalShots?.away)}
- У створ: ${safeNumber(match.baseline1H?.shotsOnTarget?.home)} - ${safeNumber(match.baseline1H?.shotsOnTarget?.away)}
- xG: ${safeNumber(match.baseline1H?.expectedGoalsXg?.home)} - ${safeNumber(match.baseline1H?.expectedGoalsXg?.away)}

ДРУГИЙ ТАЙМ ДО ЦЬОГО МОМЕНТУ (хв 45-${minute}):
- Удари: ${safeNumber(currentSnapshot?.since2H?.totalShots?.home)} - ${safeNumber(currentSnapshot?.since2H?.totalShots?.away)}
- У створ: ${safeNumber(currentSnapshot?.since2H?.shotsOnTarget?.home)} - ${safeNumber(currentSnapshot?.since2H?.shotsOnTarget?.away)}
- Кутові: ${safeNumber(currentSnapshot?.since2H?.cornerKicks?.home)} - ${safeNumber(currentSnapshot?.since2H?.cornerKicks?.away)}
- xG 2-го тайму: ${safeNumber(currentSnapshot?.since2H?.expectedGoalsXg?.home)} - ${safeNumber(currentSnapshot?.since2H?.expectedGoalsXg?.away)}
- Володіння: ${safeNumber(currentSnapshot?.ballPossession?.home)}% - ${safeNumber(currentSnapshot?.ballPossession?.away)}%

ДИНАМІКА ПО 5-ХВИЛИННИХ ВІКНАХ:
${formatWindowsTable(windows)}

БАЗОВИЙ ТЕМП 1-ГО ТАЙМУ: ${safeNumber(half1Tempo)} xG/хв

${sections.filter(Boolean).join('\n\n')}

Оціни ймовірності розвитку матчу до фінального свистка.
Зверни увагу на динаміку — чи зростає тиск, чи матч уповільнюється.${options.remainingTimeHint || ''}`;

  return { system: SYSTEM_PROMPT, user };
}

function buildDecision60Prompt(match) {
  return buildDecisionPrompt(match, 60);
}

function buildDecision80Prompt(match) {
  return buildDecisionPrompt(match, 80, {
    includeDecision60Summary: true,
    remainingTimeHint: '\nДо фінального свистка залишилось 10 регулярних хвилин + компенсований час.',
  });
}

module.exports = {
  buildFiveMinWindows,
  buildHalftimePrompt,
  buildDecision60Prompt,
  buildDecision80Prompt,
  safeAdd,
};
