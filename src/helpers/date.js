'use strict';

const dayjs = require('dayjs');
require('dayjs/locale/uk');

dayjs.locale('uk');

function parse(d) {
  if (d === undefined || d === null) return dayjs();
  return dayjs(d);
}

/** Календарний день у локальній зоні (папки логів, «вчора»). */
function dateKeyLocal(d) {
  return parse(d).format('YYYY-MM-DD');
}

/**
 * Сесійний день: сесія з 10:00 до 09:59 наступного дня.
 * До 10:00 ранку — належить до попереднього календарного дня.
 */
function sessionDateKey(d) {
  const t = parse(d);
  return (t.hour() < 10 ? t.subtract(1, 'day') : t).format('YYYY-MM-DD');
}

function toISO(d) {
  return parse(d).toISOString();
}

function timeHHmm(d) {
  return parse(d).format('HH:mm');
}

function hour(d) {
  return parse(d).hour();
}

function dayOfWeek(d) {
  return parse(d).day();
}

function yesterday() {
  return dayjs().subtract(1, 'day');
}

module.exports = {
  dayjs,
  dateKeyLocal,
  sessionDateKey,
  toISO,
  timeHHmm,
  hour,
  dayOfWeek,
  yesterday,
};
