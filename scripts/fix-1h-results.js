'use strict';

// One-off correction for 1HUNDER results recorded before the HT-detection bug
// fix. Walks each day's matches.json, re-fetches the real HT score from
// Flashscore, and rewrites predictions.tm05_1h.htOutcome + tg-outbox result.hit
// to match reality. No Telegram messages are sent.
//
//   node scripts/fix-1h-results.js 2026-06-11 2026-06-12 2026-06-13

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const { fetchResilient }    = require('../src/fetcher/resilientFetcher');
const { buildLiveStatsUrl } = require('../src/enrichment/helpers/urlBuilder');
const { parseLiveHeader }   = require('../src/tracker/parsers/liveHeaderParser');

const ROOT = path.resolve(__dirname, '..');

function readJson(file)        { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

async function fetchHt(matchId) {
  const { html } = await fetchResilient(buildLiveStatsUrl(matchId));
  const h = parseLiveHeader(html);
  return {
    htScore:    h.htScore,
    isFinished: h.isFinished,
    statusText: h.statusText,
    scoreHome:  h.scoreHome,
    scoreAway:  h.scoreAway,
  };
}

async function fixDay(day) {
  const matchesFile = path.join(ROOT, 'data', 'logs', day, 'matches.json');
  const outboxFile  = path.join(ROOT, 'data', 'logs', day, 'tg-outbox.json');
  if (!fs.existsSync(matchesFile)) {
    console.log(`[${day}] no matches.json — skip`);
    return;
  }

  const matches = readJson(matchesFile);
  const outbox  = fs.existsSync(outboxFile) ? readJson(outboxFile) : [];

  const candidates = Object.entries(matches).filter(([, m]) => m?.predictions?.tm05_1h?.htOutcome);
  console.log(`[${day}] candidates with htOutcome: ${candidates.length}`);

  let changed = 0;
  for (const [id, m] of candidates) {
    const stored = m.predictions.tm05_1h.htOutcome;
    let real;
    try {
      real = await fetchHt(id);
    } catch (err) {
      console.log(`  ${id}  FETCH_ERR  ${err.message}`);
      continue;
    }

    if (!real.htScore) {
      console.log(`  ${id}  NO_HT_PARENTHETICAL  status="${real.statusText}" score=${real.scoreHome}:${real.scoreAway} — skip`);
      continue;
    }

    const realScore = `${real.htScore.home}:${real.htScore.away}`;
    const realDry   = (real.htScore.home + real.htScore.away) === 0;

    if (stored.score === realScore && stored.dry === realDry) {
      console.log(`  ${id}  OK  ${realScore}`);
      continue;
    }

    const tag = stored.dry && !realDry ? 'FALSE-HIT' : (!stored.dry && realDry ? 'FALSE-MISS' : 'SCORE-DIFF');
    console.log(`  ${id}  ${tag}  stored=${stored.score}(dry=${stored.dry})  real=${realScore}(dry=${realDry})  ${m.homeTeam} - ${m.awayTeam}`);

    m.predictions.tm05_1h.htOutcome = {
      ...stored,
      score:           realScore,
      dry:             realDry,
      correctedAt:     new Date().toISOString(),
      correctedFrom:   { score: stored.score, dry: stored.dry },
    };

    const rec = outbox.find((r) => r.matchId === id && r.decisionKey === 'tm05_1h');
    if (rec) {
      rec.result = {
        ...rec.result,
        hit:           realDry,
        correctedAt:   new Date().toISOString(),
        correctedFrom: { hit: rec.result?.hit ?? null },
      };
    }

    changed += 1;
  }

  if (changed > 0) {
    writeJson(matchesFile, matches);
    if (fs.existsSync(outboxFile)) writeJson(outboxFile, outbox);
    console.log(`[${day}] wrote ${changed} corrections`);
  } else {
    console.log(`[${day}] no changes`);
  }
}

(async () => {
  const days = process.argv.slice(2);
  if (!days.length) {
    console.error('Usage: node scripts/fix-1h-results.js YYYY-MM-DD [...]');
    process.exit(1);
  }
  for (const d of days) await fixDay(d);
})();
