const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validName,
  validMapuaEmail,
  hasTimeOverlap,
  positiveInteger,
  normalizeRequestBody
} = require('../middleware/validation');
const {
  isReservationStartInPast,
  GRACE_PERIOD_MINUTES,
  LATE_ARRIVAL_LIMIT_PER_30_DAYS,
  isLateArrival
} = require('../db/reservationHelpers');

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

test('validMapuaEmail only accepts Mapua email domains', () => {
  assert.equal(validMapuaEmail('student@mymail.mapua.edu.ph'), true);
  assert.equal(validMapuaEmail('faculty@mapua.edu.ph'), true);
  assert.equal(validMapuaEmail('STUDENT@MYMAIL.MAPUA.EDU.PH'), true);
  assert.equal(validMapuaEmail(''), false);
  assert.equal(validMapuaEmail('student@gmail.com'), false);
  assert.equal(validMapuaEmail('student@fake.mapua.edu.ph'), false);
  assert.equal(validMapuaEmail('student@mymail.mapua.edu.ph.evil.com'), false);
});

test('hasTimeOverlap checks actual time-range overlap only', () => {
  assert.equal(hasTimeOverlap('09:00:00', '10:00:00', '10:00:00', '11:00:00'), false);
  assert.equal(hasTimeOverlap('09:00:00', '10:00:00', '09:30:00', '09:45:00'), true);
  assert.equal(hasTimeOverlap('09:00:00', '10:00:00', '10:00:01', '11:00:00'), false);
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

test('grace window and late-arrival policy use the current campus rules', () => {
  assert.equal(GRACE_PERIOD_MINUTES, 10);
  assert.equal(LATE_ARRIVAL_LIMIT_PER_30_DAYS, 2);
  assert.equal(isLateArrival('2026-09-17T08:11:00+08:00', '2026-09-17', '08:00:00', 10), true);
  assert.equal(isLateArrival('2026-09-17T08:09:00+08:00', '2026-09-17', '08:00:00', 10), false);
});