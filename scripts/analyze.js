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

    console.log("=====================================");
    console.log("📊 Загальна кількість матчів:", all.length);
    console.log("⚽ З голом після 70 хв:", lateGoals.length);
    console.log("❌ Сухі/без голів пізніх:", noGoals.length);
    console.log("=====================================");

    const statsLate = aggregateStats(lateGoals);
    const statsDry = aggregateStats(noGoals);

    const diff = {};
    for (const key in statsLate.averages) {
        diff[key] = Number((statsLate.averages[key] - (statsDry.averages[key] || 0)).toFixed(3));
    }

    const sortedDiff = Object.entries(diff)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    const report = {
        totals: {
            all: all.length,
            lateGoals: statsLate.count,
            noGoals: statsDry.count,
        },
        avgLateGoals: statsLate.averages,
        avgDry: statsDry.averages,
        importanceSorted: sortedDiff
    };

    fs.writeFileSync(
        path.join(__dirname, "../data/analysis.json"),
        JSON.stringify(report, null, 2)
    );

    console.log("📁 Saved → data/analysis.json");
    console.log("Top predictors:");
    console.log(sortedDiff.slice(0, 15));
}

runAnalysis();
