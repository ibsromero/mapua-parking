const bcrypt = require('bcryptjs');
const pool = require('./pool');

// Matches the Figma layout: Basement 1 has Row A/B1/B2/C (8 slots each = 32),
// Basement 2 mirrors it. Adjust counts freely later from the admin Facilities page.
const LOTS = ['Basement 1', 'Basement 2'];
const ROWS = ['Row A', 'Row B1', 'Row B2', 'Row C'];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Parking lots + slots ---
    for (const lotName of LOTS) {
      const lotRes = await client.query(
        `INSERT INTO parking_lots (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [lotName]
      );
      const lotId = lotRes.rows[0].id;

      // Row A and Row C each get their own A1-A8/C1-C8 numbering. Row B is
      // split across two visual columns (B1 and B2 in the layout) but shares
      // a single B1-B8 numbering range, matching the Figma design.
      const rowNumberRanges = {
        'Row A': [1, 8],
        'Row B1': [1, 4],
        'Row B2': [5, 8],
        'Row C': [1, 8]
      };
      const rowPrefixes = { 'Row A': 'A', 'Row B1': 'B', 'Row B2': 'B', 'Row C': 'C' };
      for (const row of ROWS) {
        const prefix = rowPrefixes[row];
        const [start, end] = rowNumberRanges[row];
        for (let i = start; i <= end; i++) {
          const slotNumber = `${prefix}${i}`;
          await client.query(
            `INSERT INTO parking_slots (lot_id, row_label, slot_number, status)
             VALUES ($1, $2, $3, 'available')
             ON CONFLICT (lot_id, slot_number) DO NOTHING`,
            [lotId, row, slotNumber]
          );
        }
      }
    }

    // --- Demo users ---
    const adminPass = await bcrypt.hash('admin123', 10);
    await client.query(
      `INSERT INTO users (id_number, full_name, email, applicant_type, password_hash, role)
       VALUES ('ADMIN-0001', 'Parking Admin', 'admin@mapua.edu.ph', 'non_teaching', $1, 'admin')
       ON CONFLICT (id_number) DO NOTHING`,
      [adminPass]
    );

    const studentPass = await bcrypt.hash('student123', 10);
    await client.query(
      `INSERT INTO users (id_number, full_name, email, applicant_type, course_year, password_hash, role)
       VALUES ('2021105432', 'Juan Dela Cruz', 'jdelacruz@mymail.mapua.edu.ph', 'student', 'BS Computer Science', $1, 'user')
       ON CONFLICT (id_number) DO NOTHING`,
      [studentPass]
    );

    const guardPass = await bcrypt.hash('guard123', 10);
    await client.query(
      `INSERT INTO users (id_number, full_name, applicant_type, password_hash, role)
       VALUES ('GUARD-0001', 'Demo Guard', 'non_teaching', $1, 'guard')
       ON CONFLICT (id_number) DO NOTHING`,
      [guardPass]
    );

    await client.query('COMMIT');
    console.log('✅ Seed complete.');
    console.log('   Admin login:   ADMIN-0001 / admin123');
    console.log('   Student login: 2021105432 / student123');
    console.log('   Guard login:   GUARD-0001 / guard123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
