const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const os = require('os');

puppeteer.use(StealthPlugin());

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1680, height: 1050 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickUserAgent() {
  return randomFrom(USER_AGENTS);
}

function pickViewport() {
  return randomFrom(VIEWPORTS);
}

async function launchBrowser() {
    // На Linux — системний Chrome. На macOS — Puppeteer's Chrome for Testing
    let executablePath;
    if (os.platform() === 'linux') {
        executablePath = '/usr/bin/google-chrome';
    } else if (os.platform() === 'darwin') {
        executablePath = '/Users/m.aralov/.cache/puppeteer/chrome/mac-119.0.6045.105/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
    }

    const viewport = pickViewport();

    return await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          `--window-size=${viewport.width},${viewport.height}`,
        ],
        executablePath,
        protocolTimeout: 120000,
        defaultViewport: viewport,
    });
}

module.exports = { launchBrowser, pickUserAgent, pickViewport };
