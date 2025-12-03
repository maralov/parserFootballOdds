module.exports = async function scrapeMatchStats2H(page, matchDetailsUrl, matchId) {
    const TIMEOUT = 30000;
    const RETRIES = 2;
    const url = `${matchDetailsUrl}summary/stats/2/?mid=${matchId}`;

    console.log(`   └─ 📊 Stats2H: Opening ${url}`);

    async function loadPage() {
        try {
            await page.goto(url, {
                waitUntil: "networkidle2",
                timeout: TIMEOUT
            });

            // головний контейнер таймлайну
            await page.waitForSelector(".tabContent__match-summary", {timeout: TIMEOUT});
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
        return {error: true};
    }

    const stats = await page.evaluate(() => {
        const wrapper = document.querySelector(".tabContent__match-statistics");
        if (!wrapper) return null;

        const normalize = (label) =>
            label
                .trim()
                .replace(/[^a-zA-Z0-9 ]/g, " ")
                .split(/\s+/)
                .map((w, i) =>
                    i === 0
                        ? w.toLowerCase()
                        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                )
                .join("");

        const parseVal = (txt) => {
            txt = txt.trim();
            if (txt.endsWith("%")) return Number(txt.slice(0, -1));
            const n = parseFloat(txt);
            return isNaN(n) ? 0 : n;
        };

        const result = {};

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

        return result;
    });

    if(!stats) {
        console.log(`   └─ ❌ Stats2H ERROR ${matchId}: No stats found`);
        return {id: matchId, stats2h: null};
    }
    console.log(`   └─ ✅ Stats2H parsed: ${Object.keys(stats).length} metrics`);

    return {id: matchId, stats2h: stats};
}
