const { createLiveMatchCandidate } = require('../../pipeline/contracts');
const { LIVE_MIN_CANDIDATE_MINUTE } = require('../../helpers/constants');

/**
 * Парсинг LIVE-списку. Кожен матч на сторінці — окремий фрагмент між <br>;
 * обхід «усіх a в #score-data» ламає рядки (один батьківський контейнер → змішані команди/хвилини).
 */
function parseLiveMatchesFromDocument(minMinute, feedLabel, feedUrl) {
  const APOST = "['\u2019′]";

  /**
   * «2-й тайм - 69'» / рос. «2-й тайм» — явна хвилина (не покладатися лише на N').
   * \w у JS не матчить «й», тому старий strip префікса з liveSource ламався.
   */
  function parseMinuteSecondHalfLabel(text) {
    const s = String(text || '');
    const m = s.match(
      /2\s*[-–—]\s*\S{1,6}\s+тайм\s*-\s*(\d{1,3})(?:\+(\d{1,2}))?(?:['\u2019′]|$)/i
    );
    if (!m) return null;
    const base = Number(m[1]);
    const extra = m[2] != null ? Number(m[2]) : 0;
    const v = base + extra;
    return v >= 0 && v <= 130 ? v : null;
  }

  /**
   * Хвилина: усі N' / N+N' у рядку; беремо максимум (у змішаному тексті останнє співпадіння
   * могло давати 34' замість 69' → 0 кандидатів при живих 69'/78').
   */
  function parseMinuteWithApostrophe(text) {
    const s = String(text || '').trim();
    const re = new RegExp(`(\\d{1,3})(?:\\+(\\d{1,2}))?${APOST}`, 'g');
    let best = null;
    let m;
    while ((m = re.exec(s)) !== null) {
      const base = Number(m[1]);
      const extra = m[2] != null ? Number(m[2]) : 0;
      const v = base + extra;
      if (v >= 0 && v <= 130 && (best === null || v > best)) best = v;
    }
    return best;
  }

  function getLeagueName(node) {
    if (!node) return 'unknown';
    return node.textContent.replace(/\s*Standings\s*$/i, '').trim() || 'unknown';
  }

  const scoreData = document.getElementById('score-data');
  if (!scoreData) {
    return { matches: [], health: { totalRows: 0, missingId: 0, missingMinute: 0, missingUrl: 0, totalZeroZero: 0 } };
  }

  const lines = scoreData.innerHTML.split(/<br\s*\/?>/i);
  const matches = [];
  const skippedByMinute = [];
  const seenIds = new Set();
  const health = { totalRows: 0, missingId: 0, missingMinute: 0, missingUrl: 0, totalZeroZero: 0 };
  let currentLeague = 'unknown';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/<h4[^>]*>/i.test(trimmed)) {
      const w = document.createElement('div');
      w.innerHTML = trimmed;
      const h4 = w.querySelector('h4');
      if (h4) currentLeague = getLeagueName(h4);
      continue;
    }

    if (!/class\s*=\s*["'][^"']*\blive\b/i.test(trimmed) && !/\blive\b/i.test(trimmed)) continue;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = trimmed;

    const allMatchAs = wrapper.querySelectorAll('a[href*="/match/"]');
    let linkNode = null;
    for (let ai = 0; ai < allMatchAs.length; ai++) {
      const a = allMatchAs[ai];
      const nt = (a.textContent || '').trim().replace(/\s+/g, '');
      if (/^\d+:\d+$/.test(nt)) {
        linkNode = a;
        break;
      }
    }
    if (!linkNode) continue;

    health.totalRows += 1;

    const scoreNorm = (linkNode.textContent || '').trim().replace(/\s+/g, '');
    const scoreMatch = scoreNorm.match(/^(\d+):(\d+)$/);
    if (!scoreMatch) continue;
    const homeScore = scoreMatch[1];
    const awayScore = scoreMatch[2];
    if (homeScore !== '0' || awayScore !== '0') continue;
    health.totalZeroZero += 1;

    const matchLink = linkNode.getAttribute('href') || '';
    const idMatch = matchLink.match(/\/match\/([^\/\?]+)/);
    const matchId = idMatch ? idMatch[1] : '';
    if (!matchId) {
      health.missingId += 1;
      continue;
    }

    if (seenIds.has(matchId)) continue;
    seenIds.add(matchId);

    const liveTimeNode = wrapper.querySelector('span.live');
    const plain = (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
    let minute = null;
    if (liveTimeNode) {
      const st = (liveTimeNode.textContent || '').trim();
      if (/перерва|half\s*time|ht\b/i.test(st)) minute = 45;
      else {
        minute = parseMinuteSecondHalfLabel(st);
        if (minute === null) minute = parseMinuteWithApostrophe(st);
      }
    }
    if (minute === null) {
      minute = parseMinuteSecondHalfLabel(plain);
    }
    if (minute === null) {
      minute = parseMinuteWithApostrophe(plain);
    }

    /**
     * Деякі ліги (напр. Austrian Regionalliga) відображають хвилини ПЕРИОДУ другого тайму (1-45),
     * а не загальні хвилини матчу (46-90). Flashscore показує "2-й тайм" у тексті рядка.
     * Якщо хвилина <= 50 і в рядку є "2-й тайм" — конвертуємо в загальну хвилину (+45).
     */
    if (minute !== null && minute <= 50 && /2\s*[-–—]\s*\S{1,6}\s+тайм/i.test(plain)) {
      minute += 45;
    }

    if (minute === null) {
      health.missingMinute += 1;
      continue;
    }

    /** Команда йдуть ПЕРЕД лінком з рахунком (часто «… 0:0» в кінці рядка). */
    let chunk = '';
    for (let n = linkNode.previousSibling; n; n = n.previousSibling) {
      if (n.nodeType === 3) chunk = n.textContent + chunk;
      else if (n.nodeType === 1) chunk = (n.textContent || '') + chunk;
    }
    chunk = chunk.replace(/\s+/g, ' ').trim();
    chunk = chunk.replace(/^Перерва\s*/i, '').trim();
    chunk = chunk.replace(/^(\d{1,3})(?:\+(\d{1,2}))?['\u2019′]\s*/, '').trim();
    chunk = chunk.replace(
      /^2\s*[-–—]\s*\S{1,6}\s+тайм\s*-\s*(\d{1,3})(?:\+(\d{1,2}))?['\u2019′]\s*/i,
      ''
    ).trim();

    let teamParts = chunk.split(/\s+-\s+/);
    if (teamParts.length < 2) {
      teamParts = chunk.split(/\s*[-–—]\s*/);
    }
    if (teamParts.length < 2) {
      let fullText = (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
      const zM = fullText.match(/\b0\s*:\s*0\b/);
      if (!zM || zM.index === undefined) continue;
      let rest = fullText.slice(zM.index + zM[0].length).trim().replace(/^['\u2019′]\s*/, '').trim();
      teamParts = rest.split(/\s+-\s+/);
      if (teamParts.length < 2) teamParts = rest.split(/\s*[-–—]\s*/);
    }
    if (teamParts.length < 2) continue;
    const home = teamParts[0].trim();
    const away = teamParts.slice(1).join(' - ').trim();
    if (!home || !away) continue;

    if (minute < minMinute) {
      skippedByMinute.push({ home, away, minute, league: currentLeague });
      continue;
    }

    const cleanUrl = matchLink.split('?')[0];
    const fullUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://m.flashscore.ua${cleanUrl}`;

    matches.push({
      id: matchId,
      league: currentLeague,
      minute,
      matchDetailsUrl: fullUrl,
      home,
      away,
      score: { home: homeScore, away: awayScore },
      provider: 'flashscore-mobile-ua',
      feed: feedLabel || null,
      feedUrl: feedUrl || null,
    });
  }

  return { matches, skippedByMinute, health };
}

async function collectLiveMatches(page, liveUrl, opts = {}) {
  if (!opts.skipNavigation) {
    await page.goto(liveUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForSelector('#score-data', { timeout: 20000 });
    await page.waitForTimeout(1200);
  }
  const { matches, skippedByMinute, health } = await page.evaluate(
    parseLiveMatchesFromDocument,
    LIVE_MIN_CANDIDATE_MINUTE,
    liveUrl.includes('s=1') ? 's=1' : 's=2',
    liveUrl
  );
  return {
    matches: matches.map((item) => createLiveMatchCandidate(item)),
    skippedByMinute: skippedByMinute || [],
    health,
  };
}

module.exports = {
  collectLiveMatches,
  parseLiveMatchesFromDocument,
};
