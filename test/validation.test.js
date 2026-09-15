const test = require('node:test');
const assert = require('node:assert/strict');
const { validName, positiveInteger } = require('../middleware/validation');

test('validName accepts normal names and common separators', () => {
  assert.equal(validName('Maria Dela Cruz'), true);
  assert.equal(validName("Anne-Marie O'Neil"), true);
  assert.equal(validName('Juan P. Santos'), true);
});

test('validName rejects digits and invalid separators', () => {
  assert.equal(validName('John2 Doe'), false);
  assert.equal(validName('12345'), false);
  assert.equal(validName('John -- Doe'), false);
  assert.equal(validName('J'), false);
});

test('positiveInteger rejects partial parses', () => {
  assert.equal(positiveInteger('12'), 12);
  assert.equal(positiveInteger('12abc'), null);
  assert.equal(positiveInteger('-1'), null);
  assert.equal(positiveInteger('1.5'), null);
});