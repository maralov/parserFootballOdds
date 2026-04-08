const fs = require("fs");
const path = require("path");
const { toISO } = require("../date");

function saveJson(file, data) {
    const outputPath = path.join(__dirname, "../../../", "data", file);

    // if folder doesn't exist — create it
    const folder = path.dirname(outputPath);
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, {recursive: true});
    }

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");

    console.log(`💾 Saved to ${outputPath}`);
}

function saveRunBatch({ runId, startedAt, rawMatches, processedMatches, decisions }) {
    const safeRunId = String(runId || 'unknown-run');
    const timestamp = String(startedAt || toISO()).replace(/[:.]/g, '-');
    const base = path.join("runs", `${timestamp}-${safeRunId}`);

    saveJson(path.join(base, "raw_matches.json"), rawMatches || []);
    saveJson(path.join(base, "processed_matches.json"), processedMatches || []);
    saveJson(path.join(base, "decisions.json"), decisions || []);
}

module.exports = {saveJson, saveRunBatch};
