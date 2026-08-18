require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./db/pool');

const authRoutes = require('./routes/auth');
const reservationRoutes = require('./routes/reservations');
const vehicleRoutes = require('./routes/vehicles');
const applicationRoutes = require('./routes/applications');
const adminRoutes = require('./routes/admin');
const supportRoutes = require('./routes/support');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.error('❌ SESSION_SECRET is not set. Refusing to start. Copy .env.example to .env and set one.');
  process.exit(1);
}

// Render (and most PaaS) sit behind a reverse proxy — needed for secure
// cookies and correct client IPs (used by the rate limiter) to work.
app.set('trust proxy', 1);

// Security headers: CSP, no-sniff, frame-deny (clickjacking), HSTS in prod, etc.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // inline styles used in a few pages
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"]
      }
    }
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }), // table created by db/schema.sql migration
    name: 'mp.sid',
    secret: process.env.SESSION_SECRET, // required — see .env.example; app refuses to start without it (below)
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax', // mitigates CSRF on state-changing requests from other origins
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      secure: isProd
    }
  })
);

// Generic rate limiting for the whole API — tighter limit specifically on
// /api/auth/login below to slow down credential-stuffing / brute force.
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});
app.use('/api/auth/login', loginLimiter);

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { index: false, dotfiles: 'deny' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
// reservations.js also exposes /api/lots/* — mount it there too
app.use('/api', reservationRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// 404 for unknown API routes (keep JSON, don't leak stack/HTML)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler — never leak stack traces or internal details to the client.
app.use((err, req, res, next) => {
  console.error(err); // full detail server-side only
  if (err.message && err.message.includes('Only PDF, JPG, PNG')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Mapua Parking server running on port ${PORT}`);
});
