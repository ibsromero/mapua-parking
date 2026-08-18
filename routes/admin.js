const express = require('express');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/overview -> dashboard stats
router.get('/overview', requireAdmin, async (req, res) => {
  try {
    const [occupancy, active, pending, recent] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE status != 'available') AS occupied, COUNT(*) AS total
        FROM parking_slots
      `),
      pool.query(`SELECT COUNT(*) AS count FROM reservations WHERE status = 'ongoing'`),
      pool.query(`SELECT COUNT(*) AS count FROM sticker_applications WHERE status = 'pending'`),
      pool.query(`
        SELECT l.*, 'entry' AS kind FROM entry_exit_logs l ORDER BY logged_at DESC LIMIT 10
      `)
    ]);
    const occ = occupancy.rows[0];
    res.json({
      occupancy_pct: occ.total > 0 ? Math.round((occ.occupied / occ.total) * 100) : 0,
      slots_occupied: Number(occ.occupied),
      slots_total: Number(occ.total),
      active_reservations: Number(active.rows[0].count),
      pending_applications: Number(pending.rows[0].count),
      recent_activity: recent.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard overview.' });
  }
});

// GET /api/admin/slots/:lotId -> full slot map for facility management
router.get('/slots/:lotId', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, r.id AS reservation_id, u.full_name AS occupant_name, u.applicant_type,
              v.plate_no, v.make, v.model, v.color, r.start_time, r.end_time, r.reservation_date
       FROM parking_slots s
       LEFT JOIN reservations r ON r.slot_id = s.id AND r.status = 'ongoing'
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE s.lot_id = $1
       ORDER BY s.row_label, s.slot_number`,
      [req.params.lotId]
    );
    res.json({ slots: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load slot map.' });
  }
});

// POST /api/admin/slots/:slotId/status  { status: 'available'|'maintenance'|... }
router.post('/slots/:slotId/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const valid = ['available', 'reserved', 'occupied', 'maintenance'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const { rows } = await pool.query(
      `UPDATE parking_slots SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.slotId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Slot not found.' });
    res.json({ slot: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update slot.' });
  }
});

module.exports = router;
