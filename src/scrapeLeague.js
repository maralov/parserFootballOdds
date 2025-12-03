const {BASE_URL} = require("./helpers/constants");

async function scrapeLeague(page, league) {
    const url = `${BASE_URL}${league.country}/${league.name}/results/`;

    try {
        console.log("Opening:", url);

        // Flashscore SPA → networkidle2 НЕ ПРАЦЮЄ
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });

        // Чекаємо поки DOM зʼявиться
        await page.waitForSelector(".results", {timeout: 20000});

        // Дати React дорендерити SPA (фрейми міняються!)
        await page.waitForTimeout(1200);

        // Переконуємось що DOM стабільний
        await page.waitForFunction(() => {
            return document.querySelectorAll(".event--results .event__match").length > 0;
        }, {timeout: 20000});

        // Парсимо матчі
        const matches = await page.evaluate((leagueName) => {
            const rows = [...document.querySelectorAll(".event--results .event__match")];

            return rows.map((m) => {

                const link = m.querySelector("a")?.href || null;

                const home = m.querySelector(".event__homeParticipant")?.textContent.trim();
                const away = m.querySelector(".event__awayParticipant")?.textContent.trim();

                const homeScore = m.querySelector(".event__score--home")?.textContent.trim();
                const awayScore = m.querySelector(".event__score--away")?.textContent.trim();

                return {
                    id: m.id.replace('g_1_', ""),
                    league: leagueName.name,
                    matchDetailsUrl: link ? link.split("?")[0] : null,
                    home,
                    away,
                    score: {home: homeScore, away: awayScore}
                };
            });
        }, league);   // ← ПЕРЕДАЄМО ЛІГУ В evaluate

        return matches;

    } catch (e) {
        console.log("LEAGUE ERROR:", league, e.message);
        return [];
    }
}

module.exports = scrapeLeague;
