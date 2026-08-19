const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// GET /api/lots  -> list lots with occupancy summary
router.get('/lots', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.id, l.name,
        COUNT(s.id) AS total,
        COUNT(s.id) FILTER (WHERE s.status = 'available') AS available
      FROM parking_lots l
      LEFT JOIN parking_slots s ON s.lot_id = l.id
      GROUP BY l.id, l.name
      ORDER BY l.name
    `);
    res.json({ lots: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load lots.' });
  }
});

// GET /api/lots/:lotId/slots -> slot map for a lot
router.get('/lots/:lotId/slots', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, row_label, slot_number, status
       FROM parking_slots WHERE lot_id = $1
       ORDER BY row_label, slot_number`,
      [req.params.lotId]
    );
    res.json({ slots: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load slots.' });
  }
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

// POST /api/reservations  { slot_id, vehicle_id, reservation_date, start_time, end_time }
router.post('/', requireLogin, async (req, res) => {
  const { vehicle_id, reservation_date, start_time, end_time } = req.body;
  const slot_id = Number.parseInt(req.body.slot_id, 10);

  if (
    !Number.isInteger(slot_id) ||
    slot_id <= 0 ||
    !DATE_RE.test(String(reservation_date)) ||
    !TIME_RE.test(String(start_time)) ||
    !TIME_RE.test(String(end_time))
  ) {
    return res.status(400).json({ error: 'Missing or invalid reservation fields.' });
  }
  if (new Date(`${reservation_date}T${start_time}`) < new Date(new Date().toDateString())) {
    return res.status(400).json({ error: 'Reservation date cannot be in the past.' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'End time must be after start time.' });
  }
  // If a vehicle was supplied, make sure it actually belongs to this user (IDOR check)
  if (vehicle_id !== undefined && vehicle_id !== null && vehicle_id !== '') {
    const vId = Number.parseInt(vehicle_id, 10);
    if (!Number.isInteger(vId)) return res.status(400).json({ error: 'Invalid vehicle.' });
    const owned = await pool.query('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [
      vId,
      req.session.user.id
    ]);
    if (!owned.rows[0]) return res.status(403).json({ error: 'That vehicle does not belong to you.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the slot row so two students can't grab it at once
    const slotRes = await client.query(
      'SELECT status FROM parking_slots WHERE id = $1 FOR UPDATE',
      [slot_id]
    );
    if (!slotRes.rows[0]) throw new Error('Slot not found.');
    if (slotRes.rows[0].status !== 'available') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'That slot is no longer available.' });
    }

    const resRow = await client.query(
      `INSERT INTO reservations (user_id, slot_id, vehicle_id, reservation_date, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ongoing') RETURNING *`,
      [req.session.user.id, slot_id, vehicle_id || null, reservation_date, start_time, end_time]
    );

    await client.query(`UPDATE parking_slots SET status = 'reserved' WHERE id = $1`, [slot_id]);

    await client.query('COMMIT');
    res.status(201).json({ reservation: resRow.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create reservation.' });
  } finally {
    client.release();
  }
});

// GET /api/reservations/active -> current user's active reservation
router.get('/active', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, s.slot_number, l.name AS lot_name, v.plate_no
       FROM reservations r
       JOIN parking_slots s ON s.id = r.slot_id
       JOIN parking_lots l ON l.id = s.lot_id
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.user_id = $1 AND r.status = 'ongoing'
       ORDER BY r.created_at DESC LIMIT 1`,
      [req.session.user.id]
    );
    res.json({ reservation: rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load active reservation.' });
  }
});

// GET /api/reservations/history
router.get('/history', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, s.slot_number, l.name AS lot_name
       FROM reservations r
       JOIN parking_slots s ON s.id = r.slot_id
       JOIN parking_lots l ON l.id = s.lot_id
       WHERE r.user_id = $1
       ORDER BY r.reservation_date DESC, r.start_time DESC`,
      [req.session.user.id]
    );
    res.json({ reservations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load history.' });
  }
});

// POST /api/reservations/:id/extend  { extra_minutes }  - default 60 if omitted
const MAX_EXTEND_MINUTES = 180; // cap a single extension request (3 hours) to prevent abuse
router.post('/:id/extend', requireLogin, async (req, res) => {
  let extraMinutes = Number.parseInt(req.body.extra_minutes, 10);
  if (!Number.isInteger(extraMinutes) || extraMinutes <= 0) extraMinutes = 60;
  if (extraMinutes > MAX_EXTEND_MINUTES) {
    return res.status(400).json({ error: `Cannot extend by more than ${MAX_EXTEND_MINUTES} minutes at once.` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM reservations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [req.params.id, req.session.user.id]
    );
    const reservation = rows[0];
    if (!reservation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reservation not found.' });
    }
    if (reservation.status !== 'ongoing') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only an ongoing reservation can be extended.' });
    }

    // Compute the new end time and make sure it doesn't run into the next
    // reservation already booked on the same slot that same day.
    const newEndRes = await client.query(
      `SELECT (($1::time) + ($2 || ' minutes')::interval)::time AS new_end`,
      [reservation.end_time, extraMinutes]
    );
    const newEnd = newEndRes.rows[0].new_end;

    if (newEnd <= reservation.end_time) {
      // Interval math wrapped past midnight - keep reservations same-day/simple.
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot extend past midnight. Please book a new reservation instead.' });
    }

    const conflict = await client.query(
      `SELECT id FROM reservations
       WHERE slot_id = $1 AND id != $2 AND reservation_date = $3
         AND status IN ('ongoing') AND start_time < $4 AND start_time >= $5`,
      [reservation.slot_id, reservation.id, reservation.reservation_date, newEnd, reservation.end_time]
    );
    if (conflict.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Another reservation starts before that extended time. Try a shorter extension.' });
    }

    const updated = await client.query(
      `UPDATE reservations SET end_time = $1 WHERE id = $2 RETURNING *`,
      [newEnd, reservation.id]
    );

    await client.query('COMMIT');
    res.json({ reservation: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to extend reservation.' });
  } finally {
    client.release();
  }
});

// POST /api/reservations/:id/cancel
router.post('/:id/cancel', requireLogin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM reservations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [req.params.id, req.session.user.id]
    );
    const reservation = rows[0];
    if (!reservation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reservation not found.' });
    }
    await client.query(`UPDATE reservations SET status = 'cancelled' WHERE id = $1`, [reservation.id]);
    await client.query(`UPDATE parking_slots SET status = 'available' WHERE id = $1`, [reservation.slot_id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel reservation.' });
  } finally {
    client.release();
  }
});

module.exports = router;
