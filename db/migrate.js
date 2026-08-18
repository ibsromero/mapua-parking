const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(schema);
    console.log('✅ Schema applied successfully.');
    } catch (err) {
    console.error('❌ Migration failed:', err.message || err.code || err);
    if (err.code) console.error('   Error code:', err.code);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
