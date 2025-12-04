const fs = require("fs");
const path = require("path");

// === 1) ЗАВАНТАЖУЄМО ВСІ JSON ФАЙЛИ З DATA ===
function loadAllMatchFiles() {
    const dir = path.join(__dirname, "../data");

    return fs.readdirSync(dir)
        .filter(f => f.endsWith(".json") && f.startsWith("league_"))
        .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")))
        .flat();
}

// === 2) ПЕРЕВІРКА ЧИ БУВ ГОЛ ПІСЛЯ 70 ===
function hasLateGoal(match) {
    if (!match.timeline || !Array.isArray(match.timeline)) return false;
    return match.timeline.some(ev => ev.minute >= 70);
}

// === 3) АГРЕГУЄМО МЕТРИКИ ===
function aggregateStats(matches) {
    const sums = {};
    let count = 0;

    for (const m of matches) {
        if (!m.stats2h) continue;

        for (const key of Object.keys(m.stats2h)) {
            if (!sums[key]) sums[key] = 0;
            sums[key] += Number(m.stats2h[key] || 0);
        }
        count++;
    }

    const averages = {};
    for (const key of Object.keys(sums)) {
        averages[key] = Number((sums[key] / count).toFixed(3));
    }

    return {count, averages};
}

// === 4) ГОЛОВНА ФУНКЦІЯ АНАЛІЗУ ===
function runAnalysis() {
    const all = loadAllMatchFiles();

    const lateGoals = all.filter(hasLateGoal);
    const noGoals = all.filter(m => !hasLateGoal(m));

    let goals_70_80 = 0;
    let goals_80_90 = 0;

    for (const match of all) {
        if (!match.timeline || !Array.isArray(match.timeline)) continue;
        for (const ev of match.timeline) {
            if (ev.type === "goal" && typeof ev.minute === "number") {
                if (ev.minute >= 70 && ev.minute < 80) {
                    goals_70_80++;
                } else if (ev.minute >= 80 && ev.minute <= 90) {
                    goals_80_90++;
                }
            }
        }
    }

    console.log("=====================================");
    console.log("📊 Загальна кількість матчів:", all.length);
    console.log("⚽ З голом після 70 хв:", lateGoals.length);
    console.log("❌ Сухі/без голів пізніх:", noGoals.length);
    console.log("=====================================");

    const statsLate = aggregateStats(lateGoals);
    const statsDry = aggregateStats(noGoals);

    // Grouping by leagues
    const leagues = {};
    for (const match of all) {
        const leagueName = match.league || "Unknown";
        if (!leagues[leagueName]) {
            leagues[leagueName] = {
                all: 0,
                lateGoals: 0,
                noGoals: 0,
                goals_70_80: 0,
                goals_80_90: 0
            };
        }
        leagues[leagueName].all++;

        if (hasLateGoal(match)) {
            leagues[leagueName].lateGoals++;
        } else {
            leagues[leagueName].noGoals++;
        }

        if (match.timeline && Array.isArray(match.timeline)) {
            for (const ev of match.timeline) {
                if (ev.type === "goal" && typeof ev.minute === "number") {
                    if (ev.minute >= 70 && ev.minute < 80) {
                        leagues[leagueName].goals_70_80++;
                    } else if (ev.minute >= 80 && ev.minute <= 90) {
                        leagues[leagueName].goals_80_90++;
                    }
                }
            }
        }
    }

    const report = {
        totals: {
            all: all.length,
            lateGoals: statsLate.count,
            noGoals: statsDry.count,
            goals_70_80,
            goals_80_90
        },
        avgLateGoals: statsLate.averages,
        avgDry: statsDry.averages,
        leagues
    };

    fs.writeFileSync(
        path.join(__dirname, "../data/analysis.json"),
        JSON.stringify(report, null, 2)
    );

    console.log("📁 Saved → data/analysis.json");
    console.log("📁", report);
}

runAnalysis();
