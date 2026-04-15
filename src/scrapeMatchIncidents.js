const TIMEOUT = 15000;

/**
 * Парсинг інцидентів матчу з мобільного Flashscore (?s=2).
 * Визначає кількість червоних карток для кожної команди.
 *
 * HTML-розмітка:
 *   <div class="incident soccer">
 *     <p class="i-field time">80'</p>
 *     <p class="i-field icon r-card">&nbsp;</p>Інуе А. [ALB]
 *   </div>
 *
 * Команда визначається по абревіатурі [ABBR] в тексті інциденту.
 * Пріоритет джерел home/away abr:
 *  1) document.title (формат "TRA 0-1 SHA | ...")
 *  2) fallback: перший гольовий інцидент (історична евристика)
 *
 * Якщо сторону визначити неможливо, інцидент позначається як unknown,
 * але НЕ розподіляється штучно 0.5/0.5 між home/away.
 *
 * @returns {{ homeRedCards: number, awayRedCards: number, unknownRedCards: number, incidents: Array }}
 */
async function scrapeMatchIncidents(page, matchId) {
  const url = `https://m.flashscore.ua/match/${matchId}/?s=2`;
  const empty = { homeRedCards: 0, awayRedCards: 0, unknownRedCards: 0, incidents: [] };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(800);
  } catch (e) {
    console.log(`  [incidents] ${matchId} load failed: ${e.message}`);
    return empty;
  }

  try {
    const result = await page.evaluate(() => {
      const detailEl = document.getElementById('detail-tab-content');
      if (!detailEl) return { homeRedCards: 0, awayRedCards: 0, unknownRedCards: 0, incidents: [] };

      function normalizeAbbr(s) {
        if (!s) return null;
        return String(s).trim().toUpperCase();
      }

      function parseAbbrFromTitle() {
        const title = String(document.title || '').trim();
        // Приклади: "ТРА 0-3 SHA | ..." або "TRA 0:3 SHA | ..."
        const m = title.match(/([A-ZА-ЯІЇЄҐ]{2,5})\s+\d+\s*[-:]\s*\d+\s+([A-ZА-ЯІЇЄҐ]{2,5})/i);
        if (!m) return { homeAbbr: null, awayAbbr: null };
        return { homeAbbr: normalizeAbbr(m[1]), awayAbbr: normalizeAbbr(m[2]) };
      }

      // Спочатку пробуємо взяти home/away з title.
      let { homeAbbr, awayAbbr } = parseAbbrFromTitle();
      // Fallback (legacy): homeAbbr з першого гола; awayAbbr лишається null.
      if (!homeAbbr) {
        const firstGoal = detailEl.querySelector('.incident .icon.ball');
        if (firstGoal) {
          const parentDiv = firstGoal.closest('.incident');
          const text = parentDiv ? parentDiv.textContent : '';
          const m = text.match(/\[([A-Z0-9А-ЯІЇЄҐ]{2,5})\]/i);
          if (m) homeAbbr = normalizeAbbr(m[1]);
        }
      }

      // Збираємо всі червоні картки
      const redCardEls = detailEl.querySelectorAll('.incident .icon.r-card');
      const incidents = [];
      let homeRedCards = 0;
      let awayRedCards = 0;
      let unknownRedCards = 0;

      redCardEls.forEach((el) => {
        const div = el.closest('.incident');
        if (!div) return;

        const timeEl = div.querySelector('.i-field.time, .i-field.time-wide');
        const rawMinute = timeEl ? timeEl.textContent.trim().replace(/'/g, '').replace(/\+\d+/, '') : null;
        const minute = rawMinute ? parseInt(rawMinute, 10) : null;

        const text = div.textContent || '';
        const abbrMatch = text.match(/\[([A-Z0-9А-ЯІЇЄҐ]{2,5})\]/i);
        const abbr = abbrMatch ? normalizeAbbr(abbrMatch[1]) : null;

        const playerMatch = text.replace(/\[.*?\]/g, '').replace(/\d+['´]/, '').trim();

        let team = 'unknown';
        if (abbr && homeAbbr && awayAbbr) {
          if (abbr === homeAbbr) team = 'home';
          else if (abbr === awayAbbr) team = 'away';
        } else if (abbr && homeAbbr) {
          team = abbr === homeAbbr ? 'home' : 'away';
        }

        incidents.push({ minute, team, player: playerMatch.slice(0, 40), abbr });

        if (team === 'home') homeRedCards++;
        else if (team === 'away') awayRedCards++;
        else unknownRedCards++;
      });

      return {
        homeRedCards,
        awayRedCards,
        unknownRedCards,
        incidents,
      };
    });

    if (result.incidents.length > 0) {
      const unknown = result.unknownRedCards ? ` + ${result.unknownRedCards}U` : '';
      console.log(
        `  [incidents] ${matchId}: ${result.homeRedCards}H + ${result.awayRedCards}A${unknown} red cards`
      );
    }

    return result;
  } catch (e) {
    console.log(`  [incidents] ${matchId} parse error: ${e.message}`);
    return empty;
  }
}

module.exports = { scrapeMatchIncidents };
