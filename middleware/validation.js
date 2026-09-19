const NAME_RE = /^\p{L}+(?:(?:[ '-]\p{L}+)|(?: \p{L}\.))*$/u;
const MAPUA_EMAIL_RE = /^[^\s@]+@(?:mymail\.mapua\.edu\.ph|mapua\.edu\.ph)$/i;

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned || cleaned.length > maxLength) return null;
  return cleaned;
}

function validName(value, maxLength = 150) {
  const name = cleanString(value, maxLength);
  return Boolean(name && name.length >= 2 && NAME_RE.test(name));
}

function validMapuaEmail(value) {
  return typeof value === 'string' && MAPUA_EMAIL_RE.test(value.trim());
}

function positiveInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRequestBody(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.body === undefined) {
    req.body = {};
    return next();
  }
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  next();
}

module.exports = { cleanString, validName, validMapuaEmail, positiveInteger, normalizeRequestBody };