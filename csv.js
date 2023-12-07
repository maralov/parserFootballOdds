const fs = require('fs');
//
function saveToCSV(data, filename) {
	const header = 'Team Home,Team Away, Country, Home Odds Change,Draw Odds Change,Away Odds Change,URL,Prediction\n';
	if (data.length === 0) {
		console.log('No matches to save');
		return;
	}
	const rows = data.map(match => {
		const country = match.country !== undefined ? match.country : '""';
		const prediction = match.prediction !== undefined ? match.prediction : '""';

		return `"${match.teamHome}","${match.teamAway}",${country},${match.droppingOdds.home},${match.droppingOdds.draw},${match.droppingOdds.away},"${match.url}", ${prediction}`;
	}).join('\n');

    fs.writeFileSync(filename, header + rows);
}

function importAndSaveData() {
	const today = new Date();
	const dateString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`

	const rawData = fs.readFileSync(`./results/${dateString}.json`);
	const data = JSON.parse(rawData);
	const csvFile = `./csv/${dateString}.csv`;
	saveToCSV(data, csvFile);
}

importAndSaveData();

