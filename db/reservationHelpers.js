// A booked slot that nobody ever checks in for shouldn't stay "reserved"
// forever -- that's the same kind of stuck-state bug as the old date-blind
// slot status. If a student doesn't show up within the grace period after
// their start time, the reservation auto-forfeits and the slot frees up
// for someone else. This runs as a lazy sweep at the top of read/booking
// routes rather than a background cron job, since Render's free tier can
// sleep and a timer-based job wouldn't reliably fire anyway.

const GRACE_PERIOD_MINUTES = 20;
const ON_TIME_TOLERANCE_MINUTES = 10;

// The whole system is one campus in the Philippines (UTC+8, no DST), but
// Render's server clock runs in UTC. Every reservation_date/start_time/
// end_time value is stored as a naive Philippine wall-clock value, so any
// comparison against "the current moment" has to happen in that same
// timezone -- comparing it against raw UTC "now" silently shifts every
// boundary by 8 hours, which is exactly wide enough to make a reservation
// invisible to "today" queries for up to 8 hours a day, or forfeit at the
// wrong time. Postgres's AT TIME ZONE conversion handles the DB side;
// phtNow() below handles the Node side.
const PH_OFFSET = '+08:00';

// Returns a Date object whose UTC-formatted date/time components equal the
// current Philippine wall-clock date/time -- a timezone-library-free way to
// read "today" and "now" correctly for this campus regardless of what
// timezone the Node process itself is running in.
function phtNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function phtTodayStr() {
  return phtNow().toISOString().slice(0, 10);
}

function phtTimeStr() {
  return phtNow().toISOString().slice(11, 19);
}

async function sweepExpiredReservations(pool) {
  await pool.query(
    `UPDATE reservations
     SET status = 'forfeited'
     WHERE status = 'ongoing'
       AND checked_in_at IS NULL
       AND (reservation_date + start_time + ($1 || ' minutes')::interval) < (NOW() AT TIME ZONE 'Asia/Manila')`,
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

// Classifies how an arrival compares to the reserved start time. The
// explicit +08:00 offset is what makes this parse as the correct absolute
// instant regardless of the server's own local timezone setting.
function arrivalStatus(checkedInAt, reservationDate, startTime) {
  if (!checkedInAt) return null;
  const scheduled = new Date(`${toISODateStr(reservationDate)}T${startTime}${PH_OFFSET}`);
  const checkedIn = new Date(checkedInAt);
  const diffMinutes = (checkedIn - scheduled) / 60000;
  if (diffMinutes < 0) return 'early';
  if (diffMinutes <= ON_TIME_TOLERANCE_MINUTES) return 'on_time';
  return 'late';
}

// Classifies whether an exit happened before the reserved end time.
function departureStatus(exitedAt, reservationDate, endTime) {
  const scheduled = new Date(`${toISODateStr(reservationDate)}T${endTime}${PH_OFFSET}`);
  const exited = new Date(exitedAt);
  return exited < scheduled ? 'early' : 'on_time';
}

// Formats a reservation's DB id into a human-facing ticket number, e.g. 42
// -> "MPU-000042". Purely a display format -- the id is still the real key.
function ticketNumber(id) {
  return `MPU-${String(id).padStart(6, '0')}`;
}

module.exports = {
  sweepExpiredReservations,
  arrivalStatus,
  departureStatus,
  ticketNumber,
  phtTodayStr,
  phtTimeStr,
  GRACE_PERIOD_MINUTES
};
