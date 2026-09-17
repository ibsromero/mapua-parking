const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validName,
  positiveInteger,
  normalizeRequestBody
} = require('../middleware/validation');
const { isReservationStartInPast } = require('../db/reservationHelpers');

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
  assert.equal(validName('Alex_Lee'), false);
  assert.equal(validName('Maria 2nd'), false);
});

test('validName accepts Unicode letters and rejects empty or oversized input', () => {
  assert.equal(validName('Élodie Dela Cruz'), true);
  assert.equal(validName('   '), false);
  assert.equal(validName('A'.repeat(151)), false);
});

test('positiveInteger rejects partial parses', () => {
  assert.equal(positiveInteger('12'), 12);
  assert.equal(positiveInteger('12abc'), null);
  assert.equal(positiveInteger('-1'), null);
  assert.equal(positiveInteger('1.5'), null);
});

test('normalizeRequestBody makes missing bodies safe and rejects non-objects', () => {
  const next = () => {};
  const missing = { method: 'POST' };
  normalizeRequestBody(missing, {}, next);
  assert.deepEqual(missing.body, {});

  let response;
  normalizeRequestBody(
    { method: 'POST', body: null },
    { status: (code) => ({ json: (payload) => { response = { code, payload }; } }) },
    next
  );
  assert.deepEqual(response, {
    code: 400,
    payload: { error: 'Request body must be a JSON object.' }
  });
});

test('isReservationStartInPast handles dates and same-day times consistently', () => {
  assert.equal(isReservationStartInPast('2026-09-16', '23:00:00', '2026-09-17', '08:00:00'), true);
  assert.equal(isReservationStartInPast('2026-09-17', '08:00:00', '2026-09-17', '08:00:01'), true);
  assert.equal(isReservationStartInPast('2026-09-17', '08:01:00', '2026-09-17', '08:00:59'), false);
  assert.equal(isReservationStartInPast('2026-09-18', '00:00:00', '2026-09-17', '23:59:59'), false);
});