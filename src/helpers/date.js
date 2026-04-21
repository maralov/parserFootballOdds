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
 * Сесійний день: сесія починається о 10:00.
 * До 10:00 — ще попередня сесія (вчорашня дата).
 * Без аргументу — поточна сесія.
 */
function sessionDateKey(d) {
  const t = parse(d);
  if (t.hour() < 10) return t.subtract(1, 'day').format('YYYY-MM-DD');
  return t.format('YYYY-MM-DD');
}

/** Дата попередньої сесії. */
function previousSessionDateKey(d) {
  const t = parse(d);
  const base = t.hour() < 10 ? t.subtract(1, 'day') : t;
  return base.subtract(1, 'day').format('YYYY-MM-DD');
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
  previousSessionDateKey,
  toISO,
  timeHHmm,
  hour,
  dayOfWeek,
  yesterday,
};
