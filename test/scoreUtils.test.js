'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeScoreString, parseScorePair } = require('../src/parser/scoreUtils');
const { parseLiveBoard } = require('../src/parser/liveBoardParser');

describe('scoreUtils', () => {
  test('normalizeScoreString converts dash to colon', () => {
    assert.equal(normalizeScoreString('3-0'), '3:0');
    assert.equal(normalizeScoreString('0-0'), '0:0');
    assert.equal(normalizeScoreString('1-1'), '1:1');
  });

  test('normalizeScoreString keeps colon format', () => {
    assert.equal(normalizeScoreString('2:1'), '2:1');
  });

  test('parseScorePair', () => {
    assert.deepEqual(parseScorePair('3-0'), { home: 3, away: 0 });
    assert.deepEqual(parseScorePair('0:0'), { home: 0, away: 0 });
    assert.equal(parseScorePair('n/a'), null);
  });
});

describe('liveBoardParser dash scores', () => {
  test('counts 0:0 and preserves normalized score from mobi HTML', () => {
    const html = `
<div id="score-data">
  <h4>WORLD: Friendly</h4>
  <span class="live">48'</span>Team A - Team B <a href="/match/abc123/?s=2" class="live">0-0</a><br>
  <span class="live">Перерва</span>Team C - Team D <a href="/match/def456/?s=2" class="live">0-0</a><br>
  <span class="live">72'</span>Team E - Team F <a href="/match/ghi789/?s=2" class="live">3-0</a><br>
</div>`;
    const { matches, health } = parseLiveBoard(html);
    assert.equal(health.totalRows, 3);
    assert.equal(health.totalZeroZero, 2);
    assert.equal(matches.filter((m) => m.score === '0:0').length, 2);
    assert.equal(matches.find((m) => m.matchId === 'ghi789').score, '3:0');
  });
});
