const fs = require("fs");
const path = require("path");
const { toISO } = require("../src/helpers/date");
const { getIntensityZone } = require("../src/helpers/utils/predictLateGoal");

// === 1) ЗАВАНТАЖУЄМО ВСІ JSON-ФАЙЛИ З data/ ===
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

// === 2) ЧИ Є ГОЛ ПІСЛЯ 70' ===
function hasLateGoal(match) {
    if (!match.timeline || !Array.isArray(match.timeline)) return false;
    return match.timeline.some(ev => ev.type === "goal" && ev.minute >= 70);
}

// === 4) ГОЛОВНА ФУНКЦІЯ АНАЛІЗУ ===
function runZonesAnalysis() {
    const all = loadAllMatchFiles();
    if (all.length === 0) {
        console.log("No matches found for zone analysis");
        return;
    }

    let total = all.length;
    let lateAny = 0;
    let late70_80 = 0;
    let late80_90 = 0;

    const zoneTotals = {};        // {zone: count}
    const zoneLateAny = {};       // {zone: count}
    const zoneLate70_80 = {};     // {zone: count}
    const zoneLate80_90 = {};     // {zone: count}

    function inc(obj, key) {
        obj[key] = (obj[key] || 0) + 1;
    }

    for (const m of all) {
        const stats = m.stats2h || {};
        const zone = getIntensityZone(stats);

        const events = (m.timeline || [])
            .filter(ev => ev.type === "goal" && typeof ev.minute === "number")
            .map(ev => ev.minute);
        const late = events.filter(min => min >= 70);

        console.log(`Match ${m.league}: zone=${zone}, late=${late.length > 0}`);

        inc(zoneTotals, zone);

        if (late.length > 0) {
            lateAny++;
            inc(zoneLateAny, zone);

            if (late.some(min => min >= 70 && min < 80)) {
                late70_80++;
                inc(zoneLate70_80, zone);
            }

            if (late.some(min => min >= 80 && min <= 95)) {
                late80_90++;
                inc(zoneLate80_90, zone);
            }
        }
    }

    // Рахуємо “сухі” матчі по зонах (без гола після 70’)
    const zoneDry = {};
    for (const z of Object.keys(zoneTotals)) {
        const zNum = Number(z);
        const totalZ = zoneTotals[zNum] || 0;
        const lateZ = zoneLateAny[zNum] || 0;
        zoneDry[zNum] = totalZ - lateZ;
    }

    console.log("=====================================");
    console.log("📊 Загальна кількість матчів:", total);
    console.log("⚽ З голом після 70 хв:", lateAny);
    console.log("❌ Без голу після 70 хв:", total - lateAny);
    console.log("⏰ Гол 70–80 хв:", late70_80);
    console.log("⏰ Гол 80–90+ хв:", late80_90);
    console.log("=====================================");

    const zonesSummary = {};

    for (const z of Object.keys(zoneTotals).map(Number).sort((a, b) => a - b)) {
        const totalZ = zoneTotals[z] || 0;
        const lateZ = zoneLateAny[z] || 0;
        const dryZ = zoneDry[z] || 0;

        zonesSummary[z] = {
            total: totalZ,
            late: lateZ,
            dry: dryZ,
            pLate: totalZ ? Number((lateZ / totalZ).toFixed(3)) : 0,
            pDry: totalZ ? Number((dryZ / totalZ).toFixed(3)) : 0,
            late70_80: zoneLate70_80[z] || 0,
            late80_90: zoneLate80_90[z] || 0,
        };
    }

    console.log("=== Zone Scores Summary ===");
    console.log(JSON.stringify(zonesSummary, null, 2));

    const report = {
        totals: {
            all: total,
            lateAny,
            noLate: total - lateAny,
            late70_80,
            late80_90,
        },
        zones: zonesSummary,
        generatedAt: toISO(),
    };

    fs.writeFileSync(
        path.join(__dirname, "../data/analysis_groupe.json"),
        JSON.stringify(report, null, 2)
    );

    console.log("📁 Saved → data/analysis_groupe.json");
    console.log("Зони:");
    console.dir(zonesSummary, {depth: null});
}

runZonesAnalysis();
