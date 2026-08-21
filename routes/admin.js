const express = require('express');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/admin/overview -> dashboard stats
router.get('/overview', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const nowTime = now.toTimeString().slice(0, 8);

    const [occupancy, active, pending, recent] = await Promise.all([
      // "Occupied right now" = a slot with an ongoing reservation covering
      // this exact moment today, or a slot blocked for maintenance --
      // not a stale flag left over from some past booking.
      pool.query(
        `SELECT COUNT(*) AS total,
          COUNT(*) FILTER (
            WHERE status = 'maintenance'
              OR EXISTS (
                SELECT 1 FROM reservations r
                WHERE r.slot_id = parking_slots.id AND r.status = 'ongoing'
                  AND r.reservation_date = $1 AND r.start_time <= $2 AND r.end_time > $2
              )
          ) AS occupied
        FROM parking_slots`,
        [today, nowTime]
      ),
      pool.query(`SELECT COUNT(*) AS count FROM reservations WHERE status = 'ongoing'`),
      pool.query(`SELECT COUNT(*) AS count FROM sticker_applications WHERE status = 'pending'`),
      pool.query(`SELECT * FROM entry_exit_logs ORDER BY logged_at DESC LIMIT 10`)
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

// GET /api/admin/slots/:lotId -> today's live slot map for facility management.
// Status is computed from today's reservations rather than a stored flag:
// maintenance (admin-blocked) > occupied (checked in) > reserved (booked,
// not yet arrived) > available.
router.get('/slots/:lotId', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.row_label, s.slot_number, s.status AS operational_status,
              r.id AS reservation_id, r.checked_in_at, u.full_name AS occupant_name, u.applicant_type,
              v.plate_no, v.make, v.model, v.color, r.start_time, r.end_time, r.reservation_date
       FROM parking_slots s
       LEFT JOIN reservations r ON r.slot_id = s.id AND r.status = 'ongoing' AND r.reservation_date = $2
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE s.lot_id = $1
       ORDER BY s.row_label, s.slot_number`,
      [req.params.lotId, todayStr()]
    );
    const slots = rows.map((r) => {
      let status = 'available';
      if (r.operational_status === 'maintenance') status = 'maintenance';
      else if (r.reservation_id && r.checked_in_at) status = 'occupied';
      else if (r.reservation_id) status = 'reserved';
      return { ...r, status };
    });
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load slot map.' });
  }
});

// POST /api/admin/slots/:slotId/status  { status: 'available' | 'maintenance' }
// This only controls the slot's OPERATIONAL status now -- "reserved" and
// "occupied" are computed from actual reservations and can't be set
// directly. Blocking a slot that has someone's active booking cancels that
// booking (rather than silently orphaning it) so the student isn't left
// thinking they still have a spot that's been pulled out from under them.
router.post('/slots/:slotId/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const valid = ['available', 'maintenance'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const slotRes = await client.query('SELECT * FROM parking_slots WHERE id = $1 FOR UPDATE', [req.params.slotId]);
    if (!slotRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Slot not found.' });
    }

    let cancelledReservation = false;
    if (status === 'maintenance') {
      const activeRes = await client.query(
        `SELECT id FROM reservations WHERE slot_id = $1 AND status = 'ongoing' AND reservation_date = $2`,
        [req.params.slotId, todayStr()]
      );
      if (activeRes.rows[0]) {
        await client.query(`UPDATE reservations SET status = 'cancelled' WHERE id = $1`, [activeRes.rows[0].id]);
        cancelledReservation = true;
      }
    }

    const updated = await client.query(`UPDATE parking_slots SET status = $1 WHERE id = $2 RETURNING *`, [
      status,
      req.params.slotId
    ]);
    await client.query('COMMIT');
    res.json({ slot: updated.rows[0], cancelled_reservation: cancelledReservation });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update slot.' });
  } finally {
    client.release();
  }
});

// POST /api/admin/slots/:slotId/entry - gate simulation: log a vehicle
// entering. Requires today's reservation for this slot to exist and not
// already be checked in.
router.post('/slots/:slotId/entry', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resvRes = await client.query(
      `SELECT r.id, v.plate_no FROM reservations r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.slot_id = $1 AND r.status = 'ongoing' AND r.reservation_date = $2 AND r.checked_in_at IS NULL
       FOR UPDATE OF r LIMIT 1`,
      [req.params.slotId, todayStr()]
    );
    const reservation = resvRes.rows[0];
    if (!reservation) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No pending reservation to check in for this slot today.' });
    }

    await client.query(`UPDATE reservations SET checked_in_at = NOW() WHERE id = $1`, [reservation.id]);
    await client.query(
      `INSERT INTO entry_exit_logs (reservation_id, plate_no, action) VALUES ($1, $2, 'entry')`,
      [reservation.id, reservation.plate_no]
    );

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
// leaving and complete its reservation, freeing the slot.
router.post('/slots/:slotId/exit', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resvRes = await client.query(
      `SELECT r.id, v.plate_no FROM reservations r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.slot_id = $1 AND r.status = 'ongoing' AND r.reservation_date = $2 AND r.checked_in_at IS NOT NULL
       FOR UPDATE OF r LIMIT 1`,
      [req.params.slotId, todayStr()]
    );
    const reservation = resvRes.rows[0];
    if (!reservation) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No checked-in vehicle to check out for this slot today.' });
    }

    await client.query(`UPDATE reservations SET status = 'completed' WHERE id = $1`, [reservation.id]);
    await client.query(
      `INSERT INTO entry_exit_logs (reservation_id, plate_no, action) VALUES ($1, $2, 'exit')`,
      [reservation.id, reservation.plate_no]
    );

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
