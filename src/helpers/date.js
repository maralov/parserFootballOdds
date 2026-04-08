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
  toISO,
  timeHHmm,
  hour,
  dayOfWeek,
  yesterday,
};
