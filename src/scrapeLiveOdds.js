const TIMEOUT = 15000;

/**
 * Коефіцієнти 1X2 з мобільної сторінки огляду матчу (як у matchDetailSource).
 */
async function fetchOdds1X2(page, matchDetailsUrl) {
  const base = String(matchDetailsUrl || '').split('?')[0];
  if (!base) return { odds1X2: null, error: 'no_url' };

  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(900);
    const odds1X2 = await page.evaluate(() => {
      const oddsEl = document.querySelector('p.odds-detail, p[class*="odds-detail"]');
      if (!oddsEl) return null;
      const links = oddsEl.querySelectorAll('a');
      if (links.length >= 3) {
        const vals = Array.from(links).map((a) => parseFloat(a.textContent.trim()));
        if (vals.every((v) => !Number.isNaN(v) && v > 0)) {
          return { home: vals[0], draw: vals[1], away: vals[2] };
        }
      }
      const txt = oddsEl.textContent || '';
      const parts = txt.split('|').map((s) => parseFloat(s.trim())).filter((v) => !Number.isNaN(v) && v > 0);
      if (parts.length >= 3) {
        return { home: parts[0], draw: parts[1], away: parts[2] };
      }
      return null;
    });
    return { odds1X2 };
  } catch (e) {
    return { odds1X2: null, error: e.message };
  }
}

module.exports = { fetchOdds1X2 };
