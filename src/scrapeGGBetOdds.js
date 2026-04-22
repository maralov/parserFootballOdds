const GGBET_LIVE_URL = 'https://ggbet.ua/uk-ua/live?sportId=football';
const PAGE_TIMEOUT = 20000;
const LOAD_WAIT_MS = 3500;

const TEAM_MATCH_THRESHOLD = 0.4; // Jaccard ≥ 0.4 → збіг

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/і/g, 'i').replace(/ї/g, 'i').replace(/є/g, 'e').replace(/ґ/g, 'g');
}

/**
 * Jaccard similarity по токенах (слова ≥ 3 символів після нормалізації).
 * Стійкий до порядку слів, пропущених FC/FK, різної транслітерації.
 */
function teamsSimilar(a, b) {
  const tokens = (s) => new Set((norm(s).match(/[a-zа-я0-9]{3,}/g) || []));
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union >= TEAM_MATCH_THRESHOLD;
}

/**
 * Шукає матч на live-сторінці GGBet.
 * Повертає { url, home, away } або null.
 */
async function findMatchOnLivePage(page, home, away) {
  try {
    await page.goto(GGBET_LIVE_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(LOAD_WAIT_MS);
  } catch (e) {
    console.log(`  [ggbet] Live page load error: ${e.message}`);
    return null;
  }

  return await page.evaluate((home, away, threshold) => {
    function norm(s) {
      return String(s || '').toLowerCase()
        .replace(/і/g, 'i').replace(/ї/g, 'i').replace(/є/g, 'e').replace(/ґ/g, 'g');
    }
    function similar(a, b) {
      const tokens = (s) => new Set((norm(s).match(/[a-zа-я0-9]{3,}/g) || []));
      const ta = tokens(a), tb = tokens(b);
      if (!ta.size || !tb.size) return false;
      const inter = [...ta].filter(t => tb.has(t)).length;
      const union = new Set([...ta, ...tb]).size;
      return inter / union >= threshold;
    }

    const links = document.querySelectorAll('a[href*="/uk-ua/sports/match/"]');
    for (const link of links) {
      const competitors = link.querySelectorAll('[data-test="competitor-title"]');
      if (competitors.length < 2) continue;
      const h = competitors[0].textContent.trim();
      const a = competitors[1].textContent.trim();
      if (similar(h, home) && similar(a, away)) {
        const href = link.getAttribute('href');
        return { url: 'https://ggbet.ua' + href, home: h, away: a };
      }
    }
    return null;
  }, home, away, TEAM_MATCH_THRESHOLD);
}

/**
 * На сторінці матчу шукає кнопки ТМ/ТБ 0.5 ("Менше 0.5" / "Більше 0.5").
 * Повертає { underOdds, overOdds } або null.
 */
async function getTotal05Odds(page, matchUrl) {
  try {
    await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(LOAD_WAIT_MS);
  } catch (e) {
    console.log(`  [ggbet] Match page load error: ${e.message}`);
    return null;
  }

  return await page.evaluate(() => {
    let underOdds = null;
    let overOdds = null;

    document.querySelectorAll('[data-test="odd-button"]').forEach((btn) => {
      const titleEl = btn.querySelector('[data-test="odd-button__title"]');
      const resultEl = btn.querySelector('[data-test="odd-button__result"]');
      if (!titleEl || !resultEl) return;

      const title = titleEl.textContent.trim();
      const val = parseFloat(resultEl.textContent.replace(',', '.').trim());
      if (!Number.isFinite(val) || val <= 1) return;

      if (/менше\s*0[,.]5/i.test(title)) underOdds = val;
      if (/більше\s*0[,.]5/i.test(title)) overOdds = val;
    });

    return underOdds !== null || overOdds !== null ? { underOdds, overOdds } : null;
  });
}

/**
 * Головна функція: знаходить матч на GGBet і повертає кф ТМ/ТБ 0.5.
 * @returns {{ url: string, underOdds: number|null, overOdds: number|null } | null}
 */
async function scrapeGGBetOdds(page, home, away) {
  const matchInfo = await findMatchOnLivePage(page, home, away);
  if (!matchInfo) {
    console.log(`  [ggbet] Not found: ${home} - ${away}`);
    return null;
  }
  console.log(`  [ggbet] Found: ${matchInfo.home} - ${matchInfo.away}`);

  const odds = await getTotal05Odds(page, matchInfo.url);
  if (!odds) {
    console.log(`  [ggbet] 0.5 odds not found on match page`);
    return { url: matchInfo.url, underOdds: null, overOdds: null };
  }

  console.log(`  [ggbet] ТМ=${odds.underOdds ?? '-'} | ТБ=${odds.overOdds ?? '-'}`);
  return { url: matchInfo.url, underOdds: odds.underOdds, overOdds: odds.overOdds };
}

module.exports = { scrapeGGBetOdds };
