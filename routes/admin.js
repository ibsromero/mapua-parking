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
        SELECT * FROM entry_exit_logs ORDER BY logged_at DESC LIMIT 10
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

// POST /api/admin/slots/:slotId/entry - gate simulation: log a vehicle
// entering and mark its slot occupied. Requires the slot to currently have
// an ongoing reservation (i.e. it's expected).
router.post('/slots/:slotId/entry', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const slotRes = await client.query('SELECT * FROM parking_slots WHERE id = $1 FOR UPDATE', [req.params.slotId]);
    const slot = slotRes.rows[0];
    if (!slot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Slot not found.' });
    }
    if (slot.status !== 'reserved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only a reserved slot can be checked in.' });
    }

    const resvRes = await client.query(
      `SELECT r.id, v.plate_no FROM reservations r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.slot_id = $1 AND r.status = 'ongoing' LIMIT 1`,
      [slot.id]
    );
    const reservation = resvRes.rows[0];

    await client.query(
      `INSERT INTO entry_exit_logs (reservation_id, plate_no, action) VALUES ($1, $2, 'entry')`,
      [reservation ? reservation.id : null, reservation ? reservation.plate_no : null]
    );
    await client.query(`UPDATE parking_slots SET status = 'occupied' WHERE id = $1`, [slot.id]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to log entry.' });
  } finally {
    client.release();
  }
});

// POST /api/admin/slots/:slotId/exit - gate simulation: log a vehicle
// leaving, complete its reservation, and free the slot.
router.post('/slots/:slotId/exit', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const slotRes = await client.query('SELECT * FROM parking_slots WHERE id = $1 FOR UPDATE', [req.params.slotId]);
    const slot = slotRes.rows[0];
    if (!slot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Slot not found.' });
    }
    if (slot.status !== 'occupied') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only an occupied slot can be checked out.' });
    }

    const resvRes = await client.query(
      `SELECT r.id, v.plate_no FROM reservations r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.slot_id = $1 AND r.status = 'ongoing' LIMIT 1`,
      [slot.id]
    );
    const reservation = resvRes.rows[0];

    await client.query(
      `INSERT INTO entry_exit_logs (reservation_id, plate_no, action) VALUES ($1, $2, 'exit')`,
      [reservation ? reservation.id : null, reservation ? reservation.plate_no : null]
    );
    if (reservation) {
      await client.query(`UPDATE reservations SET status = 'completed' WHERE id = $1`, [reservation.id]);
    }
    await client.query(`UPDATE parking_slots SET status = 'available' WHERE id = $1`, [slot.id]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to log exit.' });
  } finally {
    client.release();
  }
});

module.exports = router;
