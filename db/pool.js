const { Pool } = require('pg');
require('dotenv').config();

// Render (and most hosts) provide DATABASE_URL. Falls back to individual
// PG* env vars for local dev if you prefer that instead.
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'mapua_parking'
      }
);

module.exports = pool;
