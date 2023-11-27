const puppeteer = require('puppeteer-core');
const fs = require('fs');

const userAgent = require('./helpers/constants');
const os = require("os");

const BASE_URL = 'https://www.flashscore.com/football/';
const leagues = [
	'austria/admiral-bundesliga',
	'england/premier-league',
	'spain/laliga',
	'italy/serie-a',
	'germany/bundesliga',
	'france/ligue-1',
	'belgium/jupiler-league',
	'norway/eliteserien',
	'denmark/superliga/',
	'netherlands/eredivisie',
	'belgium/jupiler-pro-league',
	'europe/champions-league',
	'europe/europa-league',
];

let executablePath;
if (os.platform() === 'linux') {
	executablePath = '/usr/bin/google-chrome';
} else if (os.platform() === 'darwin') {
	executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function filterMatchByOdds(page, match, range = 2) {
	await page.goto(match.url, {waitUntil: 'networkidle2', timeout: 60000});

	const odds = await page.evaluate(() => {
		const odds1 = document.querySelector('.o_1 .oddsValueInner')?.textContent;
		const odds2 = document.querySelector('.o_2 .oddsValueInner')?.textContent;

		return {
			odds1: parseFloat(odds1),
			odds2: parseFloat(odds2),
		};
	});

	if (odds.odds1 >= range && odds.odds2 >= range) {
		return match;
	}
}

async function scrapeLeagueData(page, leagueUrl) {
	await page.goto(`${BASE_URL}${leagueUrl}`, {
		waitUntil: 'networkidle2',
		timeout: 60000,
	});

	const leagueName = leagueUrl ? leagueUrl : `All ${new Date().toLocaleString()} matches`

	console.log(`Get summary from ${leagueName}...${new Date().toLocaleString()}`);

	const matches = await page.evaluate((league) => {
		const results = [];
		const eventBlocks = document.querySelectorAll('.leagues--live .event__match--scheduled');
		const country = league.split('/')[0];
		if (eventBlocks.length === 0) {
			console.log(`No matches in the league (${country}) today.`);
			return results;
		}

		eventBlocks.forEach((block) => {
			const id = block.getAttribute('id').replace('g_1_', '');
			const teamHome = block.querySelector('.event__participant--home')?.textContent.trim();
			const teamAway = block.querySelector('.event__participant--away')?.textContent.trim();
			const date = block.querySelector('.event__time')?.textContent;

			results.push({
				country,
				id,
				date,
				teamHome,
				teamAway,
				url: `https://www.flashscore.com/match/${id}/`,
			});
		});

		return results;
	}, leagueName);

	console.log(`Collect matches: `, matches.length);

	const filteredMatches = [];

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		console.log(`Parsing match ${i + 1}/${matches.length} (${((i + 1) / matches.length * 100).toFixed(2)}%)`);

		const filteredMatch = await filterMatchByOdds(page, match,);

		if (filteredMatch) {
			await page.goto(`${match.url}/#/odds-comparison/1x2-odds/full-time`, {
				waitUntil: 'networkidle2',
				timeout: 60000,
			});
			const droppingOdds = await page.evaluate(() => {
				const processOddsChange = (title) => {
					const odds = title.split(' » ').map(Number);
					if (odds.length === 2 && !isNaN(odds[0]) && !isNaN(odds[1])) {
						console.log(`odds:`, (odds[1] - odds[0]) / odds[0] * 100);
						return (odds[1] - odds[0]) / odds[0] * 100;
					}
					return null;
				};

				const averageChange = (changes) => {
					const total = changes.reduce((acc, change) => acc + change, 0);
					return (Math.round(total / changes.length));
				};

				const oddsChanges = Array.from(document.querySelectorAll('.ui-table__body .ui-table__row')).map(row => {
					const homeChange = processOddsChange(row.querySelector('a.oddsCell__odd:nth-child(2)')?.getAttribute('title'));
					const drawChange = processOddsChange(row.querySelector('a.oddsCell__odd:nth-child(3)')?.getAttribute('title'));
					const awayChange = processOddsChange(row.querySelector('a.oddsCell__odd:nth-child(4)')?.getAttribute('title'));
					return {homeChange, drawChange, awayChange};
				});

				console.log(`oddsChanges:`, oddsChanges)

				if (oddsChanges.length === 0) return '';

				return {
					home: averageChange(oddsChanges.map(change => change.homeChange)),
					draw: averageChange(oddsChanges.map(change => change.drawChange)),
					away: averageChange(oddsChanges.map(change => change.awayChange))
				};
			});

			filteredMatch.droppingOdds = droppingOdds;

			filteredMatches.push(filteredMatch);
		}
	}
	console.log(`filtered matches `, filteredMatches.length);
	return filteredMatches;
}

async function scrapeData({all: all = false}) {
	const browser = await puppeteer.launch({
		executablePath,
		headless: 'new',
	});
	console.log(`Statring scraping... ${new Date().toLocaleString()}`);
	const page = await browser.newPage();
	await page.setRequestInterception(true)
	page.on('request', request => {
		if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
			request.abort();
		} else {
			request.continue();
		}
	});
	let allMatches = [];

	if (all) {
		await page.setUserAgent(userAgent);
		const leagueMatches = await scrapeLeagueData(page, '');
		allMatches = allMatches.concat(leagueMatches);
	} else {
		for (const league of leagues) {

			await page.setUserAgent(userAgent);

			const leagueMatches = await scrapeLeagueData(page, league);
			allMatches = allMatches.concat(leagueMatches);
		}
	}

	console.log(`done! add ${allMatches.length}/${new Date().toLocaleString()}`);

	await browser.close();
	return allMatches;
}

function saveDataToFile(data) {
	const today = new Date();
	const dateString = `${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}-${today.getFullYear()}`;
	fs.writeFile(`./results/${dateString}.json`, JSON.stringify(data, null, 2), (err) => {
		if (err) {
			console.error('Помилка при збереженні даних:', err);
			return;
		}
		console.log(`Data saved ${new Date().toLocaleString()}`);
	});
}

scrapeData({all: true})
	.then((filteredData) => {
		saveDataToFile(filteredData);
	})
	.catch(console.error);
