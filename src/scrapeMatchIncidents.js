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
 * Команда визначається по абревіатурі [ABBR] в тексті інциденту:
 * homeAbbr береться з першого гольового інциденту.
 *
 * @returns {{ homeRedCards: number, awayRedCards: number, incidents: Array }}
 */
async function scrapeMatchIncidents(page, matchId) {
  const url = `https://m.flashscore.ua/match/${matchId}/?s=2`;
  const empty = { homeRedCards: 0, awayRedCards: 0, incidents: [] };

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
      if (!detailEl) return { homeRedCards: 0, awayRedCards: 0, incidents: [] };

      // Визначаємо homeAbbr з першого гольового інциденту (де icon ball)
      let homeAbbr = null;
      const firstGoal = detailEl.querySelector('.incident .icon.ball');
      if (firstGoal) {
        const parentDiv = firstGoal.closest('.incident');
        const text = parentDiv ? parentDiv.textContent : '';
        const m = text.match(/\[([A-Z0-9]{2,5})\]/);
        if (m) homeAbbr = m[1];
      }

      // Збираємо всі červoні картки
      const redCardEls = detailEl.querySelectorAll('.incident .icon.r-card');
      const incidents = [];
      let homeRedCards = 0;
      let awayRedCards = 0;

      redCardEls.forEach((el) => {
        const div = el.closest('.incident');
        if (!div) return;

        const timeEl = div.querySelector('.i-field.time, .i-field.time-wide');
        const rawMinute = timeEl ? timeEl.textContent.trim().replace(/'/g, '').replace(/\+\d+/, '') : null;
        const minute = rawMinute ? parseInt(rawMinute, 10) : null;

        const text = div.textContent || '';
        const abbrMatch = text.match(/\[([A-Z0-9]{2,5})\]/);
        const abbr = abbrMatch ? abbrMatch[1] : null;

        const playerMatch = text.replace(/\[.*?\]/g, '').replace(/\d+['´]/, '').trim();

        let team = 'unknown';
        if (abbr && homeAbbr) {
          team = abbr === homeAbbr ? 'home' : 'away';
        }

        incidents.push({ minute, team, player: playerMatch.slice(0, 40), abbr });

        if (team === 'home') homeRedCards++;
        else if (team === 'away') awayRedCards++;
        else {
          // Якщо homeAbbr не визначено — все одно рахуємо загальну кількість
          homeRedCards += 0.5;
          awayRedCards += 0.5;
        }
      });

      return {
        homeRedCards: Math.round(homeRedCards),
        awayRedCards: Math.round(awayRedCards),
        incidents,
      };
    });

    if (result.incidents.length > 0) {
      console.log(`  [incidents] ${matchId}: ${result.homeRedCards}H + ${result.awayRedCards}A red cards`);
    }

    return result;
  } catch (e) {
    console.log(`  [incidents] ${matchId} parse error: ${e.message}`);
    return empty;
  }
}

module.exports = { scrapeMatchIncidents };
