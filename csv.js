const fs = require('fs');
//
function saveToCSV() {
  const data = JSON.parse(fs.readFileSync('./summary/total.json'));
  const header =
    'Home Odds Change,Draw Odds Change,Away Odds Change,URL,Prediction,homeFormTrend,awayFormTrend,homeFormRating,awayFormRating,ScoreType,BetResult\n';
  if (data.length === 0) {
    console.log('No matches to save');
    return;
  }

  const ratedData = data.filter((match) => match.standings.home.form.trend !== undefined);
  const rows = ratedData
    .map((match) => {
      const prediction = match.prediction !== undefined ? match.prediction : '""';

      const homeFormTrend = match.standings.home.form.trend || '""';
      const awayFormTrend = match.standings.away.form.trend || '""';
      const awayFormRating = match.standings.away.form.rating || '""';
      const homeFormRating = match.standings.home.form.rating || '""';

      return `${match.droppingOdds.home},${match.droppingOdds.draw},${match.droppingOdds.away},"${match.url}", ${prediction}, ${homeFormTrend}, ${awayFormTrend}, ${homeFormRating}, ${awayFormRating}, ${match.score.type}, ${match.result}`;
    })
    .join('\n');

  fs.writeFileSync('./csv/summary.csv', header + rows);
}

saveToCSV();
