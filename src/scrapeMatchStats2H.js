const TIMEOUT = 20000;
const RETRIES = 1;

const STAT_LABEL_MAP = {
  // English
  'expected goals (xg)': 'expectedGoalsXg',
  'expected goals': 'expectedGoalsXg',
  'ball possession': 'ballPossession',
  'total shots': 'totalShots',
  'shots on target': 'shotsOnTarget',
  'big chances': 'bigChances',
  'corner kicks': 'cornerKicks',
  'corners': 'cornerKicks',
  'passes': 'passes',
  'yellow cards': 'yellowCards',
  'red cards': 'redCards',
  'xg on target (xgot)': 'xgOnTargetXgot',
  'shots off target': 'shotsOffTarget',
  'blocked shots': 'blockedShots',
  'shots inside the box': 'shotsInsideTheBox',
  'shots inside box': 'shotsInsideTheBox',
  'shots outside the box': 'shotsOutsideTheBox',
  'shots outside box': 'shotsOutsideTheBox',
  'hit the woodwork': 'hitTheWoodwork',
  'headed goals': 'headedGoals',
  'touches in opposition box': 'touchesInOppositionBox',
  'touches in opp. box': 'touchesInOppositionBox',
  'accurate through passes': 'accurateThroughPasses',
  'offsides': 'offsides',
  'free kicks': 'freeKicks',
  'long passes': 'longPasses',
  'passes in final third': 'passesInFinalThird',
  'crosses': 'crosses',
  'expected assists (xa)': 'expectedAssistsXa',
  'throw-ins': 'throwIns',
  'throw ins': 'throwIns',
  'fouls': 'fouls',
  'tackles': 'tackles',
  'duels won': 'duelsWon',
  'clearances': 'clearances',
  'interceptions': 'interceptions',
  'errors leading to shot': 'errorsLeadingToShot',
  'errors leading to goal': 'errorsLeadingToGoal',
  'goalkeeper saves': 'goalkeeperSaves',
  'xgot faced': 'xgotFaced',
  'goals prevented': 'goalsPrevented',

  // Ukrainian
  'очікувані голи (xg)': 'expectedGoalsXg',
  'очікувані голи': 'expectedGoalsXg',
  'володіння м\'ячем': 'ballPossession',
  'усього ударів': 'totalShots',
  'удари в площину': 'shotsOnTarget',
  'гольові нагоди': 'bigChances',
  'гольові моменти': 'bigChances',
  'кутові удари': 'cornerKicks',
  'кутові': 'cornerKicks',
  'передачі': 'passes',
  'жовті картки': 'yellowCards',
  'червоні картки': 'redCards',
  'xg серед ударів у площну (xgot)': 'xgOnTargetXgot',
  'удари повз ворота': 'shotsOffTarget',
  'заблоковані удари': 'blockedShots',
  'удари з меж штрафного майданчика': 'shotsInsideTheBox',
  'удари з-за меж штрафного майданчика': 'shotsOutsideTheBox',
  'влучання в каркас воріт': 'hitTheWoodwork',
  'голи головою': 'headedGoals',
  'дотики в штрафн. майданчику суперника': 'touchesInOppositionBox',
  'точні розрізні передачі': 'accurateThroughPasses',
  'офсайди': 'offsides',
  'штрафні удари': 'freeKicks',
  'довгі передачі': 'longPasses',
  'передачі в останній третині': 'passesInFinalThird',
  'кроси': 'crosses',
  'навіси': 'crosses',
  'очікувані асисти (xa)': 'expectedAssistsXa',
  'вкидання': 'throwIns',
  'фоли': 'fouls',
  'підкати': 'tackles',
  'відбори': 'tackles',
  'виграні двобої': 'duelsWon',
  'виграні єдиноборства': 'duelsWon',
  'вибивання': 'clearances',
  'виноси': 'clearances',
  'перехоплення': 'interceptions',
  'помилки, що призвели до удару': 'errorsLeadingToShot',
  'помилки, що призвели до голу': 'errorsLeadingToGoal',
  'сейви воротаря': 'goalkeeperSaves',
  'xgot після ударів у площину': 'xgotFaced',
  'відвернені голи': 'goalsPrevented',
  'голам запобігнуто': 'goalsPrevented',

  // Russian
  'ожидаемые голы (xg)': 'expectedGoalsXg',
  'ожидаемые голы': 'expectedGoalsXg',
  'владение мячом': 'ballPossession',
  'всего ударов': 'totalShots',
  'удары в створ': 'shotsOnTarget',
  'голевые моменты': 'bigChances',
  'угловые': 'cornerKicks',
  'передачи': 'passes',
  'желтые карточки': 'yellowCards',
  'красные карточки': 'redCards',
  'xg в створ (xgot)': 'xgOnTargetXgot',
  'удары мимо': 'shotsOffTarget',
  'ударов заблокировано': 'blockedShots',
  'удары из пределов штрафной': 'shotsInsideTheBox',
  'удары из-за штрафной': 'shotsOutsideTheBox',
  'попадание в штангу': 'hitTheWoodwork',
  'голы головой': 'headedGoals',
  'касания мяча в штрафной соперника': 'touchesInOppositionBox',
  'успешные передачи в разрез': 'accurateThroughPasses',
  'офсайды': 'offsides',
  'штрафные': 'freeKicks',
  'длинные передачи': 'longPasses',
  'передачи в последней трети': 'passesInFinalThird',
  'навесы': 'crosses',
  'ожидаемые ассисты (xa)': 'expectedAssistsXa',
  'вбрасывания': 'throwIns',
  'фолы': 'fouls',
  'отборы': 'tackles',
  'выиграно дуэлей': 'duelsWon',
  'выносы': 'clearances',
  'перехваты': 'interceptions',
  'ошибки, приведшие к удару': 'errorsLeadingToShot',
  'ошибки, приведшие к голу': 'errorsLeadingToGoal',
  'сэйвы вратаря': 'goalkeeperSaves',
  'xgot после ударов в створ': 'xgotFaced',
  'предотвращённые голы': 'goalsPrevented',
  'предотвращенные голы': 'goalsPrevented',
};

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
      await page.waitForSelector('#statistics-mobi', { timeout: TIMEOUT });
      await page.waitForTimeout(1500);
    } catch (e) {
      console.log(`  [stats] ${matchId} no #statistics-mobi found`);
      return { id: matchId, stats2h: null };
    }
  }

  const stats = await page.evaluate((labelMapJSON) => {
    const LABEL_MAP = JSON.parse(labelMapJSON);

    function parseVal(txt) {
      txt = String(txt || '').trim();
      const pctFull = txt.match(/^(\d+)%\s*\((\d+)\/(\d+)\)$/);
      if (pctFull) return Number(pctFull[1]);
      if (txt.endsWith('%')) return Number(txt.slice(0, -1));
      const n = parseFloat(txt);
      return isNaN(n) ? 0 : n;
    }

    function normLabel(label) {
      return label.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    const result = { home: {}, away: {}, sum: {} };

    const rows = document.querySelectorAll('[class*="statisticsMobi"]');
    if (rows.length > 0) {
      rows.forEach((row) => {
        const cats = row.querySelectorAll('[class*="wcl-category"]');
        const homeEl = row.querySelector('[class*="wcl-homeValue"]');
        const awayEl = row.querySelector('[class*="wcl-awayValue"]');
        if (!cats.length || !homeEl || !awayEl) return;

        const labelEl = cats.length > 1 ? cats[1] : cats[0];
        const label = normLabel(labelEl?.textContent || '');
        const key = LABEL_MAP[label];
        if (!key || result.sum[key] !== undefined) return;

        const hVal = parseVal(homeEl.textContent);
        const aVal = parseVal(awayEl.textContent);
        result.home[key] = hVal;
        result.away[key] = aVal;
        result.sum[key] = Number((hVal + aVal).toFixed(2));
      });
      return result;
    }

    const wrapper = document.querySelector('#statistics-mobi');
    if (wrapper) {
      const lines = (wrapper.textContent || '').split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const label = normLabel(lines[i]);
        const key = LABEL_MAP[label];
        if (!key) continue;
        const homeRaw = i > 0 ? lines[i - 1] : undefined;
        const awayRaw = i < lines.length - 1 ? lines[i + 1] : undefined;
        if (homeRaw === undefined || awayRaw === undefined) continue;
        if (result.sum[key] !== undefined) continue;
        const hVal = parseVal(homeRaw);
        const aVal = parseVal(awayRaw);
        result.home[key] = hVal;
        result.away[key] = aVal;
        result.sum[key] = Number((hVal + aVal).toFixed(2));
      }
      return result;
    }

    return null;
  }, JSON.stringify(STAT_LABEL_MAP));

  const metricsCount = stats ? Object.keys(stats.sum || {}).length : 0;
  console.log(`  [stats] ${matchId} → ${metricsCount} metrics parsed`);

  if (!stats || metricsCount === 0) {
    return { id: matchId, stats2h: null };
  }

  return { id: matchId, stats2h: stats };
};
