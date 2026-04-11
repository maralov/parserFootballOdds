const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { GROUPS } = require('./statsClassifier');

const STAT_COLUMNS = [
  'expectedGoalsXg', 'xgOnTargetXgot', 'shotsOnTarget', 'totalShots',
  'shotsInsideTheBox', 'shotsOutsideTheBox', 'shotsOffTarget', 'blockedShots',
  'bigChances', 'touchesInOppositionBox', 'goalkeeperSaves', 'cornerKicks',
  'passesInFinalThird', 'crosses', 'accurateThroughPasses', 'expectedAssistsXa',
  'clearances', 'interceptions', 'tackles', 'duelsWon',
  'ballPossession', 'passes', 'longPasses', 'fouls', 'freeKicks',
  'yellowCards', 'redCards', 'offsides', 'hitTheWoodwork',
];

async function exportToExcel(allMatches, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ParserFootballOdds';

  const wsMatches = wb.addWorksheet('Matches');
  buildMatchesSheet(wsMatches, allMatches);

  const wsSummary = wb.addWorksheet('Summary');
  buildSummarySheet(wsSummary, allMatches);

  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

function buildMatchesSheet(ws, matches) {
  const baseCols = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Country', key: 'country', width: 14 },
    { header: 'League Name', key: 'leagueName', width: 28 },
    { header: 'League Full', key: 'league', width: 35 },
    { header: 'Home', key: 'home', width: 22 },
    { header: 'Away', key: 'away', width: 22 },
    { header: 'Score', key: 'score', width: 8 },
    { header: 'Goal Minutes', key: 'goalMinutes', width: 18 },
    { header: 'Total Goals', key: 'totalGoals', width: 10 },
    { header: 'Goals >=60', key: 'goalsAfter60', width: 10 },
    { header: 'Goal mins OK', key: 'goalMinutesOk', width: 12 },
    { header: '1st Goal Min', key: 'firstGoalMinute', width: 12 },
    { header: 'Early Goal', key: 'hasEarlyGoal', width: 10 },
    { header: 'Was 0:0@60', key: 'wasZeroZeroAt60', width: 12 },
    { header: 'Odds Home', key: 'oddsHome', width: 10 },
    { header: 'Odds Draw', key: 'oddsDraw', width: 10 },
    { header: 'Odds Away', key: 'oddsAway', width: 10 },
    { header: 'Stats Level', key: 'statsLevel', width: 12 },
    { header: 'Has xG', key: 'hasXG', width: 8 },
    { header: 'Metrics #', key: 'metricsCount', width: 10 },
  ];

  const statCols = STAT_COLUMNS.map(key => ({
    header: key, key: `stat_${key}`, width: 14,
  }));

  const modelCols = [
    { header: 'pGoal', key: 'pGoal', width: 10 },
    { header: 'pDry', key: 'pDry', width: 10 },
    { header: 'Bet', key: 'bet', width: 12 },
    { header: 'Confidence', key: 'confidence', width: 12 },
    { header: 'Edge', key: 'edge', width: 10 },
    { header: 'HIT/MISS', key: 'hitMiss', width: 10 },
    { header: 'Sim Minute', key: 'simMinute', width: 10 },
    { header: 'Match URL', key: 'matchUrl', width: 40 },
  ];

  ws.columns = [...baseCols, ...statCols, ...modelCols];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };
  if (ws.columns.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  }

  for (const m of matches) {
    const statsSum = m.stats?.secondHalf?.sum || m.stats?.overall?.sum || {};
    const pred = m.modelPrediction || {};
    const res = m.result || {};
    const cls = m.statsClassification || {};

    const gm = m.finalScore?.goalMinutes;
    const goalMinutesReliable =
      m.goalMinutesReliable !== undefined
        ? m.goalMinutesReliable
        : m.timelineIncomplete === undefined
          ? true
          : !m.timelineIncomplete;
    const row = {
      date: m.date,
      country: m.country ?? '',
      leagueName: m.leagueName ?? '',
      league: m.league,
      home: m.home,
      away: m.away,
      score: `${m.finalScore.home}:${m.finalScore.away}`,
      goalMinutes: Array.isArray(gm) ? gm.join(', ') : '',
      totalGoals: m.finalScore.home + m.finalScore.away,
      goalsAfter60: res.goalsAfter60 ?? '',
      goalMinutesOk: goalMinutesReliable ? 'Yes' : 'No',
      firstGoalMinute: m.firstGoalMinute,
      hasEarlyGoal: m.hasEarlyGoal ? 'Yes' : 'No',
      wasZeroZeroAt60: m.wasZeroZeroAt60 === true ? 'Yes' : m.wasZeroZeroAt60 === false ? 'No' : '?',
      oddsHome: m.odds1X2?.home ?? null,
      oddsDraw: m.odds1X2?.draw ?? null,
      oddsAway: m.odds1X2?.away ?? null,
      statsLevel: cls.statsLevel || 'none',
      hasXG: cls.hasXG ? 'Yes' : 'No',
      metricsCount: cls.metricsCount || 0,
      pGoal: pred.pGoal ?? null,
      pDry: pred.pDry ?? null,
      bet: pred.bet || '',
      confidence: pred.confidence || '',
      edge: pred.edge ?? null,
      hitMiss: res.label || '',
      simMinute: pred.simulation?.minute ?? '',
      matchUrl: m.mobileUrl || '',
    };

    for (const key of STAT_COLUMNS) {
      row[`stat_${key}`] = statsSum[key] ?? null;
    }

    ws.addRow(row);
  }

  for (let r = 2; r <= matches.length + 1; r++) {
    const row = ws.getRow(r);
    const hitCell = row.getCell('hitMiss');
    if (hitCell.value === 'HIT') hitCell.font = { color: { argb: 'FF008000' }, bold: true };
    else if (hitCell.value === 'MISS') hitCell.font = { color: { argb: 'FFCC0000' }, bold: true };
  }
}

function buildSummarySheet(ws, matches) {
  ws.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };

  const analyzed = matches;
  const withPrediction = analyzed.filter((m) => m.modelPrediction?.bet && m.modelPrediction.bet !== 'SKIP');
  const hits = withPrediction.filter((m) => m.result?.label === 'HIT');
  const misses = withPrediction.filter((m) => m.result?.label === 'MISS');
  const unreliableGoalMinutes = analyzed.filter((m) => {
    if (m.goalMinutesReliable !== undefined) return m.goalMinutesReliable === false;
    if (m.timelineIncomplete !== undefined) return m.timelineIncomplete === true;
    return false;
  }).length;

  const rows = [
    ['Total analyzed matches (saved)', matches.length],
    ['Unreliable goal minutes (saved set should be 0)', unreliableGoalMinutes],
    ['With prediction', withPrediction.length],
    ['HITs', hits.length],
    ['MISSes', misses.length],
    ['Hit Rate', withPrediction.length > 0 ? `${((hits.length / withPrediction.length) * 100).toFixed(1)}%` : 'N/A'],
    ['', ''],
    ['--- By Stats Level ---', ''],
  ];

  for (const level of ['full', 'advanced', 'basic', 'minimal']) {
    const group = analyzed.filter(m => m.statsClassification?.statsLevel === level);
    const gPred = group.filter(m => m.modelPrediction?.bet && m.modelPrediction.bet !== 'SKIP');
    const gHits = gPred.filter(m => m.result?.label === 'HIT');
    rows.push([
      `${level}: analyzed`,
      group.length,
    ]);
    rows.push([
      `${level}: hit rate`,
      gPred.length > 0 ? `${(gHits.length / gPred.length * 100).toFixed(1)}% (${gHits.length}/${gPred.length})` : 'N/A',
    ]);
  }

  rows.push(['', '']);
  rows.push(['--- By Score Category ---', '']);

  const scoreGroups = {};
  for (const m of matches) {
    const k = `${m.finalScore.home}:${m.finalScore.away}`;
    if (!scoreGroups[k]) scoreGroups[k] = [];
    scoreGroups[k].push(m);
  }
  for (const [score, group] of Object.entries(scoreGroups).sort((a, b) => b[1].length - a[1].length)) {
    const gPred = group.filter((m) => m.modelPrediction?.bet && m.modelPrediction.bet !== 'SKIP');
    const gHits = gPred.filter((m) => m.result?.label === 'HIT');
    rows.push([`Score ${score}`, `${group.length} matches, ${gHits.length}/${gPred.length} hits`]);
  }

  rows.push(['', '']);
  rows.push(['--- Stat Group Correlation (avg for HIT vs MISS) ---', '']);

  for (const [groupName, metrics] of Object.entries(GROUPS)) {
    for (const metric of metrics) {
      const hitVals = hits.map(m => (m.stats?.secondHalf?.sum || m.stats?.overall?.sum || {})[metric]).filter(v => v != null);
      const missVals = misses.map(m => (m.stats?.secondHalf?.sum || m.stats?.overall?.sum || {})[metric]).filter(v => v != null);
      const avgHit = hitVals.length > 0 ? (hitVals.reduce((a, b) => a + b, 0) / hitVals.length).toFixed(2) : '-';
      const avgMiss = missVals.length > 0 ? (missVals.reduce((a, b) => a + b, 0) / missVals.length).toFixed(2) : '-';
      if (hitVals.length > 0 || missVals.length > 0) {
        rows.push([`${groupName}/${metric}`, `HIT avg=${avgHit} | MISS avg=${avgMiss}`]);
      }
    }
  }

  for (const [label, value] of rows) {
    ws.addRow({ metric: label, value });
  }
}

module.exports = { exportToExcel };
