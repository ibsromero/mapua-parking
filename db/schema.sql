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
  role VARCHAR(20) NOT NULL DEFAULT 'user',    -- user | admin | guard
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
  -- Documents are stored as bytes in the row (not on local disk) because
  -- Render's filesystem is ephemeral -- anything written to disk at runtime
  -- is wiped on every redeploy or sleep/wake cycle. The *_file column holds
  -- the original filename for display; *_data/*_mimetype hold the actual
  -- content so it survives independently of the running server instance.
  or_cr_file VARCHAR(255),
  or_cr_data BYTEA,
  or_cr_mimetype VARCHAR(100),
  drivers_license_file VARCHAR(255),
  drivers_license_data BYTEA,
  drivers_license_mimetype VARCHAR(100),
  university_id_file VARCHAR(255),
  university_id_data BYTEA,
  university_id_mimetype VARCHAR(100),
  rules_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  permit_number VARCHAR(30) UNIQUE,
  permit_token VARCHAR(64) UNIQUE,
  permit_issued_at TIMESTAMP,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  reviewed_by INTEGER REFERENCES users(id)
);

-- Idempotent migration for databases created before document bytes were
-- stored in the row.
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS or_cr_data BYTEA;
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS or_cr_mimetype VARCHAR(100);
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS drivers_license_data BYTEA;
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS drivers_license_mimetype VARCHAR(100);
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS university_id_data BYTEA;
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS university_id_mimetype VARCHAR(100);

-- Idempotent migration for databases created before rejection_reason existed.
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS permit_number VARCHAR(30);
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS permit_token VARCHAR(64);
ALTER TABLE sticker_applications ADD COLUMN IF NOT EXISTS permit_issued_at TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sticker_permit_number ON sticker_applications(permit_number) WHERE permit_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sticker_permit_token ON sticker_applications(permit_token) WHERE permit_token IS NOT NULL;

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
  status VARCHAR(20) NOT NULL DEFAULT 'ongoing', -- ongoing | completed | cancelled | forfeited
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

-- Consolidate legacy duplicate vehicle rows before enforcing normalized plate
-- uniqueness. References and history are retained on the oldest row.
UPDATE sticker_applications a
SET vehicle_id = keep.id
FROM vehicles duplicate
JOIN LATERAL (
  SELECT MIN(id) AS id FROM vehicles
  WHERE user_id = duplicate.user_id AND UPPER(BTRIM(plate_no)) = UPPER(BTRIM(duplicate.plate_no))
) keep ON TRUE
WHERE a.vehicle_id = duplicate.id AND duplicate.id <> keep.id;
UPDATE reservations r
SET vehicle_id = keep.id
FROM vehicles duplicate
JOIN LATERAL (
  SELECT MIN(id) AS id FROM vehicles
  WHERE user_id = duplicate.user_id AND UPPER(BTRIM(plate_no)) = UPPER(BTRIM(duplicate.plate_no))
) keep ON TRUE
WHERE r.vehicle_id = duplicate.id AND duplicate.id <> keep.id;
DELETE FROM vehicles duplicate
WHERE EXISTS (
  SELECT 1 FROM vehicles keep
  WHERE keep.user_id = duplicate.user_id
    AND UPPER(BTRIM(keep.plate_no)) = UPPER(BTRIM(duplicate.plate_no))
    AND keep.id < duplicate.id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_application_per_vehicle
  ON sticker_applications(user_id, vehicle_id) WHERE status IN ('pending', 'approved');
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_normalized_plate_per_user
  ON vehicles(user_id, UPPER(BTRIM(plate_no)));

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
