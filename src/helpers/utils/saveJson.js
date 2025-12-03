const fs = require("fs");
const path = require("path");

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

module.exports = {saveJson};
