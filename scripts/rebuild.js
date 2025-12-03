const fs = require("fs");
const path = require("path");
const {launchBrowser} = require("../src/browser");
const scrapeMatchStats2H = require("../src/scrapeMatchStats2H");

async function run() {
    console.log("🔄 Rebuilding merged dataset...");

    const dir = path.join(__dirname, "..", "data");
    const leagueFiles = fs.readdirSync(dir).filter(f => f.startsWith("league_"));

    let all = [];

    for (const file of leagueFiles) {
        const json = JSON.parse(fs.readFileSync(path.join(dir, file)));
        all.push(...json);
    }

    console.log(`📌 Loaded ${all.length} matches`);

    // === FILTER: прибрати матчі де є гол ДО 70' ===
    const filtered = all.filter(m => {
        if (!m.timeline || m.timeline.length === 0) return true;
        return m.timeline.every(ev => ev.minute >= 70);
    });

    console.log(`📉 After filtering early goals: ${filtered.length}`);

    fs.writeFileSync(
        path.join(dir, "final_matches.json"),
        JSON.stringify(filtered, null, 2)
    );

    console.log("✅ Done → data/final_matches.json");
}

run();
