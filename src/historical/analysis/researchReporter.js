const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'historical', 'reports');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveResearchJSON(research, dateRange) {
  ensureDir(REPORTS_DIR);
  const fp = path.join(REPORTS_DIR, 'model_research_summary.json');
  const out = {
    meta: {
      dateRange,
      generatedAt: new Date().toISOString(),
      dataLimitations: [
        'Model was evaluated once at LIVE_MIN_CANDIDATE_MINUTE, not per-window.',
        'Derived indices use end-of-match stats, not mid-match snapshots.',
        'Flip proxies are approximations until live snapshot pipeline is built.',
      ],
    },
    ...research,
  };
  fs.writeFileSync(fp, JSON.stringify(out, null, 2), 'utf8');
  return fp;
}

function printResearchConsole(research) {
  const a = research.blockA;
  console.log('\n' + '='.repeat(70));
  console.log('MODEL RESEARCH SUMMARY');
  console.log('='.repeat(70));

  console.log('\n--- Block A: Outcomes ---');
  console.log(`  Matches: ${a.matchesCount} | Dry: ${a.dryCount} (${a.pUnder05}) | Late Goal: ${a.lateGoalCount} (${a.pOver05})`);
  console.log(`  Goal after 60: ${a.pctWithGoalAfter60}% | after 70: ${a.pctWithGoalAfter70}% | after 80: ${a.pctWithGoalAfter80}%`);
  console.log(`  Avg goals after 60: ${a.avgGoalsAfter60}`);
  console.log(`  Scores: 0:0=${a.scoreGroupsPct['0:0']}% | 1:0/0:1=${a.scoreGroupsPct['1:0_0:1']}% | 1:1=${a.scoreGroupsPct['1:1']}% | 2:0/0:2=${a.scoreGroupsPct['2:0_0:2']}%`);

  console.log('\n--- Block B: Time Windows ---');
  const b = research.blockB;
  for (const [w, s] of Object.entries(b.byFirstGoalWindow)) {
    console.log(`  ${w}: ${s.count} matches (${s.pctOfTotal}%) | model hit: ${s.model.hitRate}%`);
  }
  console.log('  Cumulative still-dry-at:');
  for (const [t, s] of Object.entries(b.cumulativeStillDryAt)) {
    console.log(`    @${t}': ${s.count} still dry → scored ${s.eventuallyScored} (${s.overRate}%) | dry ${s.eventuallyDry} (${s.underRate}%)`);
  }

  console.log('\n--- Block C: Stats Level (top) ---');
  const c = research.blockC;
  for (const [lv, s] of Object.entries(c.byLevel)) {
    console.log(`  ${lv}: ${s.count} | goal60 ${s.pctGoalAfter60}% | goal70 ${s.pctGoalAfter70}% | goal80 ${s.pctGoalAfter80}% | model ${s.model.hitRate}%`);
  }

  console.log('\n--- Block D: Raw metrics (dry vs lateGoal mean) ---');
  const d = research.blockD;
  for (const cat of Object.keys(d.dry)) {
    for (const metric of Object.keys(d.dry[cat])) {
      const dm = d.dry[cat][metric];
      const lm = d.lateGoal[cat][metric];
      if (dm.n === 0 && lm.n === 0) continue;
      console.log(`  ${cat}/${metric}: dry=${dm.mean ?? '-'} lateGoal=${lm.mean ?? '-'}`);
    }
  }

  console.log('\n--- Block E: Derived Indices (dry vs lateGoal) ---');
  const e = research.derivedIndices;
  for (const idx of Object.keys(e.dry)) {
    console.log(`  ${idx}: dry mean=${e.dry[idx].mean} | lateGoal mean=${e.lateGoal[idx].mean}`);
  }

  console.log('\n--- Block G: Market Context ---');
  const g = research.blockG;
  for (const dim of ['byFavorite', 'byDrawProb', 'byBalance']) {
    console.log(`  ${dim}:`);
    for (const [k, s] of Object.entries(g[dim])) {
      console.log(`    ${k}: ${s.count} | late ${s.lateGoalRate}% | dry ${s.dryRate}% | model ${s.model.hitRate}%`);
    }
  }

  console.log('\n--- Block H: Tournament Type ---');
  const h = research.blockH;
  for (const [type, s] of Object.entries(h)) {
    console.log(`  ${type}: ${s.count} | late ${s.lateGoalRate}% | dry ${s.dryRate}% | model ${s.model.hitRate}%`);
  }

  console.log('\n--- Block I: Flip Proxies ---');
  const i = research.blockI;
  console.log(`  Early dry profile: ${i.earlyDryProfile.total} matches, flip rate ${i.earlyDryProfile.flipRate}%`);
  console.log(`  Low pressure + high dry: ${i.lowPressureHighDry.total}, flip ${i.lowPressureHighDry.flipRate}%`);
  console.log(`  High pressure + low dry: ${i.highPressureLowDry.total}, goal rate ${i.highPressureLowDry.goalRate}%`);
}

module.exports = { saveResearchJSON, printResearchConsole };
