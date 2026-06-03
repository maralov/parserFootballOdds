'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ─── deltaCalculator ──────────────────────────────────────────────────────────

const { subtractStats, buildStatsMap } = require('../src/tracker/deltaCalculator');

describe('deltaCalculator.subtractStats', () => {
  test('subtracts corresponding home/away values', () => {
    const a = {
      totalShots:     { home: 10, away: 20 },
      shotsOnTarget:  { home: 4,  away: 8  },
      cornerKicks:    { home: 3,  away: 6  },
      expectedGoalsXg:{ home: 0.9, away: 1.8 },
      yellowCards:    { home: 1,  away: 2  },
      redCards:       { home: 0,  away: 0  },
    };
    const b = {
      totalShots:     { home: 6, away: 15 },
      shotsOnTarget:  { home: 2, away: 5  },
      cornerKicks:    { home: 2, away: 4  },
      expectedGoalsXg:{ home: 0.5, away: 1.2 },
      yellowCards:    { home: 0, away: 1  },
      redCards:       { home: 0, away: 0  },
    };
    const result = subtractStats(a, b);
    assert.deepEqual(result.totalShots,     { home: 4, away: 5 });
    assert.deepEqual(result.shotsOnTarget,  { home: 2, away: 3 });
    assert.deepEqual(result.cornerKicks,    { home: 1, away: 2 });
    assert.ok(Math.abs(result.expectedGoalsXg.home - 0.4) < 0.001);
    assert.ok(Math.abs(result.expectedGoalsXg.away - 0.6) < 0.001);
    assert.deepEqual(result.yellowCards,    { home: 1, away: 1 });
    assert.deepEqual(result.redCards,       { home: 0, away: 0 });
  });

  test('returns null if either argument is null', () => {
    assert.equal(subtractStats(null, {}), null);
    assert.equal(subtractStats({}, null), null);
    assert.equal(subtractStats(null, null), null);
  });

  test('returns null fields when underlying value is null (basic statsLevel)', () => {
    const a = { totalShots: { home: 5, away: 10 }, expectedGoalsXg: { home: null, away: null } };
    const b = { totalShots: { home: 3, away: 7  }, expectedGoalsXg: { home: null, away: null } };
    const result = subtractStats(a, b);
    assert.deepEqual(result.totalShots,      { home: 2, away: 3 });
    assert.deepEqual(result.expectedGoalsXg, { home: null, away: null });
  });
});

describe('deltaCalculator.buildStatsMap', () => {
  test('converts flat objects to { field: { home, away } }', () => {
    const home = { totalShots: 6, shotsOnTarget: 2, cornerKicks: 3 };
    const away = { totalShots: 18, shotsOnTarget: 6, cornerKicks: 10 };
    const result = buildStatsMap(home, away);
    assert.deepEqual(result.totalShots,    { home: 6, away: 18 });
    assert.deepEqual(result.shotsOnTarget, { home: 2, away: 6  });
    assert.deepEqual(result.cornerKicks,   { home: 3, away: 10 });
  });

  test('uses null for missing fields', () => {
    const result = buildStatsMap({}, {});
    assert.deepEqual(result.totalShots, { home: null, away: null });
  });
});

// ─── discardPolicy ────────────────────────────────────────────────────────────

const { shouldDiscard } = require('../src/tracker/discardPolicy');

describe('discardPolicy.shouldDiscard', () => {
  test('discards when goal before 60 and minute < 60', () => {
    const r = shouldDiscard({ scoreHome: 1, scoreAway: 0, minute: 52 }, 60);
    assert.equal(r.discard, true);
    assert.equal(r.reason, 'goal_before_60');
  });

  test('does NOT discard when goal at minute >= 60', () => {
    const r = shouldDiscard({ scoreHome: 0, scoreAway: 1, minute: 63 }, 60);
    assert.equal(r.discard, false);
  });

  test('does NOT discard when score is 0:0 (no goals)', () => {
    const r = shouldDiscard({ scoreHome: 0, scoreAway: 0, minute: 55 }, 60);
    assert.equal(r.discard, false);
  });

  test('does NOT discard when minute is null (Finished with goal?)', () => {
    const r = shouldDiscard({ scoreHome: 1, scoreAway: 0, minute: null }, 60);
    assert.equal(r.discard, false);
  });

  test('respects custom threshold', () => {
    const r45 = shouldDiscard({ scoreHome: 1, scoreAway: 0, minute: 44 }, 45);
    assert.equal(r45.discard, true);
    const r60 = shouldDiscard({ scoreHome: 1, scoreAway: 0, minute: 44 }, 60);
    assert.equal(r60.discard, true);
  });
});

// ─── liveHeaderParser ─────────────────────────────────────────────────────────

const { parseLiveHeader } = require('../src/tracker/parsers/liveHeaderParser');

const HEADER_FINISHED_HTML = `
<div id="main" class="soccer">
  <h3>Liaoning Tieren - Chengdu Rongcheng</h3>
  <div class="detail"><b>0:1</b>  (0:0,0:1)</div>
  <div class="detail">Finished</div>
  <div class="detail">05.05.2026 13:35</div>
</div>
`;

const HEADER_LIVE_HTML = `
<div id="main" class="soccer">
  <h3>Team A - Team B</h3>
  <div class="detail"><b>0:0</b>  (0:0)</div>
  <div class="detail">67'</div>
  <div class="detail">07.05.2026 18:00</div>
</div>
`;

const HEADER_HALFTIME_HTML = `
<div id="main" class="soccer">
  <h3>Team A - Team B</h3>
  <div class="detail"><b>0:0</b></div>
  <div class="detail">Half Time</div>
  <div class="detail">07.05.2026 19:00</div>
</div>
`;

describe('liveHeaderParser.parseLiveHeader', () => {
  test('parses Finished match', () => {
    const h = parseLiveHeader(HEADER_FINISHED_HTML);
    assert.equal(h.scoreHome, 0);
    assert.equal(h.scoreAway, 1);
    assert.equal(h.isFinished, true);
    assert.equal(h.isHalftime, false);
    assert.equal(h.minute, null);
  });

  test('parses live match at 67\'', () => {
    const h = parseLiveHeader(HEADER_LIVE_HTML);
    assert.equal(h.scoreHome, 0);
    assert.equal(h.scoreAway, 0);
    assert.equal(h.isFinished, false);
    assert.equal(h.isHalftime, false);
    assert.equal(h.minute, 67);
  });

  test('parses Half Time status', () => {
    const h = parseLiveHeader(HEADER_HALFTIME_HTML);
    assert.equal(h.scoreHome, 0);
    assert.equal(h.scoreAway, 0);
    assert.equal(h.isHalftime, true);
    assert.equal(h.isFinished, false);
    assert.equal(h.minute, 45);
  });

  test('returns zeros on minimal/empty HTML', () => {
    const h = parseLiveHeader('<html></html>');
    assert.equal(h.scoreHome, 0);
    assert.equal(h.scoreAway, 0);
    assert.equal(h.isFinished, false);
  });

  test('parses dash-separated score (Flashscore mobi/ua)', () => {
    const html = `
<div id="main" class="soccer">
  <h3>Team A - Team B</h3>
  <div class="detail"><b>3-0</b></div>
  <div class="detail">72'</div>
</div>`;
    const h = parseLiveHeader(html);
    assert.equal(h.scoreHome, 3);
    assert.equal(h.scoreAway, 0);
  });
});

// ─── incidentParser ───────────────────────────────────────────────────────────

const { parseIncidents } = require('../src/tracker/parsers/incidentParser');

const INCIDENTS_HTML = `
<div id="detail-tab-content">
  <h4>1st Half: <b>0:0</b></h4>
  <div class="incident soccer">
    <p class="i-field time">38'</p>
    <p class="i-field icon y-card">&nbsp;</p>
    Pan Ximing [LIA]
  </div>
  <hr class="cleaner">
  <h4>2nd Half: <b>0:1</b></h4>
  <div class="incident soccer">
    <p class="i-field time">63'</p>
    <p class="i-field icon substitution">&nbsp;</p>
    Tian Yuda [LIA]
  </div>
  <div class="incident soccer">
    <p class="i-field time">76'</p>
    <p class="i-field icon ball">&nbsp;</p>
    Felipe Silva [CHE]
  </div>
  <div class="incident soccer">
    <p class="i-field time-wide">90+4'</p>
    <p class="i-field icon ball">&nbsp;</p>
    Another Player [CHE]
  </div>
  <hr class="cleaner">
</div>
`;

describe('incidentParser.parseIncidents', () => {
  test('parses 1st/2nd half scores from h4 headers', () => {
    const r = parseIncidents(INCIDENTS_HTML);
    assert.deepEqual(r.firstHalfScore,  { home: 0, away: 0 });
    assert.deepEqual(r.secondHalfScore, { home: 0, away: 1 });
  });

  test('parses dash-separated half scores', () => {
    const html = INCIDENTS_HTML
      .replace('<b>0:0</b>', '<b>0-0</b>')
      .replace('<b>0:1</b>', '<b>0-1</b>');
    const r = parseIncidents(html);
    assert.deepEqual(r.firstHalfScore,  { home: 0, away: 0 });
    assert.deepEqual(r.secondHalfScore, { home: 0, away: 1 });
  });

  test('only captures goals (icon ball), not substitutions or cards', () => {
    const r = parseIncidents(INCIDENTS_HTML);
    assert.equal(r.goals.length, 2);
  });

  test('parses regular-time goal correctly', () => {
    const r = parseIncidents(INCIDENTS_HTML);
    const g1 = r.goals[0];
    assert.equal(g1.minute, 76);
    assert.equal(g1.extraMinutes, 0);
    assert.equal(g1.isExtraTime, false);
  });

  test('parses extra-time goal correctly', () => {
    const r = parseIncidents(INCIDENTS_HTML);
    const g2 = r.goals[1];
    assert.equal(g2.minute, 90);
    assert.equal(g2.extraMinutes, 4);
    assert.equal(g2.isExtraTime, true);
  });

  test('returns empty goals if no detail-tab-content', () => {
    const r = parseIncidents('<html><body></body></html>');
    assert.equal(r.goals.length, 0);
    assert.deepEqual(r.firstHalfScore,  { home: 0, away: 0 });
    assert.deepEqual(r.secondHalfScore, { home: 0, away: 0 });
  });

  test('does not include goals from 1st half incidents (none in HTML)', () => {
    // The yellow card in 1st half is not a goal → confirmed already by length check
    const r = parseIncidents(INCIDENTS_HTML);
    assert.ok(r.goals.every(g => g.minute >= 63)); // 1st half card at 38' not included
  });
});

const { parseMinute } = require('../src/parser/minuteUtils');

describe('parseMinute (2nd Half - X\')', () => {
  test('does not confuse ordinal with minute', () => {
    assert.equal(parseMinute("2nd Half - 71'"), 71);
    assert.equal(parseMinute('1st Half - 23′'), 23);
  });
});
