const {workerData, parentPort} = require("worker_threads");
const {launchBrowser} = require("./src/browser");

const scrapeLeague = require("./src/scrapeLeague");
const scrapeMatchTimeline = require("./src/scrapeMatchTimeline");
const scrapeMatchStats2H = require("./src/scrapeMatchStats2H");

const {saveJson} = require("./src/helpers/utils");
const {USER_AGENT} = require("./src/helpers/constants");

function shouldProcessMatch(match) {
    const h = Number(match.score.home);
    const a = Number(match.score.away);
    const code = `${h}-${a}`;

    return ["0-0", "1-0", "0-1", "1-1", "2-0", "0-2"].includes(code);
}

(async () => {
    const league = workerData.league;
    console.log(`🧵 Worker started → ${league.name}`);

    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    const matches = await scrapeLeague(page, league);
    console.log(`📌 ${league.country}: found ${matches.length} matches`);

    const output = [];

    for (const match of matches) {

        console.log(`\n==============================`);
        console.log(`➡️ Checking match: ${match.home} – ${match.away} (${match.score.home}:${match.score.away})`);
        console.log(`URL: ${match.matchDetailsUrl}`);
        console.log(`==============================`);

        if (!match.matchDetailsUrl) {
            console.log(`❌ No matchDetailsUrl → SKIP`);
            continue;
        }

        if (!shouldProcessMatch(match)) {
            console.log(`⏭ Score ${match.score.home}-${match.score.away} not in filter → SKIP`);
            continue;
        }

        // === CASE 0-0 ===
        if (match.score.home === "0" && match.score.away === "0") {
            console.log(`⚪ 0-0 match → skipping timeline, ONLY stats`);

            const stats = await scrapeMatchStats2H(page, match.matchDetailsUrl, match.id);

            output.push({
                ...match,
                timeline: [],
                stats2h: stats.stats2h
            });

            saveJson(`league_${league.name}.json`, output);
            continue;
        }

        // === TIMELINE ===
        console.log(`📄 Loading timeline for ${match.id}...`);

        const timeline = await scrapeMatchTimeline(page, match.matchDetailsUrl, match.id);

        if (timeline.error) {
            console.log(`❌ Timeline ERROR for ${match.id} → SKIP`);
            continue;
        }

        console.log(`FirstHalfOK: ${!timeline.skip}, LateGoal: ${timeline.hasLateGoal}`);


        if (timeline.skip) {
            console.log(`⏭ First half not 0-0 → SKIP`);
            console.log('Debug info:', timeline.debug);
            continue;
        }

        if (!timeline.hasLateGoal) {
            console.log(`⏭ No late goals → SKIP`);
            console.log('Debug info:', timeline.debug);
            continue;
        }

        // === STATS ===
        console.log(`📊 Timeline OK → loading stats2h...`);

        const stats = await scrapeMatchStats2H(page, match.matchDetailsUrl, match.id);

        output.push({
            ...match,
            timeline: timeline.events,
            stats2h: stats.stats2h
        });

        console.log(`✅ Added match ${match.id}. Total: ${output.length}`);

        saveJson(`league_${league.name}.json`, output);
    }

    await browser.close();

    parentPort.postMessage({
        league,
        matchesProcessed: output.length
    });
})();
