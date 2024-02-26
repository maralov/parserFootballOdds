const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const dateFns = require('date-fns');

require('dotenv').config();

const { USER_AGENTS, LEAGUES, BASE_URL } = require('./helpers/constants');

const sendTelegramMessage = require('./helpers/utils/sendTelegramMessage');
const createPredictionMessage = require('./helpers/utils/createPredictionMessage');
const createResultMessage = require('./helpers/utils/createResultMessage');

const threshold = -8; // Поріг для падіння коефіцієнтів

let executablePath;
if (os.platform() === 'linux') {
  executablePath = '/usr/bin/google-chrome';
} else if (os.platform() === 'darwin') {
  executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function getTeamForm(page, sectionIndex) {
  return await page.evaluate((index) => {
    const rows = document.querySelectorAll('.h2h__section.section')[index].querySelectorAll('.h2h__row');
    return Array.from(rows).map((row) => {
      const date = row.querySelector('.h2h__date').textContent.trim();

      const scoreHome = row.querySelector('.h2h__result span:first-child').textContent.trim();
      const scoreAway = row.querySelector('.h2h__result span:last-child').textContent.trim();

      const resElement = row.querySelector('.h2h__icon div');
      const res = resElement ? resElement.getAttribute('title').charAt(0) : ''; // 'W', 'D', or 'L'
      return {
        date,
        score: `${scoreHome}:${scoreAway}`,
        res,
      };
    });
  }, sectionIndex);
}

function evaluateFormTrend(form) {
  let trendScore = 0;
  let weight = 1.0; // Вес последней игры

  form.forEach((match, index) => {
    const [goalsFor, goalsAgainst] = match.score.split(':').map(Number);
    let matchScore = 0;

    if (match.res === 'W') {
      matchScore = 1 + (goalsFor - goalsAgainst) / 5; // Учитываем разницу голов
    } else if (match.res === 'D') {
      matchScore = (goalsFor - goalsAgainst) / 5; // Ничья с большой разницей голов оценивается выше
    } else if (match.res === 'L') {
      matchScore = -1 - (goalsAgainst - goalsFor) / 5; // Большая разница голов в поражении оценивается ниже
    }

    trendScore += matchScore * weight;
    weight *= 0.8; // Уменьшаем вес для предыдущих игр
  });

  return trendScore > 0.5 ? 'upward' : trendScore < -0.5 ? 'downward' : 'stable';
}

function calculateTeamForm(standings, isHomeGame, totalTeams) {
  let points = 0;
  let totalGoalsScored = 0;
  let totalGoalsConceded = 0;
  let formTrendFactor = 0;
  let matchWeight = 1.5; // Більше ваги для останніх матчів

  standings.form.forEach((match, index) => {
    totalGoalsScored += parseInt(match.score.split(':')[0]);
    totalGoalsConceded += parseInt(match.score.split(':')[1]);

    switch (match.res) {
      case 'W':
        points += 3 * matchWeight;
        break;
      case 'D':
        points += matchWeight;
        break;
      case 'L':
        points += 0;
        break;
    }

    formTrendFactor += index * (match.res === 'W' ? 1 : match.res === 'D' ? 0.5 : 0);
    matchWeight -= 0.2; // Зменшення ваги для більш р
  });

  const averageGoalsScored = totalGoalsScored / standings.form.length;
  const averageGoalsConceded = totalGoalsConceded / standings.form.length;

  // Врахування місця в таблиці
  const tablePositionFactor = 1 - standings.rank / totalTeams;

  // Врахування різниці голів
  const goalDifferenceFactor = standings.goalDifference / 10;

  // Фактор домашньої переваги
  let homeAdvantageFactor = isHomeGame ? 1.1 : 1.0;

  // Формула загального рейтингу
  return (
    ((points / (15 * 1.5)) * 0.4 + // Загальні очки з підвищеною вагою для останніх матчів
      (averageGoalsScored - averageGoalsConceded) * 0.2 + // Різниця між забитими і пропущеними голами
      tablePositionFactor * 0.2 + // Позиція в таблиці
      goalDifferenceFactor * 0.1 + // Різниця голів
      (formTrendFactor / standings.form.length) * 0.1) * // Тенденція останніх матчів
    homeAdvantageFactor
  );
}

function analyzeAndPredictMatch(match) {
  const homeFormRating = calculateTeamForm(match.standings.home, true, match.standings.totalTeams);
  const awayFormRating = calculateTeamForm(match.standings.away, false, match.standings.totalTeams);
  const homeFormTrend = evaluateFormTrend(match.standings.home.form);
  const awayFormTrend = evaluateFormTrend(match.standings.away.form);
  const formDifference = homeFormRating - awayFormRating;
  let prediction = '';

  // Проверка на сильное падение коэффициентов и сравнение с формой и трендом
  if (homeFormTrend === 'downward' && awayFormTrend === 'downward' && formDifference < 0.4) {
    prediction = 'home';
  } else if (awayFormTrend === 'upward' && homeFormTrend === 'downward' && formDifference < 0.3) {
    prediction = 'away';
  } else if (
    (homeFormTrend === 'upward' &&
      awayFormTrend === 'upward' &&
      match.droppingOdds.draw < threshold * 0.5 &&
      formDifference < 0.1) ||
    (homeFormTrend !== 'downward' &&
      match.droppingOdds.draw < 0 &&
      checkForPossibleDraw(match, homeFormRating, awayFormRating))
  ) {
    prediction = 'draw';
  }
  console.log({
    prediction,
    homeFormRating,
    awayFormRating,
    homeFormTrend,
    awayFormTrend,
  });
  // Если ни один из сценариев не применим, можно оставить прогноз пустым или рассмотреть другие факторы
  return prediction;
}
function checkForPossibleDraw(match, homeFormRating, awayFormRating) {
  const formDifference = Math.abs(homeFormRating - awayFormRating);
  const tableDifference = Math.abs(match.standings.home.rank - match.standings.away.rank);
  return (
    (formDifference < 0.2 && tableDifference < 4) ||
    (formDifference > 0.2 && formDifference < 0.4 && tableDifference > 3 && tableDifference < 6)
  );
}

async function getLastCheckedDate() {
  const lastCheckedPath = './summary/lastChecked.json';
  if (fs.existsSync(lastCheckedPath)) {
    const lastCheckedData = JSON.parse(fs.readFileSync(lastCheckedPath));
    return lastCheckedData.date;
  }
  return null; // або поверніть дату, від якої ви хочете почати перевірку
}

async function checkPredictions(page, path = '') {
  const lastCheckedDateStr = await getLastCheckedDate();
  let lastCheckedDate = lastCheckedDateStr
    ? dateFns.parse(lastCheckedDateStr, 'MM-dd-yyyy', new Date())
    : dateFns.subDays(new Date(), 1);

  // Починаємо перевірку з наступного дня після останньої перевіреної дати
  let currentDate = dateFns.addDays(lastCheckedDate, 1);

  while (dateFns.isBefore(currentDate, new Date())) {
    const dateString = dateFns.format(currentDate, 'MM-dd-yyyy');
    const filePath = `./results/${dateString}.json`;

    if (fs.existsSync(filePath)) {
      console.log(`Перевіряємо результати за ${dateString}.`);
      const matchesData = JSON.parse(fs.readFileSync(filePath));
      const allMatches = JSON.parse(fs.readFileSync('./summary/total.json'));
      const summProfit = JSON.parse(fs.readFileSync('./summary/profit.json'));
      console.log(`check  predictions start...`);

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
            const scoreElementsFullTime = document.querySelectorAll(
              '.duelParticipant__score .detailScore__fullTime span'
            );
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

            match.standings.home.form = {
              rating: calculateTeamForm(match.standings.home, true, match.standings.totalTeams),
              trend: evaluateFormTrend(match.standings.home.form),
            };
            match.standings.away.form = {
              rating: calculateTeamForm(match.standings.away, false, match.standings.totalTeams),
              trend: evaluateFormTrend(match.standings.away.form),
            };

            filteredMatchesData.push(match);
          }
        } catch (error) {
          console.error(`Error checking match ${match.id}:`, error);
        }
      }

      const dayProfit = filteredMatchesData.reduce((acc, match) => {
        return acc + match.profit;
      }, 0);

      const dayResult = {
        date: dateString,
        win: filteredMatchesData.filter((match) => match.result === 'win').length,
        lose: filteredMatchesData.filter((match) => match.result === 'lose').length,
        total: filteredMatchesData.length,
        profit: dayProfit,
        totalProfit: summProfit[summProfit.length - 1].totalProfit + dayProfit,
      };

      const isExistProfit = summProfit.find((profit) => profit.date === dateString);

      if (!isExistProfit) {
        summProfit.push(dayResult);
      }

      console.log(`check yesterday predictions end...`, dayResult);

      const message = createResultMessage(dayResult);

      await sendTelegramMessage(message);
      fs.writeFileSync(filePath, JSON.stringify(matchesData, null, 2));
      fs.writeFileSync('./summary/total.json', JSON.stringify([...allMatches, ...filteredMatchesData], null, 2));
      fs.writeFileSync('./summary/profit.json', JSON.stringify(summProfit, null, 2));
      fs.writeFileSync('./summary/lastChecked.json', JSON.stringify({ date: dateString }));
    } else {
      console.log(`Немає файлу з прогнозами за ${dateString}.`);
    }

    // Переходимо до наступної дати
    currentDate = dateFns.addDays(currentDate, 1);
  }
}

async function scrapeLeagueData(page, leagueUrl) {
  try {
    await page.goto(`${BASE_URL}${leagueUrl}`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

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
        const range = 2.1;
        const odds1 = document.querySelector('a.oddsCell__odd:nth-child(2) span')?.textContent;
        const oddsx = document.querySelector('a.oddsCell__odd:nth-child(3) span')?.textContent;
        const odds2 = document.querySelector('a.oddsCell__odd:nth-child(4) span')?.textContent;
        const country = document.querySelector('.tournamentHeader__country')?.textContent.toLowerCase().split(':')[0];
        if (parseFloat(odds1) > range && parseFloat(odds2) > range) {
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

      if (selectedMatch && LEAGUES.includes(selectedMatch?.country)) {
        selectedMatch.droppingOdds = await page.evaluate(() => {
          const processOddsChange = (title) => {
            const odds = title.split(' » ').map(Number);
            if (odds.length === 2 && !isNaN(odds[0]) && !isNaN(odds[1])) {
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
          return {
            home: averageChange(oddsChanges.map((change) => change.homeChange)),
            draw: averageChange(oddsChanges.map((change) => change.drawChange)),
            away: averageChange(oddsChanges.map((change) => change.awayChange)),
          };
        });

        // Парсинг даних про ранг
        console.log(`Parsing standings...`);
        await page.goto(`${match.url}#/standings/table/overall`, { waitUntil: 'networkidle2', timeout: 60000 });
        selectedMatch.standings = await page.evaluate(
          (teamHome, teamAway) => {
            try {
              const tableRows = document.querySelectorAll('.ui-table__body .table__row--selected');
              const totalTeams = document.querySelectorAll('.ui-table__body .ui-table__row').length;
              const standing = {};
              if (totalTeams < 5) {
                console.info(`Not enough teams in the league.`);
                return standing;
              } else {
                standing.totalTeams = totalTeams;
              }
              tableRows.forEach((row) => {
                const teamName = row.querySelector('.tableCellParticipant__name').textContent.trim();
                if (teamName === teamHome || teamName === teamAway) {
                  const rank = parseInt(row.querySelector('.tableCellRank').textContent.replace('.', ''), 10);
                  const points = parseInt(row.querySelector('.table__cell--points').textContent, 10);
                  const goals = parseInt(row.querySelector('.table__cell--score').textContent, 10);
                  const goalDifference = parseInt(
                    row.querySelector('.table__cell--goalsForAgainstDiff').textContent,
                    10
                  );
                  const selected = teamName === teamHome ? 'home' : 'away';
                  standing[selected] = { rank, points, goals, goalDifference };
                }
              });
              return standing;
            } catch (e) {
              console.error(e);
              return {};
            }
          },
          match.teamHome,
          match.teamAway
        );
        console.log(`Parsing standings end:`, Object.keys(selectedMatch.standings).length > 0);

        if (Object.keys(selectedMatch.standings).length > 0) {
          await page.goto(`${match.url}#/h2h/overall`, { waitUntil: 'networkidle2', timeout: 60000 });
          await page.waitForSelector('.h2h__section.section');

          const homeForm = await getTeamForm(page, 0);
          const awayForm = await getTeamForm(page, 1);

          selectedMatch.standings.home.form = homeForm;
          selectedMatch.standings.away.form = awayForm;
        }

        console.log(`droppingOdds:`, {
          droppingOdds: selectedMatch.droppingOdds,
          matchUrl: selectedMatch.url,
        });

        if (
          selectedMatch.standings?.home?.form?.length > 3 &&
          selectedMatch.standings?.away?.form?.length > 3 &&
          (selectedMatch.droppingOdds.home <= threshold ||
            selectedMatch.droppingOdds.away <= threshold ||
            selectedMatch.droppingOdds.draw <= threshold * 0.5)
        ) {
          console.log('analyze prediction...');
          selectedMatch.prediction = analyzeAndPredictMatch(selectedMatch);
        }

        if (selectedMatch.prediction) {
          console.log(`prediction: `, selectedMatch.prediction);
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

async function scrapeData() {
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

  await page.setUserAgent(USER_AGENTS);
  const leagueMatches = await scrapeLeagueData(page, '');
  allMatches = allMatches.concat(leagueMatches);

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

function scrapeDataBasedOnDay() {
  scrapeData()
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
