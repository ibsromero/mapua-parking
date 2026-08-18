const { Pool } = require('pg');
require('dotenv').config();

// Decide SSL based on the host, not NODE_ENV — any managed/remote Postgres
// (Neon, Supabase, Render) requires SSL even in local development. Only a
// literal localhost/127.0.0.1 connection skips it.
function resolveSsl(connectionString) {
  try {
    const host = new URL(connectionString).hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    return isLocal ? false : { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

// Render (and most hosts) provide DATABASE_URL. Falls back to individual
// PG* env vars for local dev if you prefer that instead.
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: resolveSsl(process.env.DATABASE_URL)
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