const NAME_RE = /^\p{L}+(?:(?:[ '-]\p{L}+)|(?: \p{L}\.))*$/u;

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

function positiveInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

module.exports = { cleanString, validName, positiveInteger };