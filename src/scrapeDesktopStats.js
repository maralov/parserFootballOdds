const fs = require('fs');
const path = require('path');
const { toISO } = require('./helpers/date');
const {
  MOBILE_STAT_LABEL_MAP,
  parseMobileFlashscoreStatsFromDocument,
} = require('./parsers/mobileFlashscoreStats');

const TIMEOUT = 20000;
const DESKTOP_BASE = 'https://www.flashscore.ua/match';
const DOM_ALERT_BASE = path.join(__dirname, '..', 'data', 'logs');

/** Per-day файл алертів: data/logs/<YYYY-MM-DD>/dom_alerts.json. */
function getDomAlertFile() {
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(DOM_ALERT_BASE, today);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'dom_alerts.json');
}

const BLOCK_DOMAINS_RE = /google-analytics|googletagmanager|googlesyndication|doubleclick|facebook\.(net|com)|adservice|hotjar|segment\.io|amplitude|criteo|adsrvr|taboola|outbrain|adnxs|pubmatic|rubiconproject|openx|smartadserver|yandex\.ru\/metrika|mc\.yandex|mail\.ru\/counter|gemius|optad360/i;

// Помилки коли сторінку/таргет вже закрив зовнішній withTimeout — це не DOM проблема,
// тому такі винятки пропускаємо без алерту/дампу (щоб не засмічувати dom_alerts).
const PAGE_CLOSED_RE = /target closed|session closed|protocol error.*\b(page\.navigate|runtime\.callfunctionon|page has been closed)|most likely the page has been closed|browser has disconnected/i;
function isPageClosed(page, err) {
  try { if (page && typeof page.isClosed === 'function' && page.isClosed()) return true; } catch {}
  if (err && err.message && PAGE_CLOSED_RE.test(err.message)) return true;
  return false;
}

// page.evaluate не має власного таймауту і тримається protocolTimeout=120s.
// Якщо рендерер flashscore завис на важкому JS — один evaluate з'їсть весь зовнішній
// withTimeout(120s). Тому обгортаємо кожен evaluate своїм коротким race-таймаутом.
const EVALUATE_TIMEOUT_MS = 15000;
function evalWithTimeout(page, fnOrStr, ...args) {
  return Promise.race([
    page.evaluate(fnOrStr, ...args),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`page.evaluate timeout ${EVALUATE_TIMEOUT_MS}ms`)),
      EVALUATE_TIMEOUT_MS
    )),
  ]);
}

// goto з одним retry при Navigation timeout — перший хіт на flashscore інколи флапає,
// другий зазвичай проходить. Без цього втрачаємо весь матч.
async function gotoWithRetry(page, url, opts) {
  try {
    return await page.goto(url, opts);
  } catch (e) {
    if (/navigation timeout|net::err_/i.test(e.message) && !isPageClosed(page, e)) {
      return await page.goto(url, opts);
    }
    throw e;
  }
}

/**
 * Блокує важкі ресурси (images/media/fonts) та рекламно-аналітичні домени,
 * щоб уникнути зависання Runtime.callFunctionOn у важкому JS event loop flashscore.
 * Викликається один раз на page; повторно — no-op.
 */
/**
 * Зберігає HTML-дамп сторінки + метадані (URL, title, маркери антибота)
 * у data/logs/dom_dumps/ для post-mortem діагностики PAGE_ERROR.
 * Корисно для перевірки чи flashscore віддає captcha/challenge замість статистики.
 */
async function dumpPageHtml(page, matchId, endpointKey, errorMessage) {
  try {
    const dumpDir = path.join(__dirname, '..', 'data', 'logs', 'dom_dumps');
    if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeKey = String(endpointKey).replace(/[^a-z0-9]/gi, '_');
    const baseFile = `${ts}_${matchId}_${safeKey}`;

    let html = null;
    let url = null;
    let title = null;
    try { url = page.url(); } catch {}
    try { title = await Promise.race([page.title(), new Promise((_, r) => setTimeout(() => r(new Error('title-timeout')), 3000))]); } catch {}
    try { html = await Promise.race([page.content(), new Promise((_, r) => setTimeout(() => r(new Error('content-timeout')), 5000))]); } catch (e) { html = `<!-- content() failed: ${e.message} -->`; }

    const indicators = {
      hasCaptcha: /captcha|recaptcha|hcaptcha|cf-challenge|cloudflare|just a moment|imperva|_pxCaptcha|perimeterx/i.test(html || ''),
      isShort: (html || '').length < 5000,
      lengthBytes: (html || '').length,
    };

    const meta = { matchId, endpointKey, errorMessage, url, title, indicators, timestamp: new Date().toISOString() };
    fs.writeFileSync(path.join(dumpDir, `${baseFile}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');
    fs.writeFileSync(path.join(dumpDir, `${baseFile}.html`), html || '', 'utf8');

    // Чистимо старі дампи (тримаємо останні 30)
    const files = fs.readdirSync(dumpDir).filter((f) => f.endsWith('.html')).sort();
    if (files.length > 30) {
      for (const f of files.slice(0, files.length - 30)) {
        try { fs.unlinkSync(path.join(dumpDir, f)); } catch {}
        try { fs.unlinkSync(path.join(dumpDir, f.replace('.html', '.meta.json'))); } catch {}
      }
    }
    if (indicators.hasCaptcha) {
      console.log(`  ⚠ ANTIBOT detected on ${matchId} ${endpointKey} → dump: ${baseFile}.html`);
    }
  } catch {}
}

async function applyResourceBlocking(page) {
  if (page.__resourceBlockingApplied) return;
  page.__resourceBlockingApplied = true;
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      try {
        const type = req.resourceType();
        if (type === 'image' || type === 'media' || type === 'font') return req.abort();
        const url = req.url();
        if (BLOCK_DOMAINS_RE.test(url)) return req.abort();
        return req.continue();
      } catch { try { req.continue(); } catch {} }
    });
  } catch {
    page.__resourceBlockingApplied = false;
  }
}

const STAT_LABEL_MAP = {
  'очікувані голи (xg)': 'expectedGoalsXg',
  'expected goals (xg)': 'expectedGoalsXg',
  'ожидаемые голы (xg)': 'expectedGoalsXg',
  'володіння м\'ячем': 'ballPossession',
  'ball possession': 'ballPossession',
  'владение мячом': 'ballPossession',
  'удари': 'totalShots',
  'total shots': 'totalShots',
  'всего ударов': 'totalShots',
  'удари в площину': 'shotsOnTarget',
  'shots on target': 'shotsOnTarget',
  'удары в створ': 'shotsOnTarget',
  'гольові нагоди': 'bigChances',
  'big chances': 'bigChances',
  'голевые моменты': 'bigChances',
  'кутові удари': 'cornerKicks',
  'corner kicks': 'cornerKicks',
  'угловые': 'cornerKicks',
  'передачі': 'passes',
  'passes': 'passes',
  'передачи': 'passes',
  'жовті картки': 'yellowCards',
  'yellow cards': 'yellowCards',
  'желтые карточки': 'yellowCards',
  'червоні картки': 'redCards',
  'red cards': 'redCards',
  'красные карточки': 'redCards',
  'xg серед ударів у площну (xgot)': 'xgOnTargetXgot',
  'xg on target (xgot)': 'xgOnTargetXgot',
  'xg в створ (xgot)': 'xgOnTargetXgot',
  'удари повз ворота': 'shotsOffTarget',
  'shots off target': 'shotsOffTarget',
  'удары мимо': 'shotsOffTarget',
  'заблоковані удари': 'blockedShots',
  'blocked shots': 'blockedShots',
  'ударов заблокировано': 'blockedShots',
  'удари з меж штрафного майданчика': 'shotsInsideTheBox',
  'shots inside the box': 'shotsInsideTheBox',
  'удары из пределов штрафной': 'shotsInsideTheBox',
  'удари з-за меж штрафного майданчика': 'shotsOutsideTheBox',
  'shots outside the box': 'shotsOutsideTheBox',
  'удары из-за штрафной': 'shotsOutsideTheBox',
  'влучання в каркас воріт': 'hitTheWoodwork',
  'hit the woodwork': 'hitTheWoodwork',
  'попадание в штангу': 'hitTheWoodwork',
  'дотики в штрафн. майданчику суперника': 'touchesInOppositionBox',
  'touches in opposition box': 'touchesInOppositionBox',
  'touches in opp. box': 'touchesInOppositionBox',
  'касания мяча в штрафной соперника': 'touchesInOppositionBox',
  'точні розрізні передачі': 'accurateThroughPasses',
  'accurate through passes': 'accurateThroughPasses',
  'успешные передачи в разрез': 'accurateThroughPasses',
  'офсайди': 'offsides',
  'offsides': 'offsides',
  'офсайды': 'offsides',
  'штрафні удари': 'freeKicks',
  'free kicks': 'freeKicks',
  'штрафные': 'freeKicks',
  'довгі передачі': 'longPasses',
  'long passes': 'longPasses',
  'длинные передачи': 'longPasses',
  'передачі в останній третині': 'passesInFinalThird',
  'passes in final third': 'passesInFinalThird',
  'передачи в последней трети': 'passesInFinalThird',
  'кроси': 'crosses',
  'crosses': 'crosses',
  'навіси': 'crosses',
  'навесы': 'crosses',
  'очікувані асисти (xa)': 'expectedAssistsXa',
  'expected assists (xa)': 'expectedAssistsXa',
  'ожидаемые ассисты (xa)': 'expectedAssistsXa',
  'вкидання': 'throwIns',
  'throw-ins': 'throwIns',
  'вбрасывания': 'throwIns',
  'фоли': 'fouls',
  'fouls': 'fouls',
  'фолы': 'fouls',
  'підкати': 'tackles',
  'tackles': 'tackles',
  'відбори': 'tackles',
  'отборы': 'tackles',
  'виграні двобої': 'duelsWon',
  'duels won': 'duelsWon',
  'выиграно дуэлей': 'duelsWon',
  'вибивання': 'clearances',
  'clearances': 'clearances',
  'виноси': 'clearances',
  'выносы': 'clearances',
  'перехоплення': 'interceptions',
  'interceptions': 'interceptions',
  'перехваты': 'interceptions',
  'помилки, що призвели до удару': 'errorsLeadingToShot',
  'errors leading to shot': 'errorsLeadingToShot',
  'ошибки, приведшие к удару': 'errorsLeadingToShot',
  'помилки, що призвели до голу': 'errorsLeadingToGoal',
  'errors leading to goal': 'errorsLeadingToGoal',
  'ошибки, приведшие к голу': 'errorsLeadingToGoal',
  'сейви воротаря': 'goalkeeperSaves',
  'goalkeeper saves': 'goalkeeperSaves',
  'сэйвы вратаря': 'goalkeeperSaves',
  'xgot проти': 'xgotFaced',
  'xgot faced': 'xgotFaced',
  'xgot после ударов в створ': 'xgotFaced',
  'голам запобігнуто': 'goalsPrevented',
  'goals prevented': 'goalsPrevented',
  'предотвращённые голы': 'goalsPrevented',
  'предотвращенные голи': 'goalsPrevented',
};

function logDomAlert(matchId, alertType, details) {
  const entry = { matchId, alertType, details, timestamp: toISO() };
  console.log(`  ⚠ DOM ALERT [${matchId}]: ${alertType} — ${details}`);
  try {
    const file = getDomAlertFile();
    let alerts = [];
    if (fs.existsSync(file)) {
      try { alerts = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    }
    alerts.push(entry);
    // На один день лімітуємо менш агресивно — для post-mortem у поточному дні.
    if (alerts.length > 1000) alerts = alerts.slice(-500);
    fs.writeFileSync(file, JSON.stringify(alerts, null, 2), 'utf8');
  } catch {}
}

async function resolveDesktopUrl(page, matchId) {
  const shortUrl = `${DESKTOP_BASE}/${matchId}/`;
  try {
    await page.goto(shortUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    const finalUrl = page.url();
    if (finalUrl.includes('/match/') && finalUrl !== shortUrl) {
      return { desktopUrl: finalUrl, resolved: true };
    }
    return { desktopUrl: finalUrl, resolved: finalUrl.includes(matchId) };
  } catch (e) {
    return { desktopUrl: null, resolved: false, error: e.message };
  }
}

async function parseStatsFromPage(page, labelMapJSON) {
  return evalWithTimeout(page, (mapJson) => {
    const LABEL_MAP = JSON.parse(mapJson);
    const rows = document.querySelectorAll('[data-testid="wcl-statistics"]');

    const diagnostics = {
      rowCount: rows.length,
      selectorFound: rows.length > 0,
      parsedLabels: [],
      unmappedLabels: [],
    };

    if (rows.length === 0) {
      return { stats: null, diagnostics };
    }

    function parseVal(el) {
      if (!el) return 0;
      const bold = el.querySelector('[data-testid="wcl-scores-simple-text-01"]');
      const txt = (bold || el).textContent.trim();
      const pctMatch = txt.match(/^(\d+)%/);
      if (pctMatch) return Number(pctMatch[1]);
      const n = parseFloat(txt);
      return isNaN(n) ? 0 : n;
    }

    function normLabel(text) {
      return text.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    const result = { home: {}, away: {}, sum: {} };

    rows.forEach((row) => {
      const catEl = row.querySelector('[data-testid="wcl-statistics-category"]');
      if (!catEl) return;

      const catSpan = catEl.querySelector('[data-testid="wcl-scores-simple-text-01"]');
      const label = normLabel((catSpan || catEl).textContent);
      const key = LABEL_MAP[label];

      if (!key) {
        diagnostics.unmappedLabels.push(label);
        return;
      }
      if (result.sum[key] !== undefined) return;

      const vals = row.querySelectorAll('[data-testid="wcl-statistics-value"]');
      if (vals.length < 2) return;

      const hVal = parseVal(vals[0]);
      const aVal = parseVal(vals[1]);
      result.home[key] = hVal;
      result.away[key] = aVal;
      result.sum[key] = Number((hVal + aVal).toFixed(2));
      diagnostics.parsedLabels.push(key);
    });

    return { stats: result, diagnostics };
  }, labelMapJSON);
}

async function scrapeDesktopStats(page, desktopUrl, matchId) {
  await applyResourceBlocking(page);
  const labelMapJSON = JSON.stringify(STAT_LABEL_MAP);
  const results = { matchId, overall: null, firstHalf: null, secondHalf: null, statsStatus: 'unavailable', diagnostics: {} };

  const urlObj = new URL(desktopUrl);
  const cleanPath = urlObj.pathname.replace(/\/$/, '').replace(/\/?(summary.*)?$/, '');
  const basePath = `${urlObj.origin}${cleanPath}`;

  const endpoints = [
    { key: 'overall', suffix: '/summary/stats/overall/' },
    { key: 'secondHalf', suffix: '/summary/stats/2nd-half/' },
  ];

  // Прапор «у цій лізі статистики не існує»: overall повернув повністю гідровану,
  // але порожню по статистиці сторінку (нижчі ліги — Tercera KIFF, U19 тощо).
  // Тоді нема сенсу пробувати 2nd-half і mobile fallback цього циклу.
  let noStatsLeague = false;

  for (const ep of endpoints) {
    // Якщо зовнішній withTimeout уже закрив сторінку — далі не йдемо: всі page.* кинуть
    // "Target closed" і ми б згенерували купу помилкових PAGE_ERROR алертів.
    if (isPageClosed(page, null)) break;
    if (noStatsLeague) break;
    const url = `${basePath}${ep.suffix}?mid=${matchId}`;
    try {
      // domcontentloaded значно швидше ніж networkidle2 — мінімізує ризик PAGE_ERROR timeout
      await gotoWithRetry(page, url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

      let hasStats = false;
      try {
        await page.waitForSelector('[data-testid="wcl-statistics"]', { timeout: 8000 });
        hasStats = true;
      } catch {
        hasStats = await evalWithTimeout(page, () =>
          document.querySelectorAll('[data-testid="wcl-statistics"]').length > 0
        );
      }

      if (!hasStats) {
        const fallbackInfo = await evalWithTimeout(page, () => {
          const old = document.querySelectorAll('[class*="statisticsMobi"], .stat__row').length;
          const any = document.querySelectorAll('[class*="statistic"], [class*="wcl-row"]').length;
          const anyTestid = document.querySelectorAll('[data-testid]').length;
          const anyWcl = document.querySelectorAll('[class*="wcl-"]').length;
          return { old, any, anyTestid, anyWcl, bodyLen: (document.body?.textContent || '').length };
        });
        console.log(`  [stats] ${matchId} ${ep.key}: no data-testid (old=${fallbackInfo.old}, any=${fallbackInfo.any}, body=${fallbackInfo.bodyLen})`);
        if (fallbackInfo.old > 0) {
          logDomAlert(matchId, 'SELECTOR_CHANGED', `${ep.key}: data-testid not found but old selectors present`);
        }
        // Швидкий bail-out: сторінка повністю гідрована (testid/wcl класи присутні)
        // та довга, але stats-блоків нема → у flashscore просто немає статистики
        // для цієї ліги. Не марнуємо час на 2H і mobile fallback цього циклу.
        if (
          ep.key === 'overall' &&
          fallbackInfo.old === 0 &&
          fallbackInfo.anyTestid > 30 &&
          fallbackInfo.anyWcl > 30 &&
          fallbackInfo.bodyLen > 50000
        ) {
          noStatsLeague = true;
          console.log(`  [stats] ${matchId} → no_stats_league (skip 2H + mobile fallback)`);
        }
        continue;
      }

      const { stats, diagnostics } = await parseStatsFromPage(page, labelMapJSON);
      results.diagnostics[ep.key] = diagnostics;

      if (diagnostics.unmappedLabels.length > 3) {
        logDomAlert(matchId, 'UNMAPPED_LABELS', `${ep.key}: ${diagnostics.unmappedLabels.join(', ')}`);
      }

      if (diagnostics.rowCount > 0 && diagnostics.parsedLabels.length === 0) {
        logDomAlert(matchId, 'ZERO_PARSED', `${ep.key}: ${diagnostics.rowCount} rows found but 0 parsed`);
      }

      if (stats && Object.keys(stats.sum).length > 0) {
        results[ep.key] = stats;
      }
    } catch (e) {
      // Page закрилась через зовнішній withTimeout — це не DOM-проблема, не логуємо.
      if (isPageClosed(page, e)) break;
      logDomAlert(matchId, 'PAGE_ERROR', `${ep.key}: ${e.message}`);
      try { await dumpPageHtml(page, matchId, ep.key, e.message); } catch {}
    }
  }

  if (!results.overall && !isPageClosed(page, null) && !noStatsLeague) {
    const statsUrl = `https://m.flashscore.ua/match/${matchId}/?t=stats`;
    try {
      await gotoWithRetry(page, statsUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(1200);
      try {
        await page.waitForSelector('#statistics-mobi, [class*="statisticsMobi"]', { timeout: 8000 });
      } catch {
        /* інколи блок уже в DOM без очікуваного селектора */
      }
      const stats = await evalWithTimeout(
        page,
        parseMobileFlashscoreStatsFromDocument,
        JSON.stringify(MOBILE_STAT_LABEL_MAP)
      );
      if (stats && Object.keys(stats.sum || {}).length > 0) {
        results.overall = stats;
        results.diagnostics.mobileFallbackOverall = {
          url: statsUrl,
          metricCount: Object.keys(stats.sum).length,
        };
        console.log(
          `  [stats] ${matchId} mobile fallback overall: ${Object.keys(stats.sum).length} metrics`
        );
      }
    } catch (e) {
      if (!isPageClosed(page, e)) {
        logDomAlert(matchId, 'MOBILE_STATS_FALLBACK', e.message);
      }
    }
  }

  // Compute 1H stats as: firstHalf = overall - secondHalf (sum/count fields only).
  // Percentage metrics (e.g. ballPossession) are excluded — subtraction is semantically invalid
  // (e.g. 55% overall - 60% 2H = -5% which has no football meaning).
  // Key sets in sum / home / away are expected to be identical per parser invariant.
  const PERCENT_KEYS = new Set(['ballPossession']);
  if (results.overall && results.secondHalf) {
    const fh = { home: {}, away: {}, sum: {} };
    for (const key of Object.keys(results.overall.sum)) {
      if (PERCENT_KEYS.has(key)) continue;
      const ov = results.overall.sum[key];
      const sh = results.secondHalf.sum[key];
      if (typeof ov === 'number' && typeof sh === 'number') {
        const v = Number((ov - sh).toFixed(2));
        // null при від'ємних значеннях (аномалія парсера) — щоб n01() пропустила метрику
        // замість 0, яке дає хибно-сухий dry_1H сигнал
        fh.sum[key] = v < 0 ? null : v;
      }
    }
    for (const side of ['home', 'away']) {
      const src = results.overall[side] || {};
      const shSide = results.secondHalf[side] || {};
      for (const key of Object.keys(src)) {
        if (PERCENT_KEYS.has(key)) continue;
        const ov = src[key];
        const s = shSide[key];
        if (typeof ov === 'number' && typeof s === 'number') {
          const v = Number((ov - s).toFixed(2));
          fh[side][key] = v < 0 ? null : v;
        }
      }
    }
    results.firstHalf = fh;
  }

  if (results.overall && results.secondHalf) results.statsStatus = 'both';
  else if (results.secondHalf) results.statsStatus = '2h_only';
  else if (results.overall) results.statsStatus = 'overall_only';

  const totalMetrics = results.secondHalf
    ? Object.keys(results.secondHalf.sum).length
    : results.overall
      ? Object.keys(results.overall.sum).length
      : 0;
  console.log(`  [stats] ${matchId} → ${results.statsStatus}, ${totalMetrics} metrics`);

  return results;
}

async function checkMatchResult(page, matchId) {
  const mobileUrl = `https://m.flashscore.ua/match/${matchId}/?s=2`;
  try {
    await page.goto(mobileUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(1200);

    const mobileResult = await page.evaluate(() => {
      const body = document.body?.textContent || '';
      const bodyLower = body.toLowerCase();

      const finished =
        /завершено|закінч|finished|full[\s-]?time|після матчу|after match/.test(bodyLower);

      // Парсимо рахунок з жирного тексту виду "1:0" або "2:1"
      const boldEls = document.querySelectorAll('b, strong, h1, h2, h3');
      let homeScore = null;
      let awayScore = null;
      for (const el of boldEls) {
        const m = el.textContent.trim().match(/^(\d+):(\d+)$/);
        if (m) {
          homeScore = parseInt(m[1], 10);
          awayScore = parseInt(m[2], 10);
          break;
        }
      }

      // Fallback: перший числовий N:M у тексті (не 0:0 якщо є інший)
      if (homeScore === null) {
        const scoreMatch = body.match(/\b(\d+):(\d+)\b/);
        if (scoreMatch) {
          homeScore = parseInt(scoreMatch[1], 10);
          awayScore = parseInt(scoreMatch[2], 10);
        }
      }

      // Якщо рахунок не 0:0 (гол вже забитий) — вважаємо "вирішено" навіть якщо матч іще не завершений
      const hasGoal = homeScore !== null && (homeScore + awayScore) > 0;
      const resolvedByGoal = hasGoal && !finished;

      return { finished, resolvedByGoal, homeScore, awayScore, body: body.slice(0, 400) };
    });

    // Якщо не спрацювало — fallback на desktop
    if (mobileResult.homeScore === null) {
      await page.goto(`${DESKTOP_BASE}/${matchId}/`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      return await page.evaluate(() => {
        const title = document.title || '';
        const body = (document.body?.textContent || '').slice(0, 8000).toLowerCase();
        const finished =
          /завершено|закінч|finished|full[\s-]?time/.test(body) ||
          /після матчу|after match/.test(body);
        const sm = title.match(/\b(\d+)\s*[-–:]\s*(\d+)\b/);
        return {
          finished,
          resolvedByGoal: false,
          homeScore: sm ? parseInt(sm[1], 10) : null,
          awayScore: sm ? parseInt(sm[2], 10) : null,
          title: title.slice(0, 200),
        };
      });
    }

    return mobileResult;
  } catch (e) {
    return { finished: false, resolvedByGoal: false, homeScore: null, awayScore: null, error: e.message };
  }
}

module.exports = { scrapeDesktopStats, resolveDesktopUrl, checkMatchResult, logDomAlert, STAT_LABEL_MAP, applyResourceBlocking };
