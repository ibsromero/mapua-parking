const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
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
      window.location.href = homeFor(user.role);
    } catch (err) {
      errEl.textContent = err.message || 'Login failed.';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });
}

const forgotPasswordLink = document.querySelector('[data-forgot-password]');
if (forgotPasswordLink) {
  forgotPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    const note = document.getElementById('forgotPasswordNote');
    if (note) note.style.display = 'block';
  });
}
