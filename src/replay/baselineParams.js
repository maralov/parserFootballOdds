/**
 * Знімок параметрів моделі до підкрутки (replay / порівняння з production).
 * Не імпортувати з worker — лише для скриптів replay.
 */
const WINDOW_MINUTE_ADJ = {
  '60-69': -0.03,
  '70-75': 0,
  '76-80': 0.03,
  '81-84': 0.05,
  '85+': 0.12,
};

const THRESHOLDS = {
  '60-70': { minPDryUnder: 0.52, minPGoalOver: 1 },
  '70-80': { minPDryUnder: 0.54, minPGoalOver: 0.60 },
  '80-90+': { minPDryUnder: 1, minPGoalOver: 0.55 },
};

const pGoalMaxForUnder60_70 = 0.48;
/** 0 = стара поведінка: при виконанні обох порогів у 70–80 завжди обирати ТБ або ТМ */
const tieBreakMinMargin = 0;

module.exports = {
  WINDOW_MINUTE_ADJ,
  THRESHOLDS,
  pGoalMaxForUnder60_70,
  tieBreakMinMargin,
};
