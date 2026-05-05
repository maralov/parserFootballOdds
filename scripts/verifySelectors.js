// Перевіряє чи живі селектори wcl-* для парсера статистики на flashscore.
// Запуск: node scripts/verifySelectors.js [<desktopUrl> ...]
const { launchBrowser, pickUserAgent } = require('../src/browser');
const { applyResourceBlocking } = require('../src/scrapeDesktopStats');

const DEFAULT_URLS = [
  // Низька ліга — Tercera KIFF (з поточного скрапу, де old=0/any=0)
  'https://www.flashscore.ua/match/soccer/ad-san-juan-xSsBpgog/beti-kozkor-lQDvAFvj/?mid=b32D2kqK',
  // Будь-яка топ-ліга з активним матчем — підставляється з live feed
];

async function probe(page, url) {
  const out = { url, error: null };
  // Будуємо URL так само як scrapeDesktopStats: чистимо path від summary*, додаємо suffix, ?mid=
  const u = new URL(url);
  const cleanPath = u.pathname.replace(/\/$/, '').replace(/\/?(summary.*)?$/, '');
  const basePath = `${u.origin}${cleanPath}`;
  const mid = u.searchParams.get('mid');
  const stats = [
    `${basePath}/summary/stats/overall/?mid=${mid}`,
    `${basePath}/summary/stats/2nd-half/?mid=${mid}`,
  ];
  for (const u of stats) {
    const e = { endpoint: u };
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await new Promise((r) => setTimeout(r, 2500));
      e.counts = await page.evaluate(() => ({
        wcl_statistics: document.querySelectorAll('[data-testid="wcl-statistics"]').length,
        wcl_category: document.querySelectorAll('[data-testid="wcl-statistics-category"]').length,
        wcl_value: document.querySelectorAll('[data-testid="wcl-statistics-value"]').length,
        wcl_text01: document.querySelectorAll('[data-testid="wcl-scores-simple-text-01"]').length,
        any_data_testid: document.querySelectorAll('[data-testid]').length,
        old_mobi: document.querySelectorAll('[class*="statisticsMobi"], .stat__row').length,
        any_stat: document.querySelectorAll('[class*="statistic"]').length,
        any_wcl: document.querySelectorAll('[class*="wcl-"]').length,
        bodyLen: (document.body?.textContent || '').length,
        title: document.title,
        hasNoStatsMsg: /немає|no statistic|undefined|порожня/i.test((document.body?.textContent || '').slice(0, 3000)),
      }));
      e.sampleTestids = await page.evaluate(() => {
        const names = new Set();
        document.querySelectorAll('[data-testid]').forEach((el) => {
          const v = el.getAttribute('data-testid');
          if (v) names.add(v);
        });
        return Array.from(names).slice(0, 30);
      });
      if (e.counts.wcl_statistics > 0) {
        e.firstRowSnippet = await page.evaluate(() => {
          const r = document.querySelector('[data-testid="wcl-statistics"]');
          return r ? r.outerHTML.slice(0, 600) : null;
        });
      }
    } catch (err) { e.error = err.message; }
    out[u.includes('overall') ? 'overall' : 'secondHalf'] = e;
  }
  return out;
}

(async () => {
  const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(pickUserAgent());
  await applyResourceBlocking(page);
  for (const u of urls) {
    console.log(`\n=== ${u} ===`);
    const r = await probe(page, u);
    console.log(JSON.stringify(r, null, 2));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
