const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_HEADER = 'x-csrf-token';

function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfToken(req, res) {
  res.json({ csrfToken: getCsrfToken(req) });
}

function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const expected = req.session.csrfToken;
  const provided = req.get(TOKEN_HEADER);
  if (!expected || !provided || provided.length !== expected.length) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  const valid = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!valid) return res.status(403).json({ error: 'Invalid CSRF token.' });
  next();
}

module.exports = { csrfToken, requireCsrf };
