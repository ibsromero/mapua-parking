# Mapúa Parking System

A parking reservation and vehicle sticker application system: students/faculty
log in, book a parking slot, track their reservation history, apply for a
vehicle sticker, and file support tickets. Admins get a live occupancy
dashboard, review sticker applications, control slot status, and manage
support tickets.

Built with **Node.js + Express + PostgreSQL**, session-based auth, and plain
HTML/CSS/JS on the frontend (no build step required).

## Tech stack

- **Backend:** Node.js, Express
- **Database:** PostgreSQL
- **Auth:** express-session (server-side sessions stored in Postgres via
  `connect-pg-simple`), bcrypt password hashing
- **File uploads:** Multer (sticker application documents)
- **Frontend:** Static HTML/CSS/vanilla JS served by Express — no framework,
  no build step, so it deploys as one simple web service

## Project structure

```
mapua-parking/
├── db/
│   ├── schema.sql       # full DB schema (tables, indexes, session store)
│   ├── migrate.js       # applies schema.sql
│   ├── seed.js          # creates parking lots/slots + demo accounts
│   └── pool.js          # PostgreSQL connection pool
├── routes/               # Express route handlers (one file per resource)
├── middleware/auth.js    # requireLogin / requireAdmin guards
├── public/                # frontend pages (served statically)
│   ├── login.html, dashboard.html, reservations.html, history.html,
│   │   support.html, apply.html
│   └── admin/             # admin-only pages
├── uploads/                # sticker application documents (gitignored)
├── server.js
├── .env.example
└── package.json
```

## Local setup

1. **Install Postgres** locally (or use a free hosted instance — Render,
   Neon, Supabase all work).
2. **Clone the repo and install dependencies:**
   ```bash
   npm install
   ```
3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `DATABASE_URL` — your local or hosted Postgres connection string
   - `SESSION_SECRET` — generate one with:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
4. **Create the schema and seed demo data:**
   ```bash
   npm run migrate
   npm run seed
   ```
   This creates two parking lots (Basement 1 & 2, 24 slots each) and two
   demo accounts:
   - Admin: `ADMIN-0001` / `admin123`
   - Student: `2021105432` / `student123`

   **Change or remove these demo accounts before going anywhere near a real
   deployment with real users.**
5. **Run it:**
   ```bash
   npm run dev     # with auto-reload (nodemon)
   # or
   npm start
   ```
   Visit `http://localhost:3000/login.html`.

## Deploying live (Render — free tier)

Render can host the web service and a free Postgres database together,
auto-deploying from your GitHub repo on every push — a good fit for a group
project.

1. **Push this repo to GitHub** (see "Group workflow" below).
2. **Create a Postgres database** on Render (New → PostgreSQL, free tier).
   Copy the **Internal Database URL** it gives you.
3. **Create a Web Service** on Render, connected to your GitHub repo:
   - Build command: `npm install`
   - Start command: `node db/migrate.js && node db/seed.js && npm start`
     (only include `node db/seed.js` on the **first** deploy — remove it
     afterwards so you don't reset data on every deploy)
   - Environment variables:
     - `DATABASE_URL` → paste the Internal Database URL from step 2
     - `SESSION_SECRET` → generate a long random value (same command as above)
     - `NODE_ENV` → `production`
4. Render will give you a live `https://your-app.onrender.com` URL.

Free-tier note: Render's free web services spin down after inactivity and
take ~30–60 seconds to wake up on the next request — normal for a free tier
and fine for a class project/demo.

## Group workflow (GitHub)

1. One member creates the GitHub repo and pushes this project.
2. Everyone else clones it and creates feature branches:
   ```bash
   git checkout -b feature/support-tickets
   ```
3. Each person runs their own local Postgres (or shares one free hosted dev
   database — just don't commit its credentials).
4. Open pull requests into `main`; Render auto-deploys `main` on merge.
5. **Never commit `.env`** — it's already in `.gitignore`. Share secrets
   (like `SESSION_SECRET`) through a private channel, not through git.

## Security notes

This was built with a security-first checklist in mind. What's in place, and
what's intentionally left as a known limitation for a project of this scope:

**In place:**
- Passwords hashed with bcrypt (cost factor 10–12), never stored or logged
  in plaintext
- Server-side sessions (not JWTs in localStorage) — session data lives in
  Postgres, cookie only holds a signed session ID; cookies are `httpOnly`,
  `sameSite=lax`, and `secure` in production
- Session regenerated on login (prevents session fixation)
- Login uses a constant-time comparison path (always runs bcrypt, even for
  unknown users) and a generic error message, so the endpoint doesn't reveal
  which ID numbers are registered
- All admin routes check `role === 'admin'` server-side (`middleware/auth.js`)
  — the frontend hiding a button is never the actual access control
- Every reservation/vehicle lookup is scoped to `req.session.user.id` server
  side, preventing IDOR (one user reading/cancelling another's data)
- All SQL uses parameterized queries — no string-built SQL anywhere
- Input validation with allowlists/regex on every write endpoint (ID number
  format, plate format, year, date/time format, relation dropdown, etc.),
  not just "is it present"
- File uploads: extension allowlist (PDF/JPG/PNG only), 5MB size cap,
  server-generated random filenames (the client's filename is never trusted
  or used on disk), served from a dedicated `/uploads` static route with
  directory listing disabled
- Rate limiting: 10 login attempts / 15 min per IP, 20 registrations / hour,
  300 general API requests / 15 min
- Security headers via Helmet: Content-Security-Policy, X-Frame-Options
  (clickjacking), X-Content-Type-Options: nosniff, HSTS in production
- Centralized error handler: no stack traces, SQL errors, or internal
  details ever reach the client — errors are logged server-side only
- Request bodies capped at 100kb to reduce trivial DoS surface

**Known limitations (reasonable for a class project, worth knowing about):**
- **No CSRF token.** `sameSite=lax` cookies block most cross-site
  POST/DELETE forgery in modern browsers, but this isn't a full CSRF-token
  defense. Fine for a project like this; a production system handling real
  payments should add one (e.g. `csrf-csrf`).
- **No file content-sniffing.** Uploads are checked by extension only, not
  by inspecting file bytes (magic numbers) to confirm they're really a
  PDF/JPG/PNG. A determined user could rename a file. Low risk here since
  uploaded files are never executed and are served as static downloads, but
  a package like `file-type` would close this gap if it mattered more.
- **No email verification / password reset flow.** The "Forgot Password?"
  link on the login page is a placeholder — there's no email service wired
  up. Fine for a demo; a real deployment needs this.
- **No account lockout beyond rate limiting.** Ten failed attempts per 15
  minutes slows brute-forcing but doesn't lock the account outright.
- **No 2FA.** Not implemented — reasonable for this scope.
- **Free-tier hosting caveats.** Render's free Postgres tier has storage/row
  limits and the free web service sleeps when idle — fine for a class
  project, not for anything with real users at scale.

Security is a process, not a checkbox — this covers the standard risks for
an app like this (OWASP Top 10-style: injection, broken auth, broken access
control, security misconfiguration, etc.) but a real production deployment
handling real personal data (IDs, license photos) would warrant a proper
review beyond what's here.

## API overview

All endpoints are under `/api`. Auth via session cookie (`credentials:
'same-origin'` on the frontend). See `routes/*.js` for full request/response
shapes.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register | — | Create account (used by sticker application flow) |
| POST | /api/auth/login | — | Log in |
| POST | /api/auth/logout | user | Log out |
| GET | /api/auth/me | — | Current session user |
| GET | /api/lots | user | List parking lots with occupancy |
| GET | /api/lots/:id/slots | user | Slot map for a lot |
| POST | /api/reservations | user | Book a slot |
| GET | /api/reservations/active | user | Current active reservation |
| GET | /api/reservations/history | user | Past reservations |
| POST | /api/reservations/:id/cancel | user | Cancel own reservation |
| GET/POST | /api/vehicles | user | List / add own vehicles |
| POST | /api/applications | user | Submit sticker application (multipart) |
| GET | /api/applications/mine | user | Own applications |
| GET | /api/applications | admin | All applications (filter by `?status=`) |
| POST | /api/applications/:id/decision | admin | Approve/reject |
| GET | /api/admin/overview | admin | Dashboard stats |
| GET | /api/admin/slots/:lotId | admin | Full slot map with occupant details |
| POST | /api/admin/slots/:id/status | admin | Change slot status |
| GET/POST | /api/support | user/admin | Support tickets |
| POST | /api/support/:id/status | admin | Update ticket status |

## What's built vs. what's next

**Working end-to-end (tested):** login/logout, session auth, slot booking
with race-condition protection (row locking prevents double-booking),
reservation history, cancellation, vehicle + sticker application submission
with file upload, admin approval/rejection, admin dashboard stats, slot
status control, support tickets both sides.

**Reasonable next steps for your group to divide up:**
- Wire up a real payment step (the design shows "Submit & Proceed to
  Payment" — currently a placeholder message)
- Entry/exit gate simulation writing to `entry_exit_logs` (the admin
  dashboard reads from this table but nothing writes to it yet)
- Email notifications on application approval/rejection
- "Extend Time" button on the dashboard (UI is there, not wired up yet)
