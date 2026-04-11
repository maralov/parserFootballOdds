const TIMEOUT = 20000;
const RETRIES = 1;

const {
  MOBILE_STAT_LABEL_MAP,
  parseMobileFlashscoreStatsFromDocument,
} = require('./parsers/mobileFlashscoreStats');

module.exports = async function scrapeMatchStats2H(page, matchDetailsUrl, matchId) {
  let url;
  if (matchDetailsUrl.includes('flashscore.mobi') || matchDetailsUrl.includes('m.flashscore.ua')) {
    const separator = matchDetailsUrl.includes('?') ? '&' : '?';
    url = `${matchDetailsUrl}${separator}t=stats`;
  } else {
    url = `${matchDetailsUrl}summary/stats/?mid=${matchId}`;
  }

  console.log(`  [stats] ${matchId} → ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  } catch (e) {
    console.log(`  [stats] ${matchId} page load failed: ${e.message}`);
    return { id: matchId, stats2h: null };
  }

  const isMobile = url.includes('flashscore.mobi') || url.includes('m.flashscore.ua');

  if (isMobile) {
    try {
      await page.waitForSelector('#statistics-mobi, [class*="statisticsMobi"]', { timeout: TIMEOUT });
      await page.waitForTimeout(1500);
    } catch (e) {
      console.log(`  [stats] ${matchId} no mobile stats container found`);
      return { id: matchId, stats2h: null };
    }
  }

  const stats = await page.evaluate(
    parseMobileFlashscoreStatsFromDocument,
    JSON.stringify(MOBILE_STAT_LABEL_MAP)
  );

  const metricsCount = stats ? Object.keys(stats.sum || {}).length : 0;
  console.log(`  [stats] ${matchId} → ${metricsCount} metrics parsed`);

  if (!stats || metricsCount === 0) {
    return { id: matchId, stats2h: null };
  }

  return { id: matchId, stats2h: stats };
};
