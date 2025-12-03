const puppeteer = require("puppeteer");
const os = require('os');


async function launchBrowser() {
    let executablePath;
    if (os.platform() === 'linux') {
        executablePath = '/usr/bin/google-chrome';
    } else if (os.platform() === 'darwin') {
        executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    return await puppeteer.launch({
        headless: 'new',
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        executablePath,
    });
}

module.exports = {launchBrowser};
