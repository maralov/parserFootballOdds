'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMinute, isHalftimeStatus } = require('../src/parser/minuteUtils');

test('parseMinute: plain minute', () => {
  assert.equal(parseMinute("33'"), 33);
  assert.equal(parseMinute('45'), 45);
});

test('parseMinute: compensated time', () => {
  assert.equal(parseMinute("45+'"), 46);
  assert.equal(parseMinute("45+2'"), 47);
  assert.equal(parseMinute("90+3'"), 93);
});

test('parseMinute: halftime words', () => {
  assert.equal(parseMinute('halftime'), 45);
  assert.equal(parseMinute('Half Time'), 45);
  assert.equal(parseMinute('ht'), 45);
  assert.equal(parseMinute('перерва'), 45);
});

test('parseMinute: "Nst Half - M\'" form', () => {
  assert.equal(parseMinute("1st Half - 23'"), 23);
  assert.equal(parseMinute("2nd Half - 71'"), 71);
});

// Regression: compensated time inside the "1st Half - 45+M'" form must NOT
// fall through to the plain fallback and grab "1" from "1st".
test('parseMinute: compensated time inside half-dash form', () => {
  assert.equal(parseMinute("1st Half - 45+2'"), 47);
  assert.equal(parseMinute("1st Half - 45+'"), 46);
  assert.equal(parseMinute("2nd Half - 90+3'"), 93);
});

// The plain fallback must not pick a leading digit from an ordinal word.
test('parseMinute: ordinal word is not a minute', () => {
  assert.equal(parseMinute('1st half'), null);
  assert.equal(parseMinute('abc'), null);
  assert.equal(parseMinute(''), null);
});

test('isHalftimeStatus', () => {
  assert.equal(isHalftimeStatus('Half Time'), true);
  assert.equal(isHalftimeStatus("45+2'"), true);
  assert.equal(isHalftimeStatus("33'"), false);
});
