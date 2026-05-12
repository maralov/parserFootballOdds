'use strict';

// Default neutral bias (50/100). Populate per-league after backtest.
// Higher dryness = league trends to low-scoring 2H.
// Higher pressure = league trends to late goals.

const DRYNESS_BIAS = {
  // 'ITALY:Serie A': 60,
  // 'ENGLAND:Premier League': 45,
};

const PRESSURE_BIAS = {
  // 'GERMANY:Bundesliga': 60,
};

const DEFAULT_BIAS = 50;

function leagueKey(match) {
  if (!match) return null;
  const country = (match.country || '').toUpperCase();
  const league = match.league || '';
  if (!country || !league) return null;
  return `${country}:${league}`;
}

function drynessBiasFor(match) {
  const key = leagueKey(match);
  if (key && DRYNESS_BIAS[key] != null) return DRYNESS_BIAS[key];
  return DEFAULT_BIAS;
}

function pressureBiasFor(match) {
  const key = leagueKey(match);
  if (key && PRESSURE_BIAS[key] != null) return PRESSURE_BIAS[key];
  return DEFAULT_BIAS;
}

module.exports = {
  DRYNESS_BIAS,
  PRESSURE_BIAS,
  DEFAULT_BIAS,
  drynessBiasFor,
  pressureBiasFor,
  leagueKey,
};
