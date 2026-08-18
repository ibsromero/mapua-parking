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

async function requireAuth(role) {
  try {
    const { user } = await api('/api/auth/me');
    if (!user) {
      window.location.href = '/login.html';
      return null;
    }
    if (role && user.role !== role) {
      window.location.href = user.role === 'admin' ? '/admin/dashboard.html' : '/dashboard.html';
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
