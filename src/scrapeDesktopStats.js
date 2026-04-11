const fs = require('fs');
const path = require('path');
const { toISO } = require('./helpers/date');
const {
  MOBILE_STAT_LABEL_MAP,
  parseMobileFlashscoreStatsFromDocument,
} = require('./parsers/mobileFlashscoreStats');

const TIMEOUT = 20000;
const DESKTOP_BASE = 'https://www.flashscore.ua/match';
const DOM_ALERT_FILE = path.join(__dirname, '..', 'data', 'logs', 'dom_alerts.json');

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
    const dir = path.dirname(DOM_ALERT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let alerts = [];
    if (fs.existsSync(DOM_ALERT_FILE)) {
      try { alerts = JSON.parse(fs.readFileSync(DOM_ALERT_FILE, 'utf8')); } catch {}
    }
    alerts.push(entry);
    if (alerts.length > 500) alerts = alerts.slice(-200);
    fs.writeFileSync(DOM_ALERT_FILE, JSON.stringify(alerts, null, 2), 'utf8');
  } catch {}
}

async function resolveDesktopUrl(page, matchId) {
  const shortUrl = `${DESKTOP_BASE}/${matchId}/`;
  try {
    await page.goto(shortUrl, { waitUntil: 'networkidle2', timeout: TIMEOUT });
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
  return page.evaluate((mapJson) => {
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
  const labelMapJSON = JSON.stringify(STAT_LABEL_MAP);
  const results = { matchId, overall: null, secondHalf: null, statsStatus: 'unavailable', diagnostics: {} };

  const urlObj = new URL(desktopUrl);
  const cleanPath = urlObj.pathname.replace(/\/$/, '').replace(/\/?(summary.*)?$/, '');
  const basePath = `${urlObj.origin}${cleanPath}`;

  const endpoints = [
    { key: 'overall', suffix: '/summary/stats/overall/' },
    { key: 'secondHalf', suffix: '/summary/stats/2nd-half/' },
  ];

  for (const ep of endpoints) {
    const url = `${basePath}${ep.suffix}?mid=${matchId}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

      let hasStats = false;
      try {
        await page.waitForSelector('[data-testid="wcl-statistics"]', { timeout: 8000 });
        hasStats = true;
      } catch {
        hasStats = await page.evaluate(() =>
          document.querySelectorAll('[data-testid="wcl-statistics"]').length > 0
        );
      }

      if (!hasStats) {
        const fallbackInfo = await page.evaluate(() => {
          const old = document.querySelectorAll('[class*="statisticsMobi"], .stat__row').length;
          const any = document.querySelectorAll('[class*="statistic"], [class*="wcl-row"]').length;
          return { old, any, bodyLen: (document.body?.textContent || '').length };
        });
        console.log(`  [stats] ${matchId} ${ep.key}: no data-testid (old=${fallbackInfo.old}, any=${fallbackInfo.any}, body=${fallbackInfo.bodyLen})`);
        if (fallbackInfo.old > 0) {
          logDomAlert(matchId, 'SELECTOR_CHANGED', `${ep.key}: data-testid not found but old selectors present`);
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
      logDomAlert(matchId, 'PAGE_ERROR', `${ep.key}: ${e.message}`);
    }
  }

  if (!results.overall) {
    const statsUrl = `https://m.flashscore.ua/match/${matchId}/?t=stats`;
    try {
      await page.goto(statsUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(1200);
      try {
        await page.waitForSelector('#statistics-mobi, [class*="statisticsMobi"]', { timeout: 8000 });
      } catch {
        /* інколи блок уже в DOM без очікуваного селектора */
      }
      const stats = await page.evaluate(
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
      logDomAlert(matchId, 'MOBILE_STATS_FALLBACK', e.message);
    }
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

module.exports = { scrapeDesktopStats, resolveDesktopUrl, checkMatchResult, logDomAlert, STAT_LABEL_MAP };
