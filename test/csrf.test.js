const test = require('node:test');
const assert = require('node:assert/strict');
const { requireCsrf } = require('../middleware/csrf');

test('requireCsrf rejects tokens with matching characters but different byte lengths', () => {
  let response;
  const expected = 'a'.repeat(64);
  const provided = '😀'.repeat(32);
  const req = {
    method: 'POST',
    session: { csrfToken: expected },
    get: () => provided
  };
  const res = {
    status: (code) => ({ json: (payload) => { response = { code, payload }; } })
  };

  assert.doesNotThrow(() => requireCsrf(req, res, () => {}));
  assert.deepEqual(response, {
    code: 403,
    payload: { error: 'Invalid CSRF token.' }
  });
});