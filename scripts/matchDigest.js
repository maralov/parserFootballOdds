'use strict';
const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.resolve(__dirname, '../data/logs');

function sum(pair) {
  if (!pair) return '·';
  return ((pair.home || 0) + (pair.away || 0));
}

function totalGoals(final) {
  if (!final) return null;
  return (final.scoreHome || 0) + (final.scoreAway || 0);
}

// 'hit' | 'miss' | null  for a given track based on final result.
function matchOutcome(m, track) {
  const g = totalGoals(m.final);
  if (g == null) return null;
  if (track === 'tm05') return g === 0 ? 'hit' : 'miss';
  if (track === 'tb05') return g >= 1 ? 'hit' : 'miss';
  return null;
}

function digestMatch(m) {
  const lines = [];
  lines.push(`━━ ${m.homeTeam} vs ${m.awayTeam}  [${m.league} / ${m.country}]`);
  if (m.odds) lines.push(`   1X2: ${m.odds.home}/${m.odds.draw}/${m.odds.away}`);
  lines.push('   min | score | xG | SoT | Touch | Big | Y/R | poss');
  for (const s of (m.snapshots || [])) {
    const c = s.cumulative || {};
    const y = sum(c.yellowCards); const r = sum(c.redCards);
    const poss = s.ballPossession ? `${s.ballPossession.home}-${s.ballPossession.away}` : '·';
    lines.push(`   ${String(s.observedMinute ?? s.minute).padStart(3)} | `
      + `${s.scoreHome}:${s.scoreAway}   | ${sum(c.expectedGoalsXg)} | ${sum(c.shotsOnTarget)} | `
      + `${sum(c.touchesInOppositionBox)} | ${sum(c.bigChances)} | ${y}/${r} | ${poss}`);
  }
  if (m.final) lines.push(`   FINAL: ${m.final.scoreHome}:${m.final.scoreAway}`);
  for (const track of ['tm05', 'tb05']) {
    const p = m.predictions?.[track];
    if (!p) continue;
    const prob = p.pNoGoal ?? p.pGoal;
    lines.push(`   ${track}: phase=${p.phase} p=${prob ?? '·'} conf=${p.confidence ?? '·'} `
      + `ev=${p.evGate?.ev ?? '·'} → ${matchOutcome(m, track) ?? '?'}`);
  }
  return lines.join('\n');
}

function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--track') f.track = argv[++i];
    else if (argv[i] === '--outcome') f.outcome = argv[++i];
    else if (argv[i] === '--league') f.league = argv[++i];
    else if (!f.date) f.date = argv[i];
  }
  return f;
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  if (!f.date) { console.error('usage: matchDigest <YYYY-MM-DD> [--track tm05|tb05] [--outcome hit|miss] [--league <substr>]'); process.exit(1); }
  const file = path.join(DATA_ROOT, f.date, 'matches.json');
  if (!fs.existsSync(file)) { console.error(`no matches.json for ${f.date}`); process.exit(1); }
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  let matches = Object.values(store);
  if (f.league) matches = matches.filter(m => (m.league || '').toLowerCase().includes(f.league.toLowerCase()));
  if (f.track) matches = matches.filter(m => m.predictions?.[f.track]);
  if (f.outcome && f.track) matches = matches.filter(m => matchOutcome(m, f.track) === f.outcome);
  for (const m of matches) console.log(digestMatch(m) + '\n');
  console.log(`── ${matches.length} match(es) ──`);
}

if (require.main === module) main();

module.exports = { digestMatch, matchOutcome };
