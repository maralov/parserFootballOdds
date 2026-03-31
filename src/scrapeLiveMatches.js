async function scrapeLiveMatches(page) {
  const url = 'https://www.flashscore.mobi/?s=2';

  try {
    console.log('Opening:', url);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Чекаємо поки блок score-data зʼявиться
    await page.waitForSelector('#score-data', { timeout: 20000 });

    // Дати сторінці дорендерити
    await page.waitForTimeout(1200);

    // Парсимо матчі з лайв сторінки
    const matches = await page.evaluate(() => {
      const scoreData = document.getElementById('score-data');
      if (!scoreData) return [];

      const matches = [];
      let currentLeague = '';

      // Отримуємо весь HTML контент
      const html = scoreData.innerHTML;

      // Розбиваємо на рядки (майже кожен матч закінчується <br>)
      const lines = html.split(/<br\s*\/?>/i);

      for (const line of lines) {
        // Перевіряємо чи це заголовок ліги
        const h4Match = line.match(/<h4[^>]*>(.*?)<\/h4>/i);
        if (h4Match) {
          const leagueText = h4Match[1].replace(/<[^>]+>/g, '').trim();
          currentLeague = leagueText.replace(/\s*Standings\s*$/i, '').trim();
          continue;
        }

        // Шукаємо матчі: час у <span class="live">, команди, рахунок у <a>
        // Приклад: <span class="live">70'</span>Gol Gohar - Paykan <a href="..." class="live">0:1</a>
        const timeMatch = line.match(/<span[^>]*class="live"[^>]*>(\d{1,2})'(\+)?'?<\/span>/i);
        if (!timeMatch) continue;

        const minutes = parseInt(timeMatch[1], 10);
        const isOvertime = timeMatch[2] === '+';

        // Перевіряємо чи >= 70 хвилин
        if (minutes < 70 && !isOvertime) continue;

        // Шукаємо посилання з рахунком
        const linkMatch = line.match(/<a[^>]*href="([^"]*)"[^>]*class="live"[^>]*>(\d+):(\d+)<\/a>/i);
        if (!linkMatch) continue;

        const matchLink = linkMatch[1];
        const homeScore = linkMatch[2];
        const awayScore = linkMatch[3];

        // Перевіряємо чи рахунок 0:0
        if (homeScore !== '0' || awayScore !== '0') continue;

        // Витягуємо назви команд
        // Текст між </span> та <a>
        const teamsPart = line.split('</span>')[1]?.split('<a')[0]?.trim() || '';
        const teams = teamsPart.split(' - ');

        if (teams.length === 2) {
          const home = teams[0].trim();
          const away = teams[1].trim();

          // Витягуємо ID з посилання (формат: /match/ID/...)
          const matchIdMatch = matchLink.match(/\/match\/([^\/\?]+)/);
          const matchId = matchIdMatch ? matchIdMatch[1] : '';

          // Очищаємо посилання від параметрів
          const cleanUrl = matchLink.split('?')[0];
          const fullUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://www.flashscore.mobi${cleanUrl}`;

          matches.push({
            id: matchId,
            league: currentLeague,
            matchDetailsUrl: fullUrl,
            home,
            away,
            score: { home: homeScore, away: awayScore },
          });
        }
      }

      return matches;
    });

    return matches;
  } catch (e) {
    console.log('LIVE MATCHES ERROR:', e.message);
    return [];
  }
}

module.exports = scrapeLiveMatches;
