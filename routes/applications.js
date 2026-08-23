const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});
const upload = multer({
  storage,
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

// POST /api/applications  (multipart form: vehicle_id + files + rules_acknowledged)
router.post('/', requireLogin, uploadFields, async (req, res) => {
  const { vehicle_id, rules_acknowledged } = req.body;
  const files = req.files || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO sticker_applications
        (user_id, vehicle_id, or_cr_file, drivers_license_file, university_id_file, rules_acknowledged)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        req.session.user.id,
        vehicle_id || null,
        files.or_cr_file?.[0]?.filename || null,
        files.drivers_license_file?.[0]?.filename || null,
        files.university_id_file?.[0]?.filename || null,
        rules_acknowledged === 'true' || rules_acknowledged === true
      ]
    );
    res.status(201).json({ application: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit application.' });
  }
});

// GET /api/applications/mine
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, v.plate_no, v.make, v.model
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
      `SELECT a.*, u.full_name AS applicant_name, u.id_number, u.applicant_type,
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
       WHERE id = $4 RETURNING *`,
      [decision, req.session.user.id, rejectionReason, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Application not found.' });
    res.json({ application: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update application.' });
  }
});

// GET /api/applications/:id/documents/:field - stream one uploaded document.
// :field selects which DB column to read from (whitelisted below, never a
// raw filesystem path from the client), and only the applicant themselves
// or an admin may fetch it -- these are personal ID scans, not public files.
const DOC_FIELDS = ['or_cr_file', 'drivers_license_file', 'university_id_file'];
router.get('/:id/documents/:field', requireLogin, async (req, res) => {
  const { field } = req.params;
  if (!DOC_FIELDS.includes(field)) return res.status(400).json({ error: 'Invalid document field.' });

  try {
    const { rows } = await pool.query('SELECT * FROM sticker_applications WHERE id = $1', [req.params.id]);
    const application = rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const isOwner = application.user_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not authorized to view this document.' });

    const filename = application[field];
    if (!filename) return res.status(404).json({ error: 'No file was uploaded for this document.' });

    res.sendFile(path.join(__dirname, '..', 'uploads', filename), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File not found on server.' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load document.' });
  }
});

module.exports = router;
