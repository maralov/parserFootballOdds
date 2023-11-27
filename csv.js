const fs = require('fs');
//
function saveToCSV(data, filename) {
	const header = 'Team Home,Team Away, Country, Match Score,First Half Score,Type,Home Odds Change,Draw Odds Change,Away Odds Change,URL,Prediction\n';
	const f = data.filter(m => (m.droppingOdds.home + m.droppingOdds.away + m.droppingOdds.draw) / 3 < -2)
	if (f.length === 0) {
		console.log('No matches to save');
		return;
	}
	const rows = f.map(match => {
		const droppingOdds = match.droppingOdds || {};
		const matchScore = match.score ? `"${match.score.match}"` : '""';
		const firstPartScore = match.score ? `"${match.score.firstPart}"` : '""';
		const matchType = match.score ? `"${match.score.type}"` : '""';
		const country = match.country !== undefined ? match.country : '""';

		let prediction = 'draw';

		if (droppingOdds.away < -20) {
			prediction = 'away';
		}
		if (droppingOdds.home < -30) {
			prediction = 'home';
		}

		return `"${match.teamHome}","${match.teamAway}",${country},${matchScore},${firstPartScore},${matchType},${match.droppingOdds.home},${match.droppingOdds.draw},${match.droppingOdds.away},"${match.url}", ${prediction}`;
	}).join('\n');

    fs.writeFileSync(filename, header + rows);
}

function importAndSaveData(jsonFile, csvBaseFile) {
	const rawData = fs.readFileSync(jsonFile);
	const data = JSON.parse(rawData);
	const today = new Date();
	const dateString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
	const csvFile = `./results/bets/${dateString}.csv`;
	saveToCSV(data, csvFile);
}

importAndSaveData();

