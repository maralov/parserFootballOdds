const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const REPORTS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'historical', 'reports');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveJSON(analysis, trends, dateRange) {
  ensureDir(REPORTS_DIR);
  const fp = path.join(REPORTS_DIR, 'analysis_summary.json');
  const out = { dateRange, ...analysis, trends };
  fs.writeFileSync(fp, JSON.stringify(out, null, 2), 'utf8');
  return fp;
}

function printConsole(analysis, trends) {
  const g = analysis.global;
  console.log('\n' + '='.repeat(70));
  console.log('ANALYSIS SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total matches: ${g.total}`);
  console.log(`  Dry rate: ${g.dryRate}%`);
  console.log(`  Late goal rate: ${g.lateGoalRate}%`);
  console.log(`  Model hit rate: ${g.model.hitRate}% (${g.model.hits}/${g.model.predictions})`);
  console.log(`  OVER: ${g.model.overCount} | UNDER: ${g.model.underCount} | SKIP: ${g.model.skipCount}`);
  console.log(`  Goals by range: 60-70: ${g.goalsByTimeRange['60-70']} | 70-80: ${g.goalsByTimeRange['70-80']} | 80-90+: ${g.goalsByTimeRange['80-90+']}`);

  printGroupTable('BY COUNTRY (top 15)', analysis.byCountry, 15);
  printGroupTable('BY LEAGUE (top 15)', analysis.byLeague, 15);
  printGroupTable('BY FAVORITE', analysis.byFavorite);
  printGroupTable('BY DRAW PROB', analysis.byDrawProb);
  printGroupTable('BY BALANCE', analysis.byBalance);
  printGroupTable('BY CONFIDENCE', analysis.byConfidence);
  printGroupTable('BY STATS LEVEL', analysis.byStatsLevel);
  printGroupTable('BY HAS XG', analysis.byHasXG);

  console.log('\n' + '-'.repeat(70));
  console.log('MODEL BY BET TYPE');
  console.log('-'.repeat(70));
  const bt = g.model.byBetType;
  console.log(`  OVER_0_5:  ${bt.OVER_0_5.count} preds, ${bt.OVER_0_5.hits} HIT, ${bt.OVER_0_5.misses} MISS, hit rate ${bt.OVER_0_5.hitRate}%`);
  console.log(`  UNDER_0_5: ${bt.UNDER_0_5.count} preds, ${bt.UNDER_0_5.hits} HIT, ${bt.UNDER_0_5.misses} MISS, hit rate ${bt.UNDER_0_5.hitRate}%`);
  console.log(`  SKIP:      ${bt.SKIP.count} matches, late goal ${bt.SKIP.actualLateGoalRate}%, dry ${bt.SKIP.actualDryRate}%`);

  console.log('\n' + '-'.repeat(70));
  console.log('MODEL BY CONFIDENCE');
  console.log('-'.repeat(70));
  for (const [level, s] of Object.entries(g.model.byConfidence)) {
    if (s.count === 0) continue;
    console.log(`  ${level}: ${s.count} preds, HIT ${s.hits} MISS ${s.misses}, hit rate ${s.hitRate}%, over ${s.overCount} under ${s.underCount}`);
  }

  if (trends.length > 0) {
    console.log('\n' + '-'.repeat(70));
    console.log(`TRENDS (${trends.length})`);
    console.log('-'.repeat(70));
    for (const t of trends) {
      console.log(`  [${t.dimension}] ${t.group}: ${t.type} -- ${t.detail} (n=${t.n})`);
    }
  }
}

function printGroupTable(title, grouped, topN) {
  const entries = Object.entries(grouped)
    .sort((a, b) => b[1].total - a[1].total);
  const shown = topN ? entries.slice(0, topN) : entries;

  console.log('\n' + '-'.repeat(70));
  console.log(title);
  console.log('-'.repeat(70));
  console.log(
    pad('Group', 32) + pad('N', 5) + pad('Dry%', 7) + pad('Late%', 7) +
    pad('Hit%', 7) + pad('Preds', 6) + pad('HIT', 5) + pad('MISS', 5)
  );

  for (const [key, s] of shown) {
    console.log(
      pad(key.slice(0, 31), 32) +
      pad(String(s.total), 5) +
      pad(s.dryRate + '%', 7) +
      pad(s.lateGoalRate + '%', 7) +
      pad(s.model.hitRate + '%', 7) +
      pad(String(s.model.predictions), 6) +
      pad(String(s.model.hits), 5) +
      pad(String(s.model.misses), 5)
    );
  }

  if (topN && entries.length > topN) {
    console.log(`  ... and ${entries.length - topN} more`);
  }
}

function pad(str, len) {
  return String(str).padEnd(len);
}

async function saveExcel(analysis, trends, dateRange) {
  ensureDir(REPORTS_DIR);
  const fp = path.join(REPORTS_DIR, `analysis_report_${dateRange.from}_${dateRange.to}.xlsx`);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ParserFootballOdds';

  buildOverviewSheet(wb.addWorksheet('Overview'), analysis);
  buildDimensionSheet(wb.addWorksheet('Countries'), analysis.byCountry);
  buildDimensionSheet(wb.addWorksheet('Leagues'), analysis.byLeague);
  buildDimensionSheet(wb.addWorksheet('OddsGroups'), mergeDimensions(analysis, ['byFavorite', 'byDrawProb', 'byBalance']));
  buildConfidenceSheet(wb.addWorksheet('Confidence'), analysis.global.model.byConfidence);
  buildDimensionSheet(wb.addWorksheet('StatsLevel'), mergeDimensions(analysis, ['byStatsLevel', 'byHasXG', 'byHasXGOT']));
  buildTrendsSheet(wb.addWorksheet('Trends'), trends);

  await wb.xlsx.writeFile(fp);
  return fp;
}

function mergeDimensions(analysis, keys) {
  const merged = {};
  for (const k of keys) {
    if (!analysis[k]) continue;
    for (const [name, stats] of Object.entries(analysis[k])) {
      merged[`${k.replace('by', '')}:${name}`] = stats;
    }
  }
  return merged;
}

function buildOverviewSheet(ws, analysis) {
  const g = analysis.global;
  ws.columns = [
    { header: 'Metric', key: 'metric', width: 35 },
    { header: 'Value', key: 'value', width: 20 },
  ];
  styleHeader(ws);

  const rows = [
    ['Total matches', g.total],
    ['Dry (0:0)', g.dry],
    ['With goal after 60', g.withGoalAfter60],
    ['Dry rate', `${g.dryRate}%`],
    ['Late goal rate', `${g.lateGoalRate}%`],
    ['Avg goals after 60', g.avgGoalsAfter60],
    ['', ''],
    ['Goals in 60-70 range', g.goalsByTimeRange['60-70']],
    ['Goals in 70-80 range', g.goalsByTimeRange['70-80']],
    ['Goals in 80-90+ range', g.goalsByTimeRange['80-90+']],
    ['Matches with goal 60-70', `${g.goalsByTimeRateOfMatches['60-70']}%`],
    ['Matches with goal 70-80', `${g.goalsByTimeRateOfMatches['70-80']}%`],
    ['Matches with goal 80-90+', `${g.goalsByTimeRateOfMatches['80-90+']}%`],
    ['', ''],
    ['--- Model ---', ''],
    ['Predictions', g.model.predictions],
    ['OVER_0_5', g.model.overCount],
    ['UNDER_0_5', g.model.underCount],
    ['SKIP', g.model.skipCount],
    ['HITs', g.model.hits],
    ['MISSes', g.model.misses],
    ['Hit rate', `${g.model.hitRate}%`],
    ['', ''],
    ['OVER hit rate', `${g.model.byBetType.OVER_0_5.hitRate}%`],
    ['UNDER hit rate', `${g.model.byBetType.UNDER_0_5.hitRate}%`],
    ['', ''],
    ['--- Score Distribution ---', ''],
  ];

  const scores = Object.entries(g.scoreDistribution).sort((a, b) => b[1] - a[1]);
  for (const [score, count] of scores) {
    rows.push([`Score ${score}`, `${count} (${(count / g.total * 100).toFixed(1)}%)`]);
  }

  for (const [label, value] of rows) {
    ws.addRow({ metric: label, value });
  }
}

function buildDimensionSheet(ws, grouped) {
  ws.columns = [
    { header: 'Group', key: 'group', width: 35 },
    { header: 'Matches', key: 'total', width: 10 },
    { header: 'Dry', key: 'dry', width: 8 },
    { header: 'Late Goal', key: 'lateGoal', width: 10 },
    { header: 'Dry%', key: 'dryRate', width: 8 },
    { header: 'LateGoal%', key: 'lateGoalRate', width: 10 },
    { header: 'AvgGoals60+', key: 'avgGoals', width: 12 },
    { header: 'Goals 60-70', key: 'g6070', width: 10 },
    { header: 'Goals 70-80', key: 'g7080', width: 10 },
    { header: 'Goals 80-90+', key: 'g8090', width: 11 },
    { header: 'Predictions', key: 'preds', width: 11 },
    { header: 'HITs', key: 'hits', width: 7 },
    { header: 'MISSes', key: 'misses', width: 8 },
    { header: 'HitRate%', key: 'hitRate', width: 9 },
    { header: 'Over#', key: 'overCount', width: 7 },
    { header: 'Under#', key: 'underCount', width: 8 },
  ];
  styleHeader(ws);

  const sorted = Object.entries(grouped).sort((a, b) => b[1].total - a[1].total);
  for (const [key, s] of sorted) {
    ws.addRow({
      group: key,
      total: s.total,
      dry: s.dry,
      lateGoal: s.withGoalAfter60,
      dryRate: s.dryRate,
      lateGoalRate: s.lateGoalRate,
      avgGoals: s.avgGoalsAfter60,
      g6070: s.goalsByTimeRange['60-70'],
      g7080: s.goalsByTimeRange['70-80'],
      g8090: s.goalsByTimeRange['80-90+'],
      preds: s.model.predictions,
      hits: s.model.hits,
      misses: s.model.misses,
      hitRate: s.model.hitRate,
      overCount: s.model.overCount,
      underCount: s.model.underCount,
    });
  }
}

function buildConfidenceSheet(ws, byConf) {
  ws.columns = [
    { header: 'Confidence', key: 'conf', width: 14 },
    { header: 'Predictions', key: 'count', width: 12 },
    { header: 'HITs', key: 'hits', width: 8 },
    { header: 'MISSes', key: 'misses', width: 8 },
    { header: 'HitRate%', key: 'hitRate', width: 10 },
    { header: 'Over#', key: 'overCount', width: 8 },
    { header: 'Under#', key: 'underCount', width: 8 },
  ];
  styleHeader(ws);

  for (const level of ['high', 'medium', 'low', 'none']) {
    const s = byConf[level];
    if (!s || s.count === 0) continue;
    ws.addRow({
      conf: level,
      count: s.count,
      hits: s.hits,
      misses: s.misses,
      hitRate: s.hitRate,
      overCount: s.overCount,
      underCount: s.underCount,
    });
  }
}

function buildTrendsSheet(ws, trends) {
  ws.columns = [
    { header: 'Dimension', key: 'dimension', width: 14 },
    { header: 'Group', key: 'group', width: 35 },
    { header: 'Type', key: 'type', width: 20 },
    { header: 'Detail', key: 'detail', width: 55 },
    { header: 'N', key: 'n', width: 6 },
  ];
  styleHeader(ws);

  for (const t of trends) {
    ws.addRow(t);
  }
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.alignment = { horizontal: 'center' };
  if (ws.columns.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  }
}

async function outputAll(analysis, trends, dateRange, opts = {}) {
  const jsonPath = saveJSON(analysis, trends, dateRange);
  console.log(`JSON summary: ${jsonPath}`);

  if (!opts.jsonOnly) {
    printConsole(analysis, trends);
  }

  if (!opts.noExcel) {
    const excelPath = await saveExcel(analysis, trends, dateRange);
    console.log(`\nExcel report: ${excelPath}`);
  }
}

module.exports = { outputAll, saveJSON, saveExcel, printConsole };
