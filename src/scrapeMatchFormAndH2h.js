const { parseFormH2hFromCommentaryInnerHtml } = require('./parsers/formH2hParser');
const { LIVE_FORM_H2H_MAX_FORM_ROWS, LIVE_FORM_H2H_MAX_H2H_ROWS } = require('./helpers/constants');

const TIMEOUT = 22000;

/**
 * Завантажує m.flashscore …/match/{id}/?t=h2h і парсить форму + очні.
 * @param {import('puppeteer').Page} page
 * @param {string} matchId
 * @param {{ home: string, away: string }} teams
 */
async function scrapeMatchFormAndH2h(page, matchId, teams) {
  const url = `https://m.flashscore.ua/match/${matchId}/?t=h2h`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(600);
    try {
      await page.waitForSelector('#detail-tab-content', { timeout: 8000 });
    } catch {
      /* інколи контент уже в DOM */
    }

    const inner = await page.evaluate(() => {
      const el = document.querySelector('#commentary-mobi');
      return el ? el.innerHTML : '';
    });

    const parsed = parseFormH2hFromCommentaryInnerHtml(inner, teams.home, teams.away, {
      maxForm: LIVE_FORM_H2H_MAX_FORM_ROWS,
      maxH2h: LIVE_FORM_H2H_MAX_H2H_ROWS,
    });
    if (!parsed.parseOk) {
      console.log(`  [form-h2h] ${matchId}: ${parsed.error || 'parse_failed'}`);
    } else {
      console.log(
        `  [form-h2h] ${matchId}: home n=${parsed.formHome.length} away n=${parsed.formAway.length} h2h n=${parsed.h2hMutual.length}`
      );
    }
    return { ...parsed, fetchedAt: new Date().toISOString() };
  } catch (e) {
    console.log(`  [form-h2h] ${matchId} err: ${e.message}`);
    return {
      parseOk: false,
      error: e.message || 'goto_failed',
      formHome: [],
      formAway: [],
      h2hMutual: [],
      aggregates: { home: null, away: null, mutual: null },
      fetchedAt: new Date().toISOString(),
    };
  }
}

module.exports = { scrapeMatchFormAndH2h };
