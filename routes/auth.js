const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { csrfToken } = require('../middleware/csrf');
const { cleanString, validName, validMapuaEmail } = require('../middleware/validation');

const router = express.Router();

const ID_RE = /^[A-Za-z0-9-]{4,20}$/;
const APPLICANT_TYPES = ['student', 'faculty', 'non_teaching'];
function clean(val, max) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim().slice(0, max);
  return trimmed.length ? trimmed : null;
}

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signups from this network. Please try again later.' }
});

// The browser requests this before login/register, while the session is still
// anonymous. The token is tied to the same server-side session cookie.
router.get('/csrf', csrfToken);

// POST /api/auth/register  - used by the sticker application flow to create
// a login (id_number + password) for a new applicant.
router.post('/register', registerLimiter, async (req, res) => {
  const id_number = clean(req.body.id_number, 20);
  const full_name = cleanString(req.body.full_name, 150);
  const email = clean(req.body.email, 150);
  const contact_no = clean(req.body.contact_no, 30);
  const address = clean(req.body.address, 200);
  const applicant_type = clean(req.body.applicant_type, 20) || 'student';
  const course_year = clean(req.body.course_year, 100);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!id_number) {
    return res.status(400).json({ error: 'ID number is required.' });
  }
  if (!ID_RE.test(id_number)) {
    return res.status(400).json({ error: 'ID number must be 4-20 letters, numbers, or dashes.' });
  }
  if (!full_name) return res.status(400).json({ error: 'Full name is required.' });
  if (!validName(full_name)) {
    return res.status(400).json({ error: 'Full name may contain letters, spaces, hyphens, apostrophes, and periods only.' });
  }
  if (!email || !validMapuaEmail(email)) {
    return res.status(400).json({ error: 'Email must use @mymail.mapua.edu.ph or @mapua.edu.ph.' });
  }
  if (!APPLICANT_TYPES.includes(applicant_type)) {
    return res.status(400).json({ error: 'Applicant type is invalid.' });
  }
  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE id_number = $1', [id_number]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'An account with this ID number already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (id_number, full_name, email, contact_no, address, applicant_type, course_year, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'user') RETURNING id, id_number, full_name, role`,
      [id_number, full_name, email, contact_no, address, applicant_type, course_year, password_hash]
    );
    const user = rows[0];

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Registration failed. Please try again.' });
      req.session.user = { id: user.id, id_number: user.id_number, full_name: user.full_name, role: user.role };
      res.status(201).json({ user: req.session.user });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// POST /api/auth/login  { id_number, password }
router.post('/login', async (req, res) => {
  const { id_number, password } = req.body;

  if (typeof id_number !== 'string' || !id_number.trim()) {
    return res.status(400).json({ error: 'ID number is required.' });
  }
  if (!/^[A-Za-z0-9-]{4,20}$/.test(id_number.trim())) {
    return res.status(400).json({ error: 'ID number must be 4-20 letters, numbers, or dashes.' });
  }
  if (typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'Password is required.' });
  }
  if (password.length > 200) {
    return res.status(400).json({ error: 'Password is too long.' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id_number = $1', [id_number.trim()]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'No account was found for that ID number.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Password is incorrect.' });

    // Regenerate the session on login to prevent session fixation attacks.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Login failed. Please try again.' });
      req.session.user = {
        id: user.id,
        id_number: user.id_number,
        full_name: user.full_name,
        role: user.role
      };
      res.json({ user: req.session.user });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// GET /api/auth/profile — full profile for the logged-in user (used to
// pre-fill read-only applicant info on the sticker application, so the
// applicant never re-types details their account already has).
router.get('/profile', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const { rows } = await pool.query(
      `SELECT id_number, full_name, email, contact_no, address, applicant_type, course_year, school_dept
       FROM users WHERE id = $1`,
      [req.session.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ profile: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

module.exports = router;
