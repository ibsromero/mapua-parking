// Small fetch wrapper. Always sends/receives JSON and credentials (session cookie).
async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
  const { timeout: _timeout, ...fetchOptions } = options;
  let res;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      headers: fetchOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...fetchOptions
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request took too long. Check your connection and try again.');
    if (!navigator.onLine) throw new Error('You appear to be offline. Reconnect and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login.html';
  }
}

function setupRememberedId() {
  const idInput = document.getElementById('id_number');
  const remember = document.getElementById('remember');
  if (!idInput || !remember) return;

  const rememberedId = localStorage.getItem('mapuaParking.rememberedId');
  if (rememberedId) {
    idInput.value = rememberedId;
    remember.checked = true;
  }

  return () => {
    if (remember.checked) localStorage.setItem('mapuaParking.rememberedId', idInput.value.trim());
    else localStorage.removeItem('mapuaParking.rememberedId');
  };
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
