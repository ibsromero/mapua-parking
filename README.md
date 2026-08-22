# Mapúa Parking System

A parking reservation and vehicle sticker application system for Mapúa
students, faculty, and staff. Students sign up, apply for a vehicle sticker,
book a parking slot once approved, and track their reservation history.
Admins get a live occupancy dashboard, review sticker applications and their
uploaded documents, control slot status, simulate gate entry/exit, and manage
support tickets.

Built with **Node.js + Express + PostgreSQL**, session-based auth, and plain
HTML/CSS/vanilla JS on the frontend (no build step required).

## Tech stack

- **Backend:** Node.js, Express
- **Database:** PostgreSQL (hosted on Neon)
- **Hosting:** Render, auto-deploying from GitHub on every push
- **Auth:** express-session (server-side sessions stored in Postgres via
  `connect-pg-simple`), bcrypt password hashing
- **File uploads:** Multer (sticker application documents), served through an
  authenticated route rather than as public static files
- **Frontend:** Static HTML/CSS/vanilla JS served by Express - no framework,
  no build step

## Project structure

```
mapua-parking/
├── db/
│   ├── schema.sql       # full DB schema (tables, indexes, session store)
│   ├── migrate.js       # applies schema.sql - safe to re-run on every deploy
│   ├── seed.js          # creates parking lots/slots + demo accounts
│   └── pool.js          # PostgreSQL connection pool
├── routes/               # Express route handlers (one file per resource)
├── middleware/auth.js    # requireLogin / requireAdmin guards
├── public/
│   ├── login.html, signup.html, dashboard.html, reservations.html,
│   │   history.html, support.html, apply.html
│   ├── admin/            # admin-only pages
│   ├── js/                # one script per page + common.js (shared helpers)
│   ├── css/style.css
│   └── images/mapua-logo.png
├── uploads/                # sticker application documents (gitignored)
├── server.js
├── .env.example
└── package.json
```

## Deploying (Render + Neon)

1. **Database:** create a project on [neon.tech](https://neon.tech) (free
   tier), copy its connection string.
2. **Web service on Render**, connected to this GitHub repo:
   - Build command: `npm install`
   - Start command: `node db/migrate.js && npm start`
   - Environment variables:
     - `DATABASE_URL` → the Neon connection string
     - `SESSION_SECRET` → a long random value, e.g.
       `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     - `NODE_ENV` → `production`
3. Push to `main` and Render deploys automatically.

Running `node db/migrate.js` on every boot is intentional, not just for the
first deploy - the migration is idempotent (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`), so it keeps the live database schema in sync
with whatever the deployed code expects, even after a schema change.

Demo accounts (seeded once via `node db/seed.js`, or your own signups):
- Admin: `ADMIN-0001` / `admin123`
- Student: `2021105432` / `student123`

Free-tier note: Render's free web service spins down after inactivity and
takes ~30–60 seconds to wake up on the next request.

## Group workflow (GitHub)

1. Clone the repo, create a feature branch:
   ```bash
   git checkout -b feature/support-tickets
   ```
2. Everyone points their local `.env` at the same shared Neon `DATABASE_URL`
   (shared privately, never committed - it's in `.gitignore`).
3. Open pull requests into `main`; Render auto-deploys `main` on merge.

## Security notes

Built with a security-first mindset: bcrypt password hashing, server-side
sessions (not client-stored tokens), every admin route checked server-side
(not just hidden in the UI), all database queries parameterized, input
validated with allowlists rather than just "is it present," uploaded
documents served through an authenticated route instead of public static
files, rate limiting on login/registration, and standard security headers
(CSP, clickjacking protection, HSTS) via Helmet.

Known gaps, reasonable for a class project but worth knowing about: no CSRF
token beyond `sameSite=lax` cookies, no file content-sniffing (uploads are
checked by extension only), no email-based password reset, no 2FA. A real
production deployment handling real personal data (IDs, license photos)
would want a fuller review beyond what's here.

## API overview

All endpoints are under `/api`, authenticated via session cookie. See
`routes/*.js` for full request/response shapes.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register | - | Create account |
| POST | /api/auth/login | - | Log in |
| POST | /api/auth/logout | user | Log out |
| GET | /api/auth/me | - | Current session user |
| GET | /api/auth/profile | user | Full profile (name, ID, contact info) |
| GET | /api/lots | user | Lots with current occupancy |
| GET | /api/lots/:id/slots | user | Slot map for a lot/date/time window |
| POST | /api/reservations | user | Book a slot (requires an approved sticker) |
| GET | /api/reservations/active | user | Current active reservation |
| GET | /api/reservations/history | user | Past reservations |
| POST | /api/reservations/:id/cancel | user | Cancel own reservation |
| POST | /api/reservations/:id/extend | user | Extend an ongoing reservation |
| GET/POST | /api/vehicles | user | List / add own vehicles |
| POST | /api/applications | user | Submit sticker application (multipart) |
| GET | /api/applications/mine | user | Own applications |
| GET | /api/applications/:id/documents/:field | user/admin | Fetch one uploaded document (owner or admin only) |
| GET | /api/applications | admin | All applications (filter by `?status=`) |
| POST | /api/applications/:id/decision | admin | Approve/reject |
| GET | /api/admin/overview | admin | Dashboard stats |
| GET | /api/admin/slots/:lotId | admin | Live slot map with occupant details |
| POST | /api/admin/slots/:id/status | admin | Set operational status (available/maintenance) |
| POST | /api/admin/slots/:id/entry | admin | Log gate entry (vehicle arrived) |
| POST | /api/admin/slots/:id/exit | admin | Log gate exit (vehicle left) |
| GET/POST | /api/support | user/admin | Support tickets |
| POST | /api/support/:id/status | admin | Update ticket status |
