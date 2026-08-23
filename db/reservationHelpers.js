// A booked slot that nobody ever checks in for shouldn't stay "reserved"
// forever -- that's the same kind of stuck-state bug as the old date-blind
// slot status. If a student doesn't show up within the grace period after
// their start time, the reservation auto-forfeits and the slot frees up
// for someone else. This runs as a lazy sweep at the top of read/booking
// routes rather than a background cron job, since Render's free tier can
// sleep and a timer-based job wouldn't reliably fire anyway.

const GRACE_PERIOD_MINUTES = 20;
const ON_TIME_TOLERANCE_MINUTES = 10;

async function sweepExpiredReservations(pool) {
  await pool.query(
    `UPDATE reservations
     SET status = 'forfeited'
     WHERE status = 'ongoing'
       AND checked_in_at IS NULL
       AND (reservation_date + start_time + ($1 || ' minutes')::interval) < NOW()`,
    [GRACE_PERIOD_MINUTES]
  );
}

// Normalizes a DATE column value to 'YYYY-MM-DD'. pg returns DATE columns
// as JS Date objects (String(dateObj) gives a human-readable form, not
// ISO -- slicing that produced "Invalid Date" everywhere below).
function toISODateStr(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// Classifies how an arrival compares to the reserved start time.
function arrivalStatus(checkedInAt, reservationDate, startTime) {
  if (!checkedInAt) return null;
  const scheduled = new Date(`${toISODateStr(reservationDate)}T${startTime}`);
  const checkedIn = new Date(checkedInAt);
  const diffMinutes = (checkedIn - scheduled) / 60000;
  if (diffMinutes < 0) return 'early';
  if (diffMinutes <= ON_TIME_TOLERANCE_MINUTES) return 'on_time';
  return 'late';
}

// Classifies whether an exit happened before the reserved end time.
function departureStatus(exitedAt, reservationDate, endTime) {
  const scheduled = new Date(`${toISODateStr(reservationDate)}T${endTime}`);
  const exited = new Date(exitedAt);
  return exited < scheduled ? 'early' : 'on_time';
}

// Formats a reservation's DB id into a human-facing ticket number, e.g. 42
// -> "MPU-000042". Purely a display format -- the id is still the real key.
function ticketNumber(id) {
  return `MPU-${String(id).padStart(6, '0')}`;
}

module.exports = { sweepExpiredReservations, arrivalStatus, departureStatus, ticketNumber, GRACE_PERIOD_MINUTES };
