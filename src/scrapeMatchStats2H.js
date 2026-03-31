module.exports = async function scrapeMatchStats2H(page, matchDetailsUrl, matchId) {
  const TIMEOUT = 30000;
  const RETRIES = 2;

  // Для мобільної версії використовуємо параметр t=stats
  // Для десктопної версії використовуємо summary/stats/2/
  let url;
  if (matchDetailsUrl.includes('flashscore.mobi')) {
    // Мобільна версія: додаємо параметр t=stats
    const separator = matchDetailsUrl.includes('?') ? '&' : '?';
    url = `${matchDetailsUrl}${separator}s=2&t=stats`;
  } else {
    // Десктопна версія: використовуємо старий формат
    url = `${matchDetailsUrl}summary/stats/2/?mid=${matchId}`;
  }

  console.log(`   └─ 📊 Stats2H: Opening ${url}`);

  async function loadPage() {
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: TIMEOUT,
      });

      // Для мобільної версії чекаємо на контейнер статистики
      // Для десктопної версії чекаємо на .tabContent__match-summary
      if (url.includes('flashscore.mobi')) {
        // Мобільна версія - чекаємо на #statistics-mobi
        await page.waitForSelector('#statistics-mobi', { timeout: TIMEOUT });
        await page.waitForTimeout(1000); // Даємо час на завантаження
      } else {
        // Десктопна версія
        await page.waitForSelector('.tabContent__match-summary', { timeout: TIMEOUT });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- RETRY LOAD ---
  let ok = false;
  for (let i = 0; i <= RETRIES; i++) {
    ok = await loadPage();
    if (ok) break;
    console.log(`⏳ Retry timeline load ${i + 1}/${RETRIES} for ${matchId}`);
    await page.waitForTimeout(5000);
  }

  if (!ok) {
    console.log(`   └─ ❌ Stats2H ERROR ${matchId}:`);
    return { error: true };
  }

  const stats = await page.evaluate(() => {
    const isMobile = window.location.href.includes('flashscore.mobi');

    // Для мобільної версії шукаємо в #statistics-mobi
    // Для десктопної версії шукаємо в .tabContent__match-statistics
    let wrapper = isMobile
      ? document.querySelector('#statistics-mobi')
      : document.querySelector('.tabContent__match-statistics');

    if (!wrapper) return null;

    const normalize = (label) =>
      label
        .trim()
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join('');

    const parseVal = (txt) => {
      txt = txt.trim();
      if (txt.endsWith('%')) return Number(txt.slice(0, -1));
      const n = parseFloat(txt);
      return isNaN(n) ? 0 : n;
    };

    const result = {};

    // Для мобільної версії структура інша - шукаємо статистику в тексті
    if (isMobile) {
      // Шукаємо всі секції зі статистикою
      const sections = wrapper.querySelectorAll('h4, h5, strong');
      let currentSection = '';

      sections.forEach((section) => {
        const text = section.textContent.trim();

        // Перевіряємо чи це назва секції (Shots, Attack, Passes, etc.)
        if (['Shots', 'Attack', 'Passes', 'Defense', 'Goalkeeping'].includes(text)) {
          currentSection = text;
          return;
        }
      });

      // Парсимо статистику з мобільної версії
      // Шукаємо всі strong елементи зі статистикою
      const statElements = wrapper.querySelectorAll('strong');

      statElements.forEach((el) => {
        const text = el.textContent.trim();
        const parent = el.parentElement;
        const parentText = parent ? parent.textContent : '';

        // Шукаємо патерни типу "Expected Goals (xG)" зі значеннями
        const xgMatch = text.match(/Expected Goals \(xG\)|Expected Goals/i);
        if (xgMatch) {
          const nextSibling = el.nextElementSibling;
          if (nextSibling) {
            const value = parseVal(nextSibling.textContent);
            if (value > 0) {
              result.expectedGoalsXg = value;
            }
          }
        }

        // Шукаємо інші статистики
        const shotsOnTargetMatch = text.match(/Shots on target/i);
        if (shotsOnTargetMatch) {
          const nextSibling = el.nextElementSibling;
          if (nextSibling) {
            const value = parseVal(nextSibling.textContent);
            if (value > 0) {
              result.shotsOnTarget = (result.shotsOnTarget || 0) + value;
            }
          }
        }

        const touchesMatch = text.match(/Touches in opposition box/i);
        if (touchesMatch) {
          const nextSibling = el.nextElementSibling;
          if (nextSibling) {
            const value = parseVal(nextSibling.textContent);
            if (value > 0) {
              result.touchesInOppositionBox = (result.touchesInOppositionBox || 0) + value;
            }
          }
        }
      });

      // Альтернативний спосіб: парсимо з тексту сторінки
      const allText = wrapper.textContent;

      // Expected Goals (xG) - шукаємо обидва значення та додаємо
      const xgRegex = /Expected Goals \(xG\)[\s\S]*?(\d+\.?\d*)[\s\S]*?(\d+\.?\d*)/i;
      const xgMatch = allText.match(xgRegex);
      if (xgMatch && !result.expectedGoalsXg) {
        const homeXg = parseFloat(xgMatch[1]) || 0;
        const awayXg = parseFloat(xgMatch[2]) || 0;
        result.expectedGoalsXg = homeXg + awayXg;
      }

      // Shots on target - шукаємо обидва значення та додаємо
      const sotRegex = /Shots on target[\s\S]*?(\d+)[\s\S]*?(\d+)/i;
      const sotMatch = allText.match(sotRegex);
      if (sotMatch && !result.shotsOnTarget) {
        const homeSot = parseInt(sotMatch[1]) || 0;
        const awaySot = parseInt(sotMatch[2]) || 0;
        result.shotsOnTarget = homeSot + awaySot;
      }

      // Touches in opposition box - шукаємо обидва значення та додаємо
      const touchesRegex = /Touches in opposition box[\s\S]*?(\d+)[\s\S]*?(\d+)/i;
      const touchesMatch = allText.match(touchesRegex);
      if (touchesMatch && !result.touchesInOppositionBox) {
        const homeTouches = parseInt(touchesMatch[1]) || 0;
        const awayTouches = parseInt(touchesMatch[2]) || 0;
        result.touchesInOppositionBox = homeTouches + awayTouches;
      }
    } else {
      // Десктопна версія - використовуємо старий спосіб
      const rows = wrapper.querySelectorAll('[data-testid="wcl-statistics"]');

      rows.forEach((row) => {
        const labelNode = row.querySelector('[data-testid="wcl-statistics-category"] strong');
        if (!labelNode) return;

        const label = normalize(labelNode.innerText);

        const vals = row.querySelectorAll('[data-testid="wcl-statistics-value"] strong');
        if (vals.length < 2) return;

        const home = parseVal(vals[0].innerText);
        const away = parseVal(vals[1].innerText);

        result[label] = home + away;
      });
    }

    return result;
  });

  if (!stats) {
    console.log(`   └─ ❌ Stats2H ERROR ${matchId}: No stats found`);
    return { id: matchId, stats2h: null };
  }
  console.log(`   └─ ✅ Stats2H parsed: ${Object.keys(stats).length} metrics`);

  return { id: matchId, stats2h: stats };
};
