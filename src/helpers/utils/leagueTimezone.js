// UTC offsets for April (CEST/summer time in Europe, EDT in USA).
// Values are hours (can be fractional, e.g. 5.5 for India).
const OFFSETS = {
  'КИТАЙ':                                5.5, // placeholder — actually 8, set below
  'ЯПОНІЯ':                               9,
  'ПІВДЕННА КОРЕЯ':                       9,
  'ІНДІЯ':                                5.5,
  'ТАЇЛАНД':                              7,
  'ІНДОНЕЗІЯ':                            7,
  'АВСТРАЛІЯ':                            10, // AEST+1 (AEDT ends ~April)
  'НОВА ЗЕЛАНДІЯ':                        12,

  'ЄГИПЕТ':                               3,
  'ТУРЕЧЧИНА':                            3,
  'ІЗРАЇЛЬ':                              3,
  'САУДІВСЬКА АРАВІЯ':                    3,
  "ОБ'ЄДНАНІ АРАБСЬКІ ЕМІРАТИ":          4,

  'РОСІЯ':                                3,
  'УКРАЇНА':                              3,
  'ФІНЛЯНДІЯ':                            3,
  'ГРЕЦІЯ':                               3,
  'РУМУНІЯ':                              3,
  'БОЛГАРІЯ':                             3,

  'ПОЛЬЩА':                               2,
  'ЧЕХІЯ':                                2,
  'СЛОВАЧЧИНА':                           2,
  'УГОРЩИНА':                             2,
  'ХОРВАТІЯ':                             2,
  'СЕРБІЯ':                               2,
  'АВСТРІЯ':                              2,
  'ШВЕЙЦАРІЯ':                            2,
  'НІДЕРЛАНДИ':                           2,
  'БЕЛЬГІЯ':                              2,
  'ФРАНЦІЯ':                              2,
  'ІСПАНІЯ':                              2,
  'ІТАЛІЯ':                               2,
  'ЛАТВІЯ':                               3,
  'ЛИТВА':                                3,
  'ЕСТОНІЯ':                              3,
  'НОРВЕГІЯ':                             2,
  'ШВЕЦІЯ':                               2,
  'ДАНІЯ':                                2,
  'АНГЛІЯ':                               1,
  'ІРЛАНДІЯ':                             1,
  'ШОТЛАНДІЯ':                            1,
  'УЕЛЬС':                                1,
  'ПОРТУГАЛІЯ':                           1,
  'НІМЕЧЧИНА':                            2,

  'ПІВДЕННА АФРИКА':                      2,
  'АФРИКА':                               2,   // CAF competitions mostly UTC+1..+3, use 2 as default

  'АРГЕНТИНА':                            -3,
  'БРАЗИЛІЯ':                             -3,
  'УРУГВАЙ':                              -3,
  'ПАРАГВАЙ':                             -4,
  'БОЛІВІЯ':                              -4,
  'ЧИЛІ':                                 -4,
  'ВЕНЕСУЕЛА':                            -4,
  'КОЛУМБІЯ':                             -5,
  'ЕКВАДОР':                              -5,
  'ПЕРУ':                                 -5,
  'МЕКСИКА':                              -5,
  'США':                                  -4,  // EDT (Eastern summer)
  'КАНАДА':                               -4,

  'ПІВДЕННА АМЕРИКА':                     -3,
  'ПІВНІЧНА ТА ЦЕНТРАЛЬНА АМЕРИКА':       -5,
  'ЄВРОПА':                               2,
};

// Fix China after declaration (value placeholder above)
OFFSETS['КИТАЙ'] = 8;

/**
 * Returns UTC offset in hours for a given league string (e.g. "АРГЕНТИНА: Primera").
 * Falls back to 3 (Kyiv EEST) if country is unknown.
 */
function getLeagueUtcOffset(league) {
  if (!league) return 3;
  const country = league.split(':')[0].trim().toUpperCase();
  return OFFSETS[country] !== undefined ? OFFSETS[country] : 3;
}

/**
 * Returns the local hour (0-23) for a league's country at a given UTC timestamp (ms).
 */
function getLeagueLocalHour(league, nowUtcMs = Date.now()) {
  const offset = getLeagueUtcOffset(league);
  const nowMs = nowUtcMs ?? Date.now();
  const utcTotalMin = Math.floor(nowMs / 60000) % (24 * 60);
  const localTotalMin = ((utcTotalMin + Math.round(offset * 60)) % (24 * 60) + 24 * 60) % (24 * 60);
  return Math.floor(localTotalMin / 60);
}

module.exports = { getLeagueUtcOffset, getLeagueLocalHour };
