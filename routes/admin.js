const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAdmin, requireGuardOrAdmin } = require('../middleware/auth');
const {
  sweepExpiredReservations,
  arrivalStatus,
  departureStatus,
  ticketNumber,
  phtTodayStr,
  phtTimeStr,
  GRACE_PERIOD_MINUTES
} = require('../db/reservationHelpers');

const router = express.Router();

// "Today" for this app always means today in the Philippines, not wherever
// the server's own clock happens to be set (Render runs in UTC). See
// db/reservationHelpers.js for why this matters -- this was the direct
// cause of reservations not showing up on the guard/Facilities view for
// hours after they were made.
function todayStr() {
  return phtTodayStr();
}

// GET /api/admin/overview -> dashboard stats
router.get('/overview', requireAdmin, async (req, res) => {
  try {
    await sweepExpiredReservations(pool);
    const today = phtTodayStr();
    const nowTime = phtTimeStr();

    const [occupancy, active, pending, recent] = await Promise.all([
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
router.get('/slots/:lotId', requireAdmin, async (req, res) => {
  try {
    await sweepExpiredReservations(pool);
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
      return {
        ...r,
        status,
        ticket_number: r.reservation_id ? ticketNumber(r.reservation_id) : null,
        arrival_status: arrivalStatus(r.checked_in_at, r.reservation_date, r.start_time)
      };
    });
    res.json({ slots, grace_period_minutes: GRACE_PERIOD_MINUTES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load slot map.' });
  }
});

// GET /api/admin/today-reservations -> flat list of today's reservations
// across every lot, for the Guard Portal's check-in/out table. Also usable
// by admins without needing the lot-by-lot Facilities grid.
router.get('/today-reservations', requireGuardOrAdmin, async (req, res) => {
  try {
    await sweepExpiredReservations(pool);
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.checked_in_at, r.start_time, r.end_time, r.reservation_date,
              s.id AS slot_id, s.slot_number, l.name AS lot_name, u.full_name AS student_name, u.id_number,
              v.plate_no, v.make, v.model
       FROM reservations r
       JOIN parking_slots s ON s.id = r.slot_id
       JOIN parking_lots l ON l.id = s.lot_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.reservation_date = $1 AND r.status IN ('ongoing', 'completed', 'forfeited')
       ORDER BY r.start_time`,
      [todayStr()]
    );
    const reservations = rows.map((r) => ({
      ...r,
      ticket_number: ticketNumber(r.id),
      arrival_status: arrivalStatus(r.checked_in_at, r.reservation_date, r.start_time)
    }));
    res.json({ reservations, grace_period_minutes: GRACE_PERIOD_MINUTES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load today's reservations." });
  }
});

// POST /api/admin/slots/:slotId/status  { status: 'available' | 'maintenance' }
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

// POST /api/admin/slots/:slotId/entry - gate check-in. Guards use this day
// to day; admins can too. Returns how the arrival compared to the reserved
// time (early/on_time/late) so whoever's at the gate can note it without
// extra hardware.
router.post('/slots/:slotId/entry', requireGuardOrAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resvRes = await client.query(
      `SELECT r.id, r.reservation_date, r.start_time, v.plate_no FROM reservations r
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

    const checkedInAt = new Date();
    await client.query(`UPDATE reservations SET checked_in_at = $1 WHERE id = $2`, [checkedInAt, reservation.id]);
    await client.query(
      `INSERT INTO entry_exit_logs (reservation_id, plate_no, action) VALUES ($1, $2, 'entry')`,
      [reservation.id, reservation.plate_no]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      ticket_number: ticketNumber(reservation.id),
      arrival_status: arrivalStatus(checkedInAt, reservation.reservation_date, reservation.start_time)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to log entry.' });
  } finally {
    client.release();
  }
});

// POST /api/admin/slots/:slotId/exit - gate check-out. Returns whether the
// vehicle left before its reserved end time.
router.post('/slots/:slotId/exit', requireGuardOrAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resvRes = await client.query(
      `SELECT r.id, r.reservation_date, r.end_time, v.plate_no FROM reservations r
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

    const exitedAt = new Date();
    await client.query(`UPDATE reservations SET status = 'completed' WHERE id = $1`, [reservation.id]);
    await client.query(
      `INSERT INTO entry_exit_logs (reservation_id, plate_no, action) VALUES ($1, $2, 'exit')`,
      [reservation.id, reservation.plate_no]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      ticket_number: ticketNumber(reservation.id),
      departure_status: departureStatus(exitedAt, reservation.reservation_date, reservation.end_time)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to log exit.' });
  } finally {
    client.release();
  }
});

// --- Guard account management (admin only) ---
const ID_RE = /^[A-Za-z0-9-]{4,20}$/;

// GET /api/admin/guards -> list guard accounts
router.get('/guards', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, id_number, full_name, created_at FROM users WHERE role = 'guard' ORDER BY created_at DESC`
    );
    res.json({ guards: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load guards.' });
  }
});

// POST /api/admin/guards  { id_number, full_name, password } -> create a guard account.
// Guards don't self-register through the public sign-up page -- only an
// admin can create one, same reasoning as "only actual Mapuans get accounts."
router.post('/guards', requireAdmin, async (req, res) => {
  const id_number = typeof req.body.id_number === 'string' ? req.body.id_number.trim() : '';
  const full_name = typeof req.body.full_name === 'string' ? req.body.full_name.trim().slice(0, 150) : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!ID_RE.test(id_number)) {
    return res.status(400).json({ error: 'ID number must be 4-20 letters, numbers, or dashes.' });
  }
  if (!full_name) return res.status(400).json({ error: 'Full name is required.' });
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE id_number = $1', [id_number]);
    if (existing.rows[0]) {
      return res.status(400).json({ error: 'That ID number is already registered.' });
    }
    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (id_number, full_name, applicant_type, password_hash, role)
       VALUES ($1, $2, 'non_teaching', $3, 'guard') RETURNING id, id_number, full_name, created_at`,
      [id_number, full_name, password_hash]
    );
    res.status(201).json({ guard: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create guard account.' });
  }
});

module.exports = router;
