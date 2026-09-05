const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./pool');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(schema);
    console.log('✅ Schema applied successfully.');

    const { rows: approvedApplications } = await pool.query(
      `SELECT id FROM sticker_applications
       WHERE status = 'approved' AND (permit_number IS NULL OR permit_token IS NULL)`
    );
    for (const application of approvedApplications) {
      await pool.query(
        `UPDATE sticker_applications
         SET permit_number = $1, permit_token = $2, permit_issued_at = NOW()
         WHERE id = $3 AND status = 'approved'
           AND permit_number IS NULL AND permit_token IS NULL`,
        [
          `MP-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          crypto.randomBytes(24).toString('hex'),
          application.id
        ]
      );
    }
    if (approvedApplications.length) {
      console.log(`✅ Issued digital permits for ${approvedApplications.length} existing approved application(s).`);
    }
    } catch (err) {
    console.error('❌ Migration failed:', err.message || err.code || err);
    if (err.code) console.error('   Error code:', err.code);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
