const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');
const {
  sweepExpiredReservations,
  arrivalStatus,
  ticketNumber,
  phtTodayStr,
  phtTimeStr,
  GRACE_PERIOD_MINUTES
} = require('../db/reservationHelpers');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

// "Today" for this app always means today in the Philippines, not wherever
// the server's own clock happens to be set (Render runs in UTC). See
// db/reservationHelpers.js for why this matters.
function todayStr() {
  return phtTodayStr();
}

// GET /api/lots  -> list lots with TODAY's occupancy summary (a slot counts
// as unavailable right now if it's under maintenance or has an ongoing
// reservation covering the current moment -- not a stored flag that never
// resets once a booking is made for some other day).
router.get('/lots', requireLogin, async (req, res) => {
  try {
    await sweepExpiredReservations(pool);
    const today = phtTodayStr();
    const nowTime = phtTimeStr();
    const { rows } = await pool.query(
      `SELECT l.id, l.name,
        COUNT(s.id) AS total,
        COUNT(s.id) FILTER (
          WHERE s.status != 'maintenance'
            AND NOT EXISTS (
              SELECT 1 FROM reservations r
              WHERE r.slot_id = s.id AND r.status = 'ongoing'
                AND r.reservation_date = $1 AND r.start_time <= $2 AND r.end_time > $2
            )
        ) AS available
      FROM parking_lots l
      LEFT JOIN parking_slots s ON s.lot_id = l.id
      GROUP BY l.id, l.name
      ORDER BY l.name`,
      [today, nowTime]
    );
    res.json({ lots: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load lots.' });
  }
});

// GET /api/lots/:lotId/slots?date=YYYY-MM-DD&start=HH:MM&end=HH:MM
// Slot map for a lot, scoped to a specific date/time window -- a slot is
// only shown "reserved" if a booking actually overlaps the requested window,
// not forever once anyone has ever booked it for any date.
router.get('/lots/:lotId/slots', requireLogin, async (req, res) => {
  const date = DATE_RE.test(String(req.query.date)) ? req.query.date : todayStr();
  const start = TIME_RE.test(String(req.query.start)) ? req.query.start : '00:00';
  const end = TIME_RE.test(String(req.query.end)) ? req.query.end : '23:59';
  try {
    await sweepExpiredReservations(pool);
    const { rows } = await pool.query(
      `SELECT s.id, s.row_label, s.slot_number,
        CASE
          WHEN s.status = 'maintenance' THEN 'maintenance'
          WHEN EXISTS (
            SELECT 1 FROM reservations r
            WHERE r.slot_id = s.id AND r.status = 'ongoing'
              AND r.reservation_date = $2 AND r.start_time < $4 AND r.end_time > $3
          ) THEN 'reserved'
          ELSE 'available'
        END AS status
       FROM parking_slots s WHERE s.lot_id = $1
       ORDER BY s.row_label, s.slot_number`,
      [req.params.lotId, date, start, end]
    );
    res.json({ slots: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load slots.' });
  }
});

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
  if (new Date(`${reservation_date}T${start_time}${'+08:00'}`) < new Date(`${phtTodayStr()}T00:00:00+08:00`)) {
    return res.status(400).json({ error: 'Reservation date cannot be in the past.' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'End time must be after start time.' });
  }
  // A reservation must be for a specific, owned vehicle with an approved
  // sticker — booking a slot with no vehicle attached doesn't make sense,
  // and the whole point of the sticker requirement is enforced here rather
  // than just mentioned in a banner.
  const vId = Number.parseInt(vehicle_id, 10);
  if (!Number.isInteger(vId)) {
    return res.status(400).json({ error: 'Select a vehicle to reserve this slot for.' });
  }
  const owned = await pool.query('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [
    vId,
    req.session.user.id
  ]);
  if (!owned.rows[0]) return res.status(403).json({ error: 'That vehicle does not belong to you.' });

  const approvedSticker = await pool.query(
    `SELECT id FROM sticker_applications WHERE vehicle_id = $1 AND user_id = $2 AND status = 'approved'`,
    [vId, req.session.user.id]
  );
  if (!approvedSticker.rows[0]) {
    return res.status(403).json({ error: 'This vehicle needs an approved car sticker before you can book a slot.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await sweepExpiredReservations(client);

    // Lock the slot row so two overlapping booking attempts for the same
    // slot serialize through here rather than racing each other.
    const slotRes = await client.query('SELECT status FROM parking_slots WHERE id = $1 FOR UPDATE', [slot_id]);
    if (!slotRes.rows[0]) throw new Error('Slot not found.');
    if (slotRes.rows[0].status === 'maintenance') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This slot is under maintenance.' });
    }

    // Availability is a real overlap check against that specific date/time,
    // not a single global flag -- a booking for one day must not block the
    // same slot on every other day forever.
    const conflict = await client.query(
      `SELECT id FROM reservations
       WHERE slot_id = $1 AND status = 'ongoing' AND reservation_date = $2
         AND start_time < $4 AND end_time > $3`,
      [slot_id, reservation_date, start_time, end_time]
    );
    if (conflict.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'That slot is already booked for an overlapping time on this date.' });
    }

    const resRow = await client.query(
      `INSERT INTO reservations (user_id, slot_id, vehicle_id, reservation_date, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ongoing') RETURNING *`,
      [req.session.user.id, slot_id, vId, reservation_date, start_time, end_time]
    );

    await client.query('COMMIT');
    res.status(201).json({
      reservation: { ...resRow.rows[0], ticket_number: ticketNumber(resRow.rows[0].id) },
      grace_period_minutes: GRACE_PERIOD_MINUTES
    });
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
    await sweepExpiredReservations(pool);
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
    const reservation = rows[0]
      ? {
          ...rows[0],
          ticket_number: ticketNumber(rows[0].id),
          arrival_status: arrivalStatus(rows[0].checked_in_at, rows[0].reservation_date, rows[0].start_time)
        }
      : null;
    res.json({ reservation, grace_period_minutes: GRACE_PERIOD_MINUTES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load active reservation.' });
  }
});

// GET /api/reservations/history
router.get('/history', requireLogin, async (req, res) => {
  try {
    await sweepExpiredReservations(pool);
    const { rows } = await pool.query(
      `SELECT r.*, s.slot_number, l.name AS lot_name
       FROM reservations r
       JOIN parking_slots s ON s.id = r.slot_id
       JOIN parking_lots l ON l.id = s.lot_id
       WHERE r.user_id = $1
       ORDER BY r.reservation_date DESC, r.start_time DESC`,
      [req.session.user.id]
    );
    const reservations = rows.map((r) => ({
      ...r,
      ticket_number: ticketNumber(r.id),
      arrival_status: arrivalStatus(r.checked_in_at, r.reservation_date, r.start_time)
    }));
    res.json({ reservations });
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
