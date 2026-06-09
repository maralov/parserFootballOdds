'use strict';

const { escapeMarkdownV2, escapeMarkdownV2LinkUrl } = require('./markdown');
const { buildFlashscoreDesktopUrl } = require('./flashscoreUrl');

const GGBET_URL = 'https://ggbet.ua/en/live?sportId=football';

function fixed2(value) {
	if (value == null || !Number.isFinite(Number(value))) return 'n/a';
	return Number(value).toFixed(2);
}

function trackLabel(decisionKey) {
	if (decisionKey === 'tm05') return 'ТМ 0,5 матчу';
	if (decisionKey === 'tb05') return 'ТБ 0,5 матчу';
	if (decisionKey === 'tm05_1h') return '1HUNDER · ТМ 0,5 тайму';
	return String(decisionKey || '');
}

function trackEmoji(decisionKey) {
	if (decisionKey === 'tm05') return '🟢';
	if (decisionKey === 'tb05') return '🔴';
	if (decisionKey === 'tm05_1h') return '🟡';
	return '⚪';
}

function pickProbability(prediction, decisionKey) {
	if (decisionKey === 'tm05') return prediction?.pNoGoal;
	if (decisionKey === 'tb05') return prediction?.pGoal;
	if (decisionKey === 'tm05_1h') return prediction?.pNoGoal;
	return null;
}

function pickTeams(match) {
	const home = match?.homeTeam || match?.home;
	const away = match?.awayTeam || match?.away;
	return { home, away };
}

function renderKeySignals(signals) {
	if (!Array.isArray(signals) || !signals.length) return '';
	const top = signals.slice(0, 5);
	return top
		.map(
			(s) =>
				`• ${escapeMarkdownV2(String(s.signal))}: ${escapeMarkdownV2(String(s.value))} \\[${escapeMarkdownV2(String(s.weight || 'med'))}\\]`,
		)
		.join('\n');
}

function formatEntryMessage({ match, prediction, decisionKey, minute, score }) {
	if (!match || !prediction) return null;
	const { home, away } = pickTeams(match);
	if (!home || !away) return null;

	const probability = pickProbability(prediction, decisionKey);
	const ev = prediction.evGate?.ev;
	const odds = prediction.odds;
	const score_value = decisionKey === 'tb05' ? prediction.psScore : prediction.dsScore;
	const scoreLabel = decisionKey === 'tb05' ? 'PS' : decisionKey === 'tm05_1h' ? 'DS1H' : 'DS';

	const league = match.league || match.tournament || 'Unknown league';
	const country = match.country || '';
	const leagueLine = country
		? `${escapeMarkdownV2(league)} \\(${escapeMarkdownV2(country)}\\)`
		: escapeMarkdownV2(league);
	const scoreText = score || '0:0';
	const desktopUrl = buildFlashscoreDesktopUrl(match.matchUrl || match.url);

	const lines = [
		`${trackEmoji(decisionKey)} *СИГНАЛ: ${escapeMarkdownV2(trackLabel(decisionKey))}* @ ${escapeMarkdownV2(fixed2(odds))}`,
		`🏟 *${escapeMarkdownV2(home)} — ${escapeMarkdownV2(away)}*`,
		`🏆 ${leagueLine}`,
		`⏱ ${escapeMarkdownV2(String(minute ?? '?'))}' · ${escapeMarkdownV2(scoreText)}`,
		'',
		`📊 ${escapeMarkdownV2(scoreLabel)}\\=${escapeMarkdownV2(String(score_value ?? '?'))} · p\\=${escapeMarkdownV2(fixed2(probability))} · EV\\=${escapeMarkdownV2(fixed2(ev))}`,
		`📈 confidence\\=${escapeMarkdownV2(fixed2(prediction.confidence))}`,
	];

	if (decisionKey === 'tm05_1h' && prediction.calibrated !== true) {
		lines.push('⚠️ некалібровано · малий стейк');
	}

	const signalsBlock = renderKeySignals(prediction.keySignals);
	if (signalsBlock) {
		lines.push('', '🔑 *Сигнали:*', signalsBlock);
	}

	if (prediction.reasoning) {
		lines.push('', `💭 ${escapeMarkdownV2(prediction.reasoning)}`);
	}

	lines.push('');
	if (desktopUrl) {
		lines.push(`🔗 [Flashscore](${escapeMarkdownV2LinkUrl(desktopUrl)})`);
	}
	lines.push(`🎯 [GGBET](${escapeMarkdownV2LinkUrl(GGBET_URL)})`);

	return lines.join('\n');
}

module.exports = {
	formatEntryMessage,
	trackLabel,
	GGBET_URL,
};
