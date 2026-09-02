const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Files are kept in memory just long enough to write their bytes into the
// database -- never touched to local disk. Render's filesystem is
// ephemeral (wiped on every redeploy or sleep/wake), so anything written to
// disk at runtime doesn't reliably survive; Neon's Postgres storage does.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only PDF, JPG, PNG files are allowed.'), ok);
  }
});

const uploadFields = upload.fields([
  { name: 'or_cr_file', maxCount: 1 },
  { name: 'drivers_license_file', maxCount: 1 },
  { name: 'university_id_file', maxCount: 1 }
]);

const MIME_BY_EXT = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
function mimeFor(file) {
  return file.mimetype || MIME_BY_EXT[path.extname(file.originalname).toLowerCase()] || 'application/octet-stream';
}

// POST /api/applications  (multipart form: vehicle_id + files + rules_acknowledged)
router.post('/', requireLogin, uploadFields, async (req, res) => {
  const vehicleId = Number.parseInt(req.body.vehicle_id, 10);
  const files = req.files || {};
  const orCr = files.or_cr_file?.[0];
  const license = files.drivers_license_file?.[0];
  const uniId = files.university_id_file?.[0];
  const rulesAck = req.body.rules_acknowledged === 'true' || req.body.rules_acknowledged === true;

  if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
    return res.status(400).json({ error: 'Select a valid vehicle for this application.' });
  }
  if (!orCr || !license || !uniId) {
    return res.status(400).json({ error: 'Please upload all required documents before submitting.' });
  }
  if (!rulesAck) {
    return res.status(400).json({ error: 'You must acknowledge the parking rules before submitting.' });
  }

  try {
    const owned = await pool.query('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, req.session.user.id]);
    if (!owned.rows[0]) {
      return res.status(403).json({ error: 'That vehicle does not belong to you.' });
    }

    const existing = await pool.query(
      `SELECT id FROM sticker_applications
       WHERE user_id = $1 AND vehicle_id = $2 AND status IN ('pending', 'approved')
       LIMIT 1`,
      [req.session.user.id, vehicleId]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'This vehicle already has an active sticker application.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO sticker_applications
        (user_id, vehicle_id,
         or_cr_file, or_cr_data, or_cr_mimetype,
         drivers_license_file, drivers_license_data, drivers_license_mimetype,
         university_id_file, university_id_data, university_id_mimetype,
         rules_acknowledged)
       VALUES ($1,$2, $3,$4,$5, $6,$7,$8, $9,$10,$11, $12)
       RETURNING id, user_id, vehicle_id, status, or_cr_file, drivers_license_file, university_id_file,
                 rules_acknowledged, rejection_reason, submitted_at, reviewed_at, reviewed_by`,
      [
        req.session.user.id,
        vehicleId,
        orCr?.originalname || null, orCr?.buffer || null, orCr ? mimeFor(orCr) : null,
        license?.originalname || null, license?.buffer || null, license ? mimeFor(license) : null,
        uniId?.originalname || null, uniId?.buffer || null, uniId ? mimeFor(uniId) : null,
        true
      ]
    );
    res.status(201).json({ application: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This vehicle already has an active sticker application.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to submit application.' });
  }
});

// GET /api/applications/mine
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, a.vehicle_id, a.status, a.or_cr_file, a.drivers_license_file,
              a.university_id_file, a.rules_acknowledged, a.rejection_reason, a.submitted_at,
              a.reviewed_at, a.reviewed_by, v.plate_no, v.make, v.model
       FROM sticker_applications a
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       WHERE a.user_id = $1 ORDER BY a.submitted_at DESC`,
      [req.session.user.id]
    );
    res.json({ applications: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load applications.' });
  }
});

// --- Admin ---

// GET /api/applications  (admin: list all, optional ?status=pending)
router.get('/', requireAdmin, async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = 'WHERE a.status = $1';
    }
    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, a.vehicle_id, a.status, a.or_cr_file, a.drivers_license_file,
              a.university_id_file, a.rules_acknowledged, a.rejection_reason, a.submitted_at,
              a.reviewed_at, a.reviewed_by, u.full_name AS applicant_name, u.id_number, u.applicant_type,
              v.plate_no, v.make, v.model
       FROM sticker_applications a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       ${where}
       ORDER BY a.submitted_at DESC`,
      params
    );
    res.json({ applications: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load applications.' });
  }
});

// POST /api/applications/:id/decision  { decision: 'approved' | 'rejected', rejection_reason? }
router.post('/:id/decision', requireAdmin, async (req, res) => {
  const { decision } = req.body;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be approved or rejected.' });
  }
  // Reason is required on rejection so the student knows what to fix -- an
  // application can't just vanish into "rejected" with no explanation.
  let rejectionReason = null;
  if (decision === 'rejected') {
    rejectionReason = typeof req.body.rejection_reason === 'string' ? req.body.rejection_reason.trim().slice(0, 1000) : '';
    if (!rejectionReason) {
      return res.status(400).json({ error: 'A reason is required when rejecting an application.' });
    }
  }
  try {
    const { rows } = await pool.query(
      `UPDATE sticker_applications
       SET status = $1, reviewed_at = NOW(), reviewed_by = $2, rejection_reason = $3
       WHERE id = $4 AND status = 'pending'
       RETURNING id, user_id, vehicle_id, status, or_cr_file, drivers_license_file, university_id_file,
                 rules_acknowledged, rejection_reason, submitted_at, reviewed_at, reviewed_by`,
      [decision, req.session.user.id, rejectionReason, req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Only pending applications can be reviewed.' });
    res.json({ application: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update application.' });
  }
});

// GET /api/applications/:id/documents/:field - stream one uploaded document
// straight from the database. :field selects which column to read from
// (whitelisted below, never a raw filesystem path), and only the applicant
// themselves or an admin may fetch it -- these are personal ID scans.
const DOC_FIELDS = {
  or_cr_file: ['or_cr_data', 'or_cr_mimetype', 'or_cr_file'],
  drivers_license_file: ['drivers_license_data', 'drivers_license_mimetype', 'drivers_license_file'],
  university_id_file: ['university_id_data', 'university_id_mimetype', 'university_id_file']
};
router.get('/:id/documents/:field', requireLogin, async (req, res) => {
  const columns = DOC_FIELDS[req.params.field];
  if (!columns) return res.status(400).json({ error: 'Invalid document field.' });
  const [dataCol, mimeCol, nameCol] = columns;

  try {
    const { rows } = await pool.query(
      `SELECT user_id, ${dataCol} AS data, ${mimeCol} AS mimetype, ${nameCol} AS filename
       FROM sticker_applications WHERE id = $1`,
      [req.params.id]
    );
    const application = rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const isOwner = application.user_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not authorized to view this document.' });

    if (!application.data) return res.status(404).json({ error: 'No file was uploaded for this document.' });

    res.set('Content-Type', application.mimetype || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${(application.filename || 'document').replace(/"/g, '')}"`);
    res.send(application.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load document.' });
  }
});

module.exports = router;
