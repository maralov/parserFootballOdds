module.exports = async function scrapeMatchTimeline(page, url, matchId) {
    const TIMEOUT = 30000;
    const RETRIES = 2;

    const matchUrl = url + `?mid=${matchId}`;

    console.log(`└─ 🕒 Timeline: Opening ${matchUrl}`);

    async function loadPage() {
        try {
            await page.goto(matchUrl, {
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
        console.log(`❌ Failed to load match page ${matchId}`);
        return {error: true};
    }

    // --- MAIN LOGIC ---
    return await page.evaluate(() => {

        const output = {
            skip: false,
            hasLateGoal: false,
            debug: '',
            events: [],
        };

        // === 1) Знаходимо два блоки "1st Half" та "2nd Half" ===
        const headers = Array.from(
            document.querySelectorAll(".tabContent__match-summary .wclHeaderSection--summary")
        );

        if (headers.length === 0) {
            output.skip = true;
            output.debug = {reason: "No summary headers found"};
            return output;
        }

        function extractScore(summaryBlock)
        {
            const spans = [...summaryBlock.querySelectorAll("span")];

            for (const span of spans) {
                const div = span.querySelector("div");
                if (!div) continue;

                const txt = div.textContent.trim();

                // Формат рахунку формату "0 - 0", "1 - 1"
                if (/^\d+\s*-\s*\d+$/.test(txt)) {
                    return txt;
                }
            }

            return null;
        }

        const firstHalf = extractScore(headers[0]);

        // 1-й тайм має бути 0-0
        if (!firstHalf || firstHalf !== "0 - 0") {
            output.skip = true;
            output.debug = {
                reason: "First half not 0-0",
                firstHalfScore: firstHalf
            };
            return output;
        }

        // === 2) Парсимо голи ===
        const rows = Array.from(document.querySelectorAll(".smv__participantRow"));

        rows.forEach(row => {
            const timeBox = row.querySelector(".smv__timeBox");
            if (!timeBox) return;

            const minute = parseInt(timeBox.textContent.replace("'", ""), 10);
            if (isNaN(minute)) return;

            const isGoal =
                row.querySelector(".smv__incidentHomeScore") ||
                row.querySelector(".smv__incidentAwayScore");

            if (!isGoal) return;

            const score =
                row.querySelector(".smv__incidentHomeScore")?.textContent?.trim() ||
                row.querySelector(".smv__incidentAwayScore")?.textContent?.trim() ||
                null;

            output.events.push({
                minute,
                score,
                type: "goal",
            });

            // === гол після 70' ===
            if (minute >= 70) {
                output.hasLateGoal = true;
                output.debug = {
                    reason: "Late goal!!",
                    lateGoalMinute: minute,
                    lateGoalScore: score
                }
            }
        });

        return output;
    });
};
