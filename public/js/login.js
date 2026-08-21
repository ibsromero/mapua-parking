document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Logging in...';
  try {
    const id_number = document.getElementById('id_number').value.trim();
    const password = document.getElementById('password').value;
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ id_number, password })
    });
    window.location.href = user.role === 'admin' ? '/admin/dashboard.html' : '/dashboard.html';
  } catch (err) {
    errEl.textContent = err.message || 'Login failed.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Log In';
  }
});

document.querySelector('[data-forgot-password]').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('forgotPasswordNote').style.display = 'block';
});
