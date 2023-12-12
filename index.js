const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const dateFns = require('date-fns');

require('dotenv').config();

const { USER_AGENTS, LEAGUES, BASE_URL } = require('./helpers/constants');

const sendTelegramMessage = require('./helpers/utils/sendTelegramMessage');
const createPredictionMessage = require('./helpers/utils/createPredictionMessage');
const createResultMessage = require('./helpers/utils/createResultMessage');

let executablePath;
if (os.platform() === 'linux') {
  executablePath = '/usr/bin/google-chrome';
} else if (os.platform() === 'darwin') {
  executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function checkLastChecked(dateString) {
  const lastCheckedPath = './summary/lastChecked.json';
  let lastCheckedDate = null;

  if (fs.existsSync(lastCheckedPath)) {
    lastCheckedDate = JSON.parse(fs.readFileSync(lastCheckedPath)).date;
    if (dateString === lastCheckedDate) {
      console.log('Перевірка за вчора вже була зроблена.');
      return false;
    } else {
      fs.writeFileSync(lastCheckedPath, JSON.stringify({ date: dateString }));
      return true;
    }
  }
}

async function checkPredictions(page, path = '') {
  const yesterday = dateFns.subDays(new Date(), 1);
  const dateString = dateFns.format(yesterday, 'MM-dd-yyyy');

  const shouldUpdate = await checkLastChecked(dateString);

  if (!shouldUpdate) {
    return;
  }

  const filePath = path ? `./results/${path}` : `./results/${dateString}.json`;
  if (!fs.existsSync(filePath)) {
    console.log('Немає файлу з прогнозами за вчора.');
    return;
  }
  const matchesData = JSON.parse(fs.readFileSync(filePath));
  const allMatches = JSON.parse(fs.readFileSync('./summary/total.json'));
  const summProfit = JSON.parse(fs.readFileSync('./summary/profit.json'));
  console.log(`check yesterday predictions start... ${yesterday.toLocaleString()}`);

  const filteredMatchesData = [];

  for (const match of matchesData) {
    if (match.result && !path) continue;
    try {
      await page.goto(match.url, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      const score = await page.evaluate(() => {
        const scoreElements = document.querySelectorAll('.duelParticipant__score .detailScore__wrapper span');
        const scoreElementsFullTime = document.querySelectorAll('.duelParticipant__score .detailScore__fullTime span');
        const scoreBlock =
          scoreElementsFullTime && scoreElementsFullTime.length > 0 ? scoreElementsFullTime : scoreElements;
        return scoreBlock.length === 3 ? `${scoreBlock[0].textContent}-${scoreBlock[2].textContent}` : null;
      });

      if (score) {
        const scoreType = score
          .split('-')
          .map(Number)
          .reduce((a, b) => (a === b ? 'draw' : a > b ? 'home' : 'away'));
        const result = match.prediction === scoreType ? 'win' : 'lose';
        console.log(`Yesterday match prediction ${match.teamHome} - ${match.teamAway}: ${result} (${scoreType})`);
        match.score = { fullTime: score, type: scoreType };
        match.result = result;
        match.profit = result === 'win' ? match.odds[scoreType] - 1 : -1;
        match.date = dateString;

        filteredMatchesData.push(match);
      }
    } catch (error) {
      console.error(`Error checking match ${match.id}:`, error);
    }
  }

  const dayProfit = {
    date: dateString,
    win: filteredMatchesData.filter((match) => match.result === 'win').length,
    lose: filteredMatchesData.filter((match) => match.result === 'lose').length,
    total: filteredMatchesData.length,
    profit: filteredMatchesData.reduce((acc, match) => {
      return acc + match.profit.toFixed(2);
    }, 0),
  };

  summProfit.forEach((profit, index) => {
    if (profit.date !== dateString) {
      summProfit.push(dayProfit);
    }
  });

  console.log(`check yesterday predictions end...`, dayProfit);

  const message = createResultMessage(dayProfit);

  fs.writeFileSync(filePath, JSON.stringify(matchesData, null, 2));
  fs.writeFileSync('./summary/total.json', JSON.stringify([...allMatches, ...filteredMatchesData], null, 2));
  fs.writeFileSync('./summary/profit.json', JSON.stringify(summProfit, null, 2));

  await sendTelegramMessage(message);
}

async function scrapeLeagueData(page, leagueUrl) {
  try {
    await page.goto(`${BASE_URL}${leagueUrl}`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    const leagueName = leagueUrl ? leagueUrl : `All ${new Date().toLocaleString()} matches`;

    console.log(`Get summary from ${leagueName}...${new Date().toLocaleString()}`);
    // отримання матчів початок
    const matches = await page.evaluate(() => {
      const results = [];
      const eventBlocks = document.querySelectorAll('.leagues--live .event__match--scheduled');
      if (eventBlocks.length === 0) {
        console.log(`No matches in the league today.`);
        return results;
      }

      eventBlocks.forEach((block) => {
        const id = block.getAttribute('id').replace('g_1_', '');
        const teamHome = block.querySelector('.event__participant--home')?.textContent.trim();
        const teamAway = block.querySelector('.event__participant--away')?.textContent.trim();
        const date = block.querySelector('.event__time')?.textContent;
        if (date) {
          results.push({
            id,
            date: /(\d{2}:\d{2})/.exec(date)[1],
            teamHome,
            teamAway,
            url: `https://www.flashscore.com/match/${id}/`,
          });
        }
      });

      return results;
    });
    // отримання матчів кінець
    console.log(`Collect matches: `, matches.length);

    const filteredMatches = [];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      console.log(`Parsing match ${i + 1}/${matches.length} (${(((i + 1) / matches.length) * 100).toFixed(2)}%)`);

      await page.goto(`${match.url}/#/odds-comparison/1x2-odds/full-time`, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      const selectedMatch = await page.evaluate((matchItem) => {
        const range = 2;
        const odds1 = document.querySelector('a.oddsCell__odd:nth-child(2) span')?.textContent;
        const oddsx = document.querySelector('a.oddsCell__odd:nth-child(3) span')?.textContent;
        const odds2 = document.querySelector('a.oddsCell__odd:nth-child(4) span')?.textContent;

        if (parseFloat(odds1) >= range && parseFloat(odds2) >= range) {
          const country = document.querySelector('.tournamentHeader__country')?.textContent.toLowerCase().split('-')[0];
          return {
            ...matchItem,
            country,
            odds: {
              home: parseFloat(odds1),
              draw: parseFloat(oddsx),
              away: parseFloat(odds2),
            },
          };
        } else {
          return null;
        }
      }, match);

      if (selectedMatch) {
        const droppingOdds = await page.evaluate(() => {
          const processOddsChange = (title) => {
            const odds = title.split(' » ').map(Number);
            if (odds.length === 2 && !isNaN(odds[0]) && !isNaN(odds[1])) {
              console.log(`odds:`, ((odds[1] - odds[0]) / odds[0]) * 100);
              return ((odds[1] - odds[0]) / odds[0]) * 100;
            }
            return null;
          };
          const averageChange = (changes) => {
            const total = changes.reduce((acc, change) => acc + change, 0);
            return Math.round(total / changes.length);
          };

          const oddsChanges = Array.from(document.querySelectorAll('.ui-table__body .ui-table__row')).map((row) => {
            const homeChange = processOddsChange(
              row.querySelector('a.oddsCell__odd:nth-child(2)')?.getAttribute('title')
            );
            const drawChange = processOddsChange(
              row.querySelector('a.oddsCell__odd:nth-child(3)')?.getAttribute('title')
            );
            const awayChange = processOddsChange(
              row.querySelector('a.oddsCell__odd:nth-child(4)')?.getAttribute('title')
            );
            return { homeChange, drawChange, awayChange };
          });

          if (oddsChanges.length === 0) return '';
          console.log(`oddsChanges:`, oddsChanges);
          return {
            home: averageChange(oddsChanges.map((change) => change.homeChange)),
            draw: averageChange(oddsChanges.map((change) => change.drawChange)),
            away: averageChange(oddsChanges.map((change) => change.awayChange)),
          };
        });

        // прогноз
        let prediction = '';

        if (droppingOdds.home < 0 && droppingOdds.away > 9) {
          prediction = 'home';
          if (droppingOdds.draw <= 0 && droppingOdds.draw >= -5) {
            prediction = 'draw';
          }
        }
        if (droppingOdds.away < 0 && droppingOdds.home > 11 && droppingOdds.draw < -1 && droppingOdds.draw > -8) {
          prediction = 'away';
        }

        if (prediction) {
          selectedMatch.droppingOdds = droppingOdds;
          selectedMatch.prediction = prediction;
          console.log(`find match: `, prediction);
          filteredMatches.push(selectedMatch);
        }
      }
    }

    console.log(`filtered matches `, filteredMatches.length);

    return filteredMatches;
  } catch (error) {
    console.error('Error scraping data:', error);
    return [];
  }
}

async function scrapeData({ all: all = false }) {
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
  });

  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
      request.abort();
    } else {
      request.continue();
    }
  });

  await checkPredictions(page);

  let allMatches = [];

  console.log(`Statring scraping... ${new Date().toLocaleString()}`);

  if (all) {
    await page.setUserAgent(USER_AGENTS);
    const leagueMatches = await scrapeLeagueData(page, '');
    allMatches = allMatches.concat(leagueMatches);
  } else {
    for (const league of LEAGUES) {
      await page.setUserAgent(USER_AGENTS);

      const leagueMatches = await scrapeLeagueData(page, league);
      allMatches = allMatches.concat(leagueMatches);
    }
  }

  console.log(`done! add ${allMatches.length} ... ${new Date().toLocaleString()}`);

  await browser.close();
  return allMatches;
}

function saveDataToFile(data) {
  if (data.length === 0) return;
  const today = new Date();
  const dateString = `${(today.getMonth() + 1).toString().padStart(2, '0')}-${today
    .getDate()
    .toString()
    .padStart(2, '0')}-${today.getFullYear()}`;
  const filePath = `./results/${dateString}.json`;

  let existingData = [];
  if (fs.existsSync(filePath)) {
    const rawData = fs.readFileSync(filePath);
    existingData = JSON.parse(rawData);
  }

  const uniqueData = [...existingData, ...data].reduce((acc, match) => {
    const existingMatchIndex = acc.findIndex((m) => m.id === match.id);
    if (existingMatchIndex === -1) {
      acc.push(match);
    }
    return acc;
  }, []);

  fs.writeFile(filePath, JSON.stringify(uniqueData, null, 2), (err) => {
    if (err) {
      console.error('Помилка при збереженні даних:', err);
      return;
    }
    console.log(`Data saved ${new Date().toLocaleString()}`);
  });
}

function isWeekday() {
  const dayOfWeek = new Date().getDay();
  // Понедельник = 1, вторник = 2, ..., воскресенье = 0 или 7
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

function scrapeDataBasedOnDay() {
  const all = isWeekday();
  console.log(`Today scraping: ${all ? 'all' : 'top'} matches`);
  scrapeData({ all })
    .then((data) => {
      saveDataToFile(data);
      if (data.length > 0) {
        const message = createPredictionMessage(data);
        sendTelegramMessage(message)
          .then(console.log)
          .catch((e) => console.error(e.code));
      }
    })
    .catch(console.error);
}

scrapeDataBasedOnDay();
