// A booked slot that nobody ever checks in for shouldn't stay "reserved"
// forever -- that's the same kind of stuck-state bug as the old date-blind
// slot status. If a student doesn't show up within the grace period after
// their start time, the reservation auto-forfeits and the slot frees up
// for someone else. This runs as a lazy sweep at the top of read/booking
// routes rather than a background cron job, since Render's free tier can
// sleep and a timer-based job wouldn't reliably fire anyway.

const GRACE_PERIOD_MINUTES = 10;
const ON_TIME_TOLERANCE_MINUTES = 10;
const LATE_ARRIVAL_LIMIT_PER_30_DAYS = 2;
const LATE_ARRIVAL_PENALTY_DAYS = 30;

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

// Read the current date/time in Manila directly from the system clock using
// Intl so we don't accidentally shift a whole day by converting through UTC.
// Using toISOString() on an offset-adjusted Date is still UTC-based, which can
// produce the previous calendar day around midnight in the Philippines.
function phtParts() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(new Date());
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return map;
}

function phtTodayStr() {
  const { year, month, day } = phtParts();
  return `${year}-${month}-${day}`;
}

function phtTimeStr() {
  const { hour, minute, second } = phtParts();
  return `${hour}:${minute}:${second}`;
}

function isReservationStartInPast(reservationDate, startTime, today = phtTodayStr(), currentTime = phtTimeStr()) {
  return reservationDate < today || (reservationDate === today && startTime <= currentTime);
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
function isLateArrival(checkedInAt, reservationDate, startTime, gracePeriodMinutes = GRACE_PERIOD_MINUTES) {
  if (!checkedInAt) return false;
  const scheduled = new Date(`${toISODateStr(reservationDate)}T${startTime}${PH_OFFSET}`);
  const checkedIn = new Date(checkedInAt);
  const diffMinutes = (checkedIn - scheduled) / 60000;
  return diffMinutes > gracePeriodMinutes;
}

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

async function recordLateArrival(pool, userId) {
  const now = new Date();
  const { rows } = await pool.query(
    `SELECT late_arrival_count, late_arrival_reset_at, late_arrival_penalty_until
     FROM users WHERE id = $1`,
    [userId]
  );

  const current = rows[0] || {};
  const resetAt = current.late_arrival_reset_at ? new Date(current.late_arrival_reset_at) : now;
  let count = Number(current.late_arrival_count || 0);

  if (!current.late_arrival_reset_at || now - resetAt > (LATE_ARRIVAL_PENALTY_DAYS * 24 * 60 * 60 * 1000)) {
    count = 0;
  }

  count += 1;
  const penaltyUntil = count >= LATE_ARRIVAL_LIMIT_PER_30_DAYS
    ? new Date(now.getTime() + (LATE_ARRIVAL_PENALTY_DAYS * 24 * 60 * 60 * 1000))
    : null;

  await pool.query(
    `UPDATE users
     SET late_arrival_count = $1,
         late_arrival_reset_at = $2,
         late_arrival_penalty_until = $3
     WHERE id = $4`,
    [count, now, penaltyUntil, userId]
  );

  return { count, penaltyUntil };
}

module.exports = {
  sweepExpiredReservations,
  arrivalStatus,
  departureStatus,
  isLateArrival,
  recordLateArrival,
  ticketNumber,
  phtTodayStr,
  phtTimeStr,
  isReservationStartInPast,
  GRACE_PERIOD_MINUTES,
  LATE_ARRIVAL_LIMIT_PER_30_DAYS,
  LATE_ARRIVAL_PENALTY_DAYS
};
