// Small fetch wrapper. Always sends/receives JSON and credentials (session cookie).
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* no body */
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

// Escape text before inserting into innerHTML — never trust data from the
// API (or anything a user typed) when building HTML strings.
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Where a logged-in user belongs, based on role -- used both for the
// post-login redirect and for bouncing someone off a page meant for a
// different role.
function homeFor(role) {
  if (role === 'admin') return '/admin/dashboard.html';
  if (role === 'guard') return '/guard/checkin.html';
  return '/dashboard.html';
}

async function requireAuth(role) {
  try {
    const { user } = await api('/api/auth/me');
    if (!user) {
      window.location.href = '/login.html';
      return null;
    }
    if (role && user.role !== role) {
      window.location.href = homeFor(user.role);
      return null;
    }
    return user;
  } catch (e) {
    window.location.href = '/login.html';
    return null;
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// Delegated handler for every "Logout" link across the app. Inline
// onclick="" attributes are blocked by the CSP (script-src-attr 'none'),
// so every page's logout link uses a data-logout attribute instead of an
// inline handler, and this one listener (loaded on every page via
// common.js) handles all of them.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-logout]');
  if (el) {
    e.preventDefault();
    logout();
  }
});
