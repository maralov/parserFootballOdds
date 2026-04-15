function sanitizeLeagueName(raw) {
  const s = String(raw || '')
    .replace(/\s*(Таблиця|Standings)\s*$/gi, '')
    .replace(/\s*(Таблиця|Standings)\s*\d{1,3}(?:\+\d{1,2})?['’′].*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || 'unknown';
}

function sanitizeTeamName(raw) {
  let s = String(raw || '')
    .replace(/^\s*\d{1,3}(?:\+\d{1,2})?['’′]\s*/g, '')
    .replace(/\s*(Таблиця|Standings)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return '';

  // Захист від випадків, коли в команду "прилипла" ліга через поламаний парсинг.
  const splitByLeague = s.split(/\s*:\s*/);
  if (splitByLeague.length >= 2) {
    s = splitByLeague[splitByLeague.length - 1].trim();
  }

  return s;
}

function sanitizeTeams(homeRaw, awayRaw) {
  let home = sanitizeTeamName(homeRaw);
  let away = sanitizeTeamName(awayRaw);

  const merged = `${homeRaw || ''} - ${awayRaw || ''}`.replace(/\s+/g, ' ').trim();
  const minuteSplit = merged.match(/\d{1,3}(?:\+\d{1,2})?['’′]\s*(.+?)\s+-\s+(.+)$/);
  if (minuteSplit) {
    home = sanitizeTeamName(minuteSplit[1]);
    away = sanitizeTeamName(minuteSplit[2]);
    return { home, away };
  }

  if (away.includes(' - ') && home && !/\s-\s/.test(home)) {
    const parts = away.split(/\s+-\s+/);
    if (parts.length >= 2) {
      home = sanitizeTeamName(parts[0]);
      away = sanitizeTeamName(parts.slice(1).join(' - '));
    }
  }

  return { home, away };
}

function formatBetLabel(bet) {
  if (bet === 'OVER_0_5') return 'ТБ 0,5';
  if (bet === 'UNDER_0_5') return 'ТМ 0,5';
  return 'SKIP';
}

module.exports = {
  sanitizeLeagueName,
  sanitizeTeamName,
  sanitizeTeams,
  formatBetLabel,
};
