/**
 * Швидка перевірка парсера LIVE (без worker / Telegram).
 * Використання: node scripts/verifyLiveParser.js
 */
require('dotenv').config();
const { launchBrowser } = require('../src/browser');
const { collectLiveMatches } = require('../src/providers/flashscoreMobileUa/liveSource');
const { USER_AGENT, LIVE_BASE_URL, LIVE_MIN_CANDIDATE_MINUTE } = require('../src/helpers/constants');

(async () => {
  const url = process.argv[2] || LIVE_BASE_URL;
  console.log('verifyLiveParser:', url, `minMinute=${LIVE_MIN_CANDIDATE_MINUTE}`);

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#score-data', { timeout: 20000 });
    await page.waitForTimeout(1200);

    const debug = process.env.LIVE_PARSER_DEBUG === '1';
    if (debug) {
      const samples = await page.evaluate(() => {
        const scoreData = document.getElementById('score-data');
        if (!scoreData) return [];
        const lines = scoreData.innerHTML.split(/<br\s*\/?>/i);
        const out = [];
        for (const line of lines) {
          const t = line.trim();
          if (!/\/match\//.test(t) || !/\blive\b/i.test(t)) continue;
          const w = document.createElement('div');
          w.innerHTML = t;
          const a = w.querySelector('a[href*="/match/"]');
          if (!a) continue;
          const lt = (a.textContent || '').trim().replace(/\s+/g, '');
          if (!/^\d+:\d+$/.test(lt)) continue;
          const span = w.querySelector('span.live');
          out.push({
            text: (w.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            linkText: lt,
            spanLive: span ? span.textContent.trim().slice(0, 50) : null,
          });
          if (out.length >= 8) break;
        }
        return out;
      });
      console.log('DEBUG sample live score rows:', JSON.stringify(samples, null, 2));
    }

    const { matches, skippedByMinute, health } = await collectLiveMatches(page, url, { skipNavigation: true });
    console.log('health:', health);
    console.log('candidates (>= min):', matches.length);
    matches.slice(0, 8).forEach((m) => {
      console.log(`  ✔ ${m.minute}' ${m.home} - ${m.away} [${m.league}] id=${m.id}`);
    });
    if (matches.length > 8) console.log(`  ... +${matches.length - 8} more`);
    console.log('skipped (< min):', skippedByMinute.length);
    skippedByMinute.slice(0, 5).forEach((s) => {
      console.log(`  ⏸ ${s.minute}' ${s.home} - ${s.away}`);
    });
    if (skippedByMinute.length > 5) console.log(`  ... +${skippedByMinute.length - 5} more`);

    if (health.missingMinute > health.totalZeroZero) {
      console.error('WARN: missingMinute > totalZeroZero (unexpected)');
      process.exitCode = 1;
      return;
    }
    console.log('\nOK: parse без помилок APOST / evaluate.');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
