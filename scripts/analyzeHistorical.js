const { loadAllMatches } = require('../src/historical/analysis/loader');
const { analyzeAll } = require('../src/historical/analysis/analyzers');
const { detectTrends } = require('../src/historical/analysis/trends');
const { outputAll } = require('../src/historical/analysis/reporter');
const { blockA, blockC, blockD, blockG, blockH, derivedSummary } = require('../src/historical/analysis/researchAggregates');
const { windowOutcomes } = require('../src/historical/analysis/windowOutcomes');
const { flipProxies } = require('../src/historical/analysis/flipProxies');
const { saveResearchJSON, printResearchConsole } = require('../src/historical/analysis/researchReporter');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    jsonOnly: args.includes('--json-only'),
    noExcel: args.includes('--no-excel'),
    research: args.includes('--research'),
  };
}

(async () => {
  const opts = parseArgs();
  console.log('Historical analysis pipeline');

  const { matches, dateRange, totalFiles } = loadAllMatches();
  console.log(`Loaded ${matches.length} matches from ${totalFiles} files (${dateRange.from} — ${dateRange.to})`);

  if (matches.length === 0) {
    console.log('No matches to analyze.');
    return;
  }

  const analysis = analyzeAll(matches);
  const trends = detectTrends(analysis);
  await outputAll(analysis, trends, dateRange, opts);

  if (opts.research) {
    console.log('\nRunning research aggregates (blocks A–I)...');
    const research = {
      blockA: blockA(matches),
      blockB: windowOutcomes(matches),
      blockC: blockC(matches),
      blockD: blockD(matches),
      derivedIndices: derivedSummary(matches),
      blockG: blockG(matches),
      blockH: blockH(matches),
      blockI: flipProxies(matches),
    };
    const fp = saveResearchJSON(research, dateRange);
    console.log(`Research JSON: ${fp}`);
    if (!opts.jsonOnly) printResearchConsole(research);
  }

  console.log('\nDone.');
})();
