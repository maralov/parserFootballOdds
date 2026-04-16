'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFormH2hFromCommentaryInnerHtml } = require('../src/parsers/formH2hParser');
const { computePreMatchBasePBias } = require('../src/pipeline/preMatchFormBias');

const FIXTURE_INNER = `
<h4>Останні матчі: Андорра U17</h4><table class="h2h"><tbody><tr><td class="data"><span>13.04.2026</span><span>Грузія U17<!-- --> - <!-- -->Андорра U17</span><a href="https://www.flashscore.com.ua/match/E9F4MWwe" target="_self"><b>1<!-- -->:<!-- -->0</b></a></td></tr><tr><td class="data"><span>10.04.2026</span><span>Уельс U17<!-- --> - <!-- -->Андорра U17</span><a href="https://www.flashscore.com.ua/match/MBzQTEoL" target="_self"><b>0<!-- -->:<!-- -->0</b></a></td></tr><tr><td class="data"><span>14.10.2025</span><span>Андорра U17<!-- --> - <!-- -->Латвія U17</span><a href="https://www.flashscore.com.ua/match/UDHLr6JM" target="_self"><b>1<!-- -->:<!-- -->5</b></a></td></tr><tr><td class="data"><span>11.10.2025</span><span>Данія U17<!-- --> - <!-- -->Андорра U17</span><a href="https://www.flashscore.com.ua/match/ARanYcam" target="_self"><b>4<!-- -->:<!-- -->1</b></a></td></tr><tr><td class="data"><span>08.10.2025</span><span>Іспанія U17<!-- --> - <!-- -->Андорра U17</span><a href="https://www.flashscore.com.ua/match/CdHCj0G7" target="_self"><b>3<!-- -->:<!-- -->0</b></a></td></tr></tbody></table><h4>Останні матчі: Сан-Марино U17</h4><table class="h2h"><tbody><tr><td class="data"><span>13.04.2026</span><span>Уельс U17<!-- --> - <!-- -->Сан-Марино U17</span><a href="https://www.flashscore.com.ua/match/GEXHVzH8" target="_self"><b>0<!-- -->:<!-- -->1</b></a></td></tr><tr><td class="data"><span>10.04.2026</span><span>Сан-Марино U17<!-- --> - <!-- -->Грузія U17</span><a href="https://www.flashscore.com.ua/match/6qCdOh9r" target="_self"><b>1<!-- -->:<!-- -->4</b></a></td></tr><tr><td class="data"><span>03.11.2025</span><span>Сан-Марино U17<!-- --> - <!-- -->Болгарія U17</span><a href="https://www.flashscore.com.ua/match/2cMjFbBb" target="_self"><b>0<!-- -->:<!-- -->5</b></a></td></tr><tr><td class="data"><span>31.10.2025</span><span>Словаччина U17<!-- --> - <!-- -->Сан-Марино U17</span><a href="https://www.flashscore.com.ua/match/ATS84sct" target="_self"><b>2<!-- -->:<!-- -->0</b></a></td></tr><tr><td class="data"><span>28.10.2025</span><span>Швейцарія U17<!-- --> - <!-- -->Сан-Марино U17</span><a href="https://www.flashscore.com.ua/match/0WAblV6r" target="_self"><b>2<!-- -->:<!-- -->0</b></a></td></tr></tbody></table><h4>Очні зустрічі</h4><table class="h2h"><tbody><tr><td class="data"><span>08.10.2012</span><span>Сан-Марино U17<!-- --> - <!-- -->Андорра U17</span><a href="https://www.flashscore.com.ua/match/WCEvVBSO" target="_self"><b>1<!-- -->:<!-- -->1</b></a></td></tr><tr><td class="data"><span>06.10.2007</span><span>Андорра U17<!-- --> - <!-- -->Сан-Марино U17</span><a href="https://www.flashscore.com.ua/match/Cb122zYb" target="_self"><b>3<!-- -->:<!-- -->0</b></a></td></tr></tbody></table><p>Після натискання...</p>
`.trim();

test('parseFormH2hFromCommentaryInnerHtml fixture', () => {
  const r = parseFormH2hFromCommentaryInnerHtml(FIXTURE_INNER, 'Андорра U17', 'Сан-Марино U17');
  assert.equal(r.parseOk, true, r.error);
  assert.equal(r.formHome.length, 5);
  assert.equal(r.formAway.length, 5);
  assert.equal(r.h2hMutual.length, 2);
  assert.equal(r.formHome[0].totalGoals, 1);
  assert.equal(r.formHome[1].totalGoals, 0);
  assert.equal(r.h2hMutual[0].totalGoals, 2);
  assert.ok(r.aggregates.home && r.aggregates.home.n === 5);
  assert.ok(r.aggregates.away && r.aggregates.away.n === 5);
  assert.ok(r.aggregates.mutual && r.aggregates.mutual.n === 2);
});

test('computePreMatchBasePBias only 60-70', () => {
  const parsed = parseFormH2hFromCommentaryInnerHtml(FIXTURE_INNER, 'Андорра U17', 'Сан-Марино U17');
  const b70 = computePreMatchBasePBias(parsed, '70-80', null);
  assert.equal(b70.deltaPGoal, 0);
  const b60 = computePreMatchBasePBias(parsed, '60-70', null);
  assert.ok(typeof b60.deltaPGoal === 'number');
});
