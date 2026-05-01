const { LIVE_BASE_URL, LIVE_BASE_URL_ALT, LIVE_MIN_CANDIDATE_MINUTE } = require('./helpers/constants');
const { collectLiveMatches } = require('./providers/flashscoreMobileUa/liveSource');

async function scrapeLiveMatches(page, options = {}) {
  const minMinute = Number.isFinite(options.minMinute) ? options.minMinute : LIVE_MIN_CANDIDATE_MINUTE;
  try {
    const feeds = [LIVE_BASE_URL, LIVE_BASE_URL_ALT].filter(Boolean);
    const allMatches = [];
    const allSkipped = [];

    for (const url of feeds) {
      console.log('Opening:', url, `(minute >= ${minMinute}, 0:0 only)`);
      const { matches, skippedByMinute, health } = await collectLiveMatches(page, url, {}, minMinute);
      console.log(
        `Provider health [${url}]: rows=${health.totalRows}, 0:0 total=${health.totalZeroZero}, candidates=${matches.length}`
      );

      if (skippedByMinute.length > 0) {
        console.log(`  ⏸ 0:0 ще рано (< ${minMinute}'):`);
        for (const s of skippedByMinute) {
          console.log(`    ${s.minute}' ${s.home} - ${s.away} [${s.league}]`);
        }
      }

      for (const m of matches) {
        console.log(`  ✔ ${m.minute}' ${m.home} - ${m.away} [${m.league}] id=${m.id}`);
      }

      const badRows = health.missingId + health.missingMinute + health.missingUrl;
      if (health.totalRows > 0 && badRows / health.totalRows > 0.4) {
        console.log('⚠️ Live provider quality is low; parser fallback likely needed');
      }

      allMatches.push(...matches);
      allSkipped.push(...skippedByMinute);
    }

    const seen = new Set();
    const merged = [];
    for (const m of allMatches) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }

    // Найближча хвилина до вікна 60' серед пропущених матчів (для динамічного sleep)
    const nearestSkippedMinute = allSkipped.length > 0
      ? Math.max(...allSkipped.map((s) => s.minute))
      : null;

    return { matches: merged, nearestSkippedMinute };
  } catch (e) {
    console.log('LIVE MATCHES ERROR:', e.message);
    return { matches: [], nearestSkippedMinute: null };
  }
}

module.exports = scrapeLiveMatches;
