-- Mapua Parking System schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  id_number VARCHAR(20) UNIQUE NOT NULL,       -- Student/Faculty ID, e.g. 2021105432
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  contact_no VARCHAR(30),
  address TEXT,
  applicant_type VARCHAR(20) NOT NULL DEFAULT 'student', -- student | faculty | non_teaching
  course_year VARCHAR(100),                    -- if student
  school_dept VARCHAR(100),                    -- if faculty/employee
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',    -- user | admin
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plate_no VARCHAR(20) NOT NULL,
  make VARCHAR(50),
  model VARCHAR(50),
  year VARCHAR(4),
  body_type VARCHAR(50),
  color VARCHAR(30),
  trim VARCHAR(30),
  owner_name VARCHAR(150),
  owner_address TEXT,
  relation_to_applicant VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sticker_applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  or_cr_file VARCHAR(255),
  drivers_license_file VARCHAR(255),
  university_id_file VARCHAR(255),
  rules_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  reviewed_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS parking_lots (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE   -- e.g. 'Basement 1', 'Basement 2'
);

CREATE TABLE IF NOT EXISTS parking_slots (
  id SERIAL PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  row_label VARCHAR(10) NOT NULL,     -- Row A, Row B1, etc
  slot_number VARCHAR(10) NOT NULL,   -- A1, B8, etc
  status VARCHAR(20) NOT NULL DEFAULT 'available', -- operational status only: available | maintenance
  -- (booking state -- "reserved"/"occupied" -- is computed from the reservations
  -- table for a given date/time, not stored here. See routes/reservations.js
  -- and routes/admin.js for how slot availability is actually determined.)
  UNIQUE(lot_id, slot_number)
);

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id INTEGER NOT NULL REFERENCES parking_slots(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  reservation_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ongoing', -- ongoing | completed | cancelled
  checked_in_at TIMESTAMP, -- set when the admin logs a gate "entry" for this reservation; distinguishes reserved (not yet arrived) from occupied (physically parked) for the same slot/date.
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Idempotent migration for databases created before checked_in_at existed.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMP;

-- One-time cleanup: older schema versions stored "reserved"/"occupied" directly
-- on parking_slots. That state is now computed from reservations instead, so
-- reset any leftover values -- safe to run repeatedly, no-op once clean.
UPDATE parking_slots SET status = 'available' WHERE status NOT IN ('available', 'maintenance');

CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,       -- Sticker Issue | Booking Error | Payment Issue | Other
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'new', -- new | in_progress | waiting_for_user | resolved
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entry_exit_logs (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
  plate_no VARCHAR(20),
  action VARCHAR(10) NOT NULL,  -- entry | exit
  logged_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations(slot_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON sticker_applications(status);
CREATE INDEX IF NOT EXISTS idx_slots_lot ON parking_slots(lot_id);

-- Session store table (used by connect-pg-simple). Created here at migration
-- time so the app never depends on lazy first-request table creation.
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_pkey";
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
