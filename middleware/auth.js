function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireGuard(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'guard') {
    return res.status(403).json({ error: 'Guard access required' });
  }
  next();
}

// Gate check-in/check-out is operational work either role can do -- guards
// handle it day to day, but admins aren't locked out of it.
function requireGuardOrAdmin(req, res, next) {
  if (!req.session.user || !['guard', 'admin'].includes(req.session.user.role)) {
    return res.status(403).json({ error: 'Guard or admin access required' });
  }
  next();
}

module.exports = { requireLogin, requireAdmin, requireGuard, requireGuardOrAdmin };
