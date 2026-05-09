'use strict';

const MODE_LABELS = {
  basic: 'Базовий',
  detailed: 'Повний',
  detailed_ai: 'Повний АІ',
};

function modelModeLabel(mode) {
  if (!mode || typeof mode !== 'string') return 'Невідомий режим';
  return MODE_LABELS[mode] || 'Невідомий режим';
}

module.exports = {
  MODE_LABELS,
  modelModeLabel,
};
