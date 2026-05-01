const { createLiveMatchCandidate } = require('../../pipeline/contracts');
const { LIVE_MIN_CANDIDATE_MINUTE } = require('../../helpers/constants');

/**
 * Парсинг LIVE у #score-data: TreeWalker у порядку документа (h4 → ліга, a[match] → матч).
 * Раніше split(innerHTML, '<br>') відтинав більшість рядків — у DOM лишалися лише верхні ліги.
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

  /** Остання N' у фрагменті (час поточного рядка між score-лінками; max брав хвилину з чужих матчів вище). */
  function parseLastMinuteWithApostrophe(text) {
    const s = String(text || '').trim();
    const re = new RegExp(`(\\d{1,3})(?:\\+(\\d{1,2}))?${APOST}`, 'g');
    let last = null;
    let m;
    while ((m = re.exec(s)) !== null) {
      const base = Number(m[1]);
      const extra = m[2] != null ? Number(m[2]) : 0;
      const v = base + extra;
      if (v >= 0 && v <= 130) last = v;
    }
    return last;
  }

  function getLeagueName(node) {
    if (!node) return 'unknown';
    return node.textContent
      .replace(/\s*Таблиця\s*$/i, '')
      .replace(/\s*Standings\s*$/i, '')
      .trim() || 'unknown';
  }

  /** У плоскому #score-data час майже завжди в span.live одразу перед лінком рахунку. */
  function minuteFromAdjacentLiveSpan(linkNode) {
    const prev = linkNode.previousElementSibling;
    if (!prev || prev.tagName !== 'SPAN' || !prev.classList || !prev.classList.contains('live')) {
      return null;
    }
    const st = (prev.textContent || '').trim();
    if (/перерва|half\s*time|ht\b/i.test(st)) return 45;
    let m = parseMinuteSecondHalfLabel(st);
    if (m === null) m = parseMinuteWithApostrophe(st);
    if (m === null) m = parseLastMinuteWithApostrophe(st);
    return m;
  }

  const scoreData = document.getElementById('score-data');
  if (!scoreData) {
    return { matches: [], health: { totalRows: 0, missingId: 0, missingMinute: 0, missingUrl: 0, totalZeroZero: 0 } };
  }

  function isScoreOnlyLink(a) {
    const nt = (a.textContent || '').trim().replace(/\s+/g, '');
    return /^\d+:\d+$/.test(nt) && (a.getAttribute('href') || '').includes('/match/');
  }

  /**
   * Текст (і span.live) між попереднім score-лінком і цим — один візуальний рядок,
   * навіть якщо весь список у спільному div (Range від parent(0) ламав усе в один рядок).
   */
  function sliceBetweenPrevScoreAndLink(linkNode) {
    const ordered = [];
    const w = document.createTreeWalker(scoreData, NodeFilter.SHOW_ELEMENT, null);
    let el;
    while ((el = w.nextNode())) {
      if (el.tagName === 'A' && isScoreOnlyLink(el)) ordered.push(el);
    }
    const idx = ordered.indexOf(linkNode);
    if (idx < 0) return { beforeText: '', liveSpan: null };
    const prev = idx > 0 ? ordered[idx - 1] : null;
    try {
      const range = document.createRange();
      if (prev) range.setStartAfter(prev);
      else range.setStart(scoreData, 0);
      range.setEndBefore(linkNode);
      const div = document.createElement('div');
      div.appendChild(range.cloneContents());
      const beforeText = (div.textContent || '').replace(/\s+/g, ' ').trim();
      const liveSpans = div.querySelectorAll('span.live');
      const liveSpan =
        liveSpans.length > 0 ? liveSpans[liveSpans.length - 1] : null;
      return { beforeText, liveSpan: liveSpan || null };
    } catch (e) {
      return { beforeText: '', liveSpan: null };
    }
  }

  const matches = [];
  const skippedByMinute = [];
  const seenIds = new Set();
  const health = { totalRows: 0, missingId: 0, missingMinute: 0, missingUrl: 0, totalZeroZero: 0 };
  let currentLeague = 'unknown';

  const walker = document.createTreeWalker(scoreData, NodeFilter.SHOW_ELEMENT, null);
  let el;
  while ((el = walker.nextNode())) {
    if (el.tagName === 'H4') {
      currentLeague = getLeagueName(el);
      continue;
    }
    if (el.tagName !== 'A') continue;
    const href = el.getAttribute('href') || '';
    if (!href.includes('/match/')) continue;
    const nt = (el.textContent || '').trim().replace(/\s+/g, '');
    if (!/^\d+:\d+$/.test(nt)) continue;

    health.totalRows += 1;

    const scoreMatch = nt.match(/^(\d+):(\d+)$/);
    if (!scoreMatch) continue;
    const homeScore = scoreMatch[1];
    const awayScore = scoreMatch[2];
    if (homeScore !== '0' || awayScore !== '0') continue;
    health.totalZeroZero += 1;

    const idMatch = href.match(/\/match\/([^\/\?]+)/);
    const matchId = idMatch ? idMatch[1] : '';
    if (!matchId) {
      health.missingId += 1;
      continue;
    }
    if (seenIds.has(matchId)) continue;
    seenIds.add(matchId);

    const linkNode = el;
    const { beforeText: beforeLink, liveSpan: liveTimeNode } = sliceBetweenPrevScoreAndLink(linkNode);

    let minute = minuteFromAdjacentLiveSpan(linkNode);
    if (minute === null && liveTimeNode) {
      const st = (liveTimeNode.textContent || '').trim();
      if (/перерва|half\s*time|ht\b/i.test(st)) minute = 45;
      else {
        minute = parseMinuteSecondHalfLabel(st);
        if (minute === null) minute = parseMinuteWithApostrophe(st);
      }
    }
    if (minute === null) {
      minute = parseMinuteSecondHalfLabel(beforeLink);
    }
    if (minute === null) {
      minute = parseLastMinuteWithApostrophe(beforeLink);
    }

    if (minute !== null && minute <= 50 && /2\s*[-–—]\s*\S{1,6}\s+тайм/i.test(beforeLink)) {
      minute += 45;
    }

    if (minute === null) {
      health.missingMinute += 1;
      continue;
    }

    let chunk = beforeLink;
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
      let fullText = beforeLink;
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

    const cleanUrl = href.split('?')[0];
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

async function collectLiveMatches(page, liveUrl, opts = {}, minMinute = LIVE_MIN_CANDIDATE_MINUTE) {
  if (!opts.skipNavigation) {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    await page.goto(liveUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForSelector('#score-data', { timeout: 20000 });
    await page.waitForTimeout(500);
    /** Кнопка оновлення списку (UA / EN). */
    await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
      for (const n of nodes) {
        const t = (n.textContent || '').trim();
        if (/^(ОНОВИТИ|REFRESH|UPDATE)/i.test(t) && t.length < 40) {
          n.click();
          return;
        }
      }
    });
    await page.waitForTimeout(1200);
    /**
     * Довгий список LIVE частково підвантажується після скролу.
     */
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const el = document.getElementById('score-data');
      for (let round = 0; round < 10; round++) {
        if (el) el.scrollTop = el.scrollHeight;
        window.scrollBy(0, 2500);
        await sleep(400);
      }
      window.scrollTo(0, 0);
      await sleep(250);
    });
    await page.waitForTimeout(500);
  }
  const { matches, skippedByMinute, health } = await page.evaluate(
    parseLiveMatchesFromDocument,
    minMinute,
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
