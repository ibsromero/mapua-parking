const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');

const router = express.Router();

const ID_RE = /^[A-Za-z0-9-]{4,20}$/;
const APPLICANT_TYPES = ['student', 'faculty', 'non_teaching'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// POST /api/auth/register  - used by the sticker application flow to create
// a login (id_number + password) for a new applicant.
router.post('/register', registerLimiter, async (req, res) => {
  const id_number = clean(req.body.id_number, 20);
  const full_name = clean(req.body.full_name, 150);
  const email = clean(req.body.email, 150);
  const contact_no = clean(req.body.contact_no, 30);
  const address = clean(req.body.address, 200);
  const applicant_type = clean(req.body.applicant_type, 20) || 'student';
  const course_year = clean(req.body.course_year, 100);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!id_number || !ID_RE.test(id_number)) {
    return res.status(400).json({ error: 'ID number must be 4-20 letters, numbers, or dashes.' });
  }
  if (!full_name) return res.status(400).json({ error: 'Full name is required.' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
  if (!APPLICANT_TYPES.includes(applicant_type)) {
    return res.status(400).json({ error: 'Invalid applicant type.' });
  }
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE id_number = $1', [id_number]);
    if (existing.rows[0]) {
      // Deliberately generic - don't confirm/deny which ID numbers are registered.
      return res.status(400).json({ error: 'Unable to register with the details provided.' });
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

  // Server-side validation - never trust the client. Allowlist-style format
  // check on id_number; length cap on password to avoid oversized payloads
  // being hashed/compared.
  if (
    typeof id_number !== 'string' ||
    typeof password !== 'string' ||
    !/^[A-Za-z0-9-]{4,20}$/.test(id_number) ||
    password.length < 1 ||
    password.length > 200
  ) {
    // Same generic message as a wrong password - don't reveal which part was invalid.
    return res.status(401).json({ error: 'Invalid ID number or password.' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id_number = $1', [id_number]);
    const user = rows[0];

    // Always run bcrypt.compare, even when no user was found, using a dummy
    // hash. This keeps response timing consistent so an attacker can't use
    // timing differences to enumerate valid ID numbers.
    const hashToCompare = user ? user.password_hash : '$2a$10$TH4ATeytiSyf9irOfL8uFeALg9mcuo1Urgd5NNRfnCNhxaYVSl.DG';
    const match = await bcrypt.compare(password, hashToCompare);

    if (!user || !match) return res.status(401).json({ error: 'Invalid ID number or password.' });

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

module.exports = router;
