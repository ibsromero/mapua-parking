const express = require('express');
const pool = require('../db/pool');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /api/support  { category, description }
router.post('/', requireLogin, async (req, res) => {
  const { category, description } = req.body;
  if (!category) return res.status(400).json({ error: 'Category is required.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO support_tickets (user_id, category, description) VALUES ($1,$2,$3) RETURNING *`,
      [req.session.user.id, category, description || null]
    );
    res.status(201).json({ ticket: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit ticket.' });
  }
});

// GET /api/support/mine
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.session.user.id]
    );
    res.json({ tickets: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load tickets.' });
  }
});

// GET /api/support  (admin, optional ?status=)
router.get('/', requireAdmin, async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = 'WHERE t.status = $1';
    }
    const { rows } = await pool.query(
      `SELECT t.*, u.full_name, u.id_number
       FROM support_tickets t JOIN users u ON u.id = t.user_id
       ${where} ORDER BY t.created_at DESC`,
      params
    );
    res.json({ tickets: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load tickets.' });
  }
});

// POST /api/support/:id/status  { status }
router.post('/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const valid = ['new', 'in_progress', 'waiting_for_user', 'resolved'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const resolvedAt = status === 'resolved' ? 'NOW()' : 'NULL';
    const { rows } = await pool.query(
      `UPDATE support_tickets SET status = $1, resolved_at = ${resolvedAt} WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Ticket not found.' });
    res.json({ ticket: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update ticket.' });
  }
});

module.exports = router;
