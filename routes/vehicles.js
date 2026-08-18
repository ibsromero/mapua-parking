const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// Simple server-side field validation. Everything here is untrusted client
// input, so we cap lengths and coerce empty/invalid values to null rather
// than trusting whatever shape the client sends.
const MAX = 100;
function clean(val) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim().slice(0, MAX);
  return trimmed.length ? trimmed : null;
}
const PLATE_RE = /^[A-Za-z0-9 -]{1,15}$/;
const YEAR_RE = /^(19|20)\d{2}$/;
const RELATIONS = ['self', 'parent', 'sibling', 'spouse', 'relative', 'other'];

// GET /api/vehicles -> current user's vehicles
router.get('/', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vehicles WHERE user_id = $1 ORDER BY created_at DESC', [
      req.session.user.id
    ]);
    res.json({ vehicles: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load vehicles.' });
  }
});

// POST /api/vehicles
router.post('/', requireLogin, async (req, res) => {
  const plate_no = clean(req.body.plate_no);
  const year = clean(req.body.year);
  const relation_to_applicant = clean(req.body.relation_to_applicant);

  if (!plate_no || !PLATE_RE.test(plate_no)) {
    return res.status(400).json({ error: 'A valid plate number is required.' });
  }
  if (year && !YEAR_RE.test(year)) {
    return res.status(400).json({ error: 'Year must be a valid 4-digit year.' });
  }
  if (relation_to_applicant && !RELATIONS.includes(relation_to_applicant)) {
    return res.status(400).json({ error: 'Invalid relation to applicant.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO vehicles
        (user_id, plate_no, make, model, year, body_type, color, trim, owner_name, owner_address, relation_to_applicant)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.session.user.id,
        plate_no,
        clean(req.body.make),
        clean(req.body.model),
        year,
        clean(req.body.body_type),
        clean(req.body.color),
        clean(req.body.trim),
        clean(req.body.owner_name),
        clean(req.body.owner_address),
        relation_to_applicant
      ]
    );
    res.status(201).json({ vehicle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save vehicle.' });
  }
});

module.exports = router;
