const fs = require("fs");
const path = require("path");
const { toISO } = require("../src/helpers/date");
const { getIntensityZone } = require("../src/helpers/utils/predictLateGoal");

// === 1) ЗАВАНТАЖУЄМО ВСІ JSON ФАЙЛИ З DATA ===
function loadAllMatchFiles() {
    const dir = path.join(__dirname, "../data");
    if (!fs.existsSync(dir)) {
        console.log("⚠️ data directory not found, returning empty dataset");
        return [];
    }

    return fs.readdirSync(dir)
        .filter(f => f.endsWith(".json") && f.startsWith("league_"))
        .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")))
        .flat();
}

// === 2) ПЕРЕВІРКА ЧИ БУВ ГОЛ ПІСЛЯ 70 ===
function hasLateGoal(match) {
    if (!match.timeline || !Array.isArray(match.timeline)) return false;
    return match.timeline.some(ev => ev.type === "goal" && ev.minute >= 70);
}

function getFirstLateGoalMinute(match) {
    if (!match.timeline || !Array.isArray(match.timeline)) return null;
    const lateGoal = match.timeline
        .filter(ev => ev.type === "goal" && typeof ev.minute === "number" && ev.minute >= 70)
        .sort((a, b) => a.minute - b.minute)[0];
    return lateGoal ? lateGoal.minute : null;
}

function getMinuteBucket(minute) {
    if (minute === null || minute === undefined) return "no-late-goal";
    if (minute >= 86) return "86+";
    if (minute >= 81) return "81-85";
    if (minute >= 76) return "76-80";
    return "70-75";
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
    if (all.length === 0) {
        console.log("No matches found for analysis");
        return;
    }

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
    const zones = {};
    const minuteBuckets = {
        "70-75": {total: 0, withGoal: 0},
        "76-80": {total: 0, withGoal: 0},
        "81-85": {total: 0, withGoal: 0},
        "86+": {total: 0, withGoal: 0},
        "no-late-goal": {total: 0, withGoal: 0},
    };

    function initZone(zone) {
        if (!zones[zone]) {
            zones[zone] = {total: 0, late: 0, dry: 0, pLate: 0};
        }
    }

    for (const match of all) {
        const leagueName = match.league || "Unknown";
        const hasLate = hasLateGoal(match);
        const zone = getIntensityZone(match.stats2h || {});
        const minuteBucket = getMinuteBucket(getFirstLateGoalMinute(match));

        initZone(zone);
        zones[zone].total++;
        if (hasLate) zones[zone].late++;
        else zones[zone].dry++;

        minuteBuckets[minuteBucket].total++;
        if (hasLate) minuteBuckets[minuteBucket].withGoal++;

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

        if (hasLate) {
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

    for (const zone of Object.keys(zones)) {
        const item = zones[zone];
        item.pLate = item.total ? Number((item.late / item.total).toFixed(3)) : 0;
    }

    const minuteBucketReport = {};
    for (const [bucket, item] of Object.entries(minuteBuckets)) {
        minuteBucketReport[bucket] = {
            ...item,
            pLate: item.total ? Number((item.withGoal / item.total).toFixed(3)) : 0,
        };
    }

    const qa = {
        generatedAt: toISO(),
        sampleSize: all.length,
        minReliableSample: 20,
        zoneWarnings: Object.entries(zones)
            .filter(([, item]) => item.total < 20)
            .map(([zone, item]) => `Zone ${zone} has small sample: ${item.total}`),
        leagueWarnings: Object.entries(leagues)
            .filter(([, item]) => item.all < 10)
            .map(([league, item]) => `League ${league} has small sample: ${item.all}`),
    };

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
        leagues,
        zones,
        minuteBuckets: minuteBucketReport,
        qa,
    };

    fs.writeFileSync(
        path.join(__dirname, "../data/analysis.json"),
        JSON.stringify(report, null, 2)
    );

    console.log("📁 Saved → data/analysis.json");
    fs.writeFileSync(
        path.join(__dirname, "../data/qa_report.json"),
        JSON.stringify(qa, null, 2)
    );
    console.log("📁 Saved → data/qa_report.json");
    console.log("📁", report);
}

runAnalysis();
