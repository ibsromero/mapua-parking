document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('signupError');
  const btn = document.getElementById('signupBtn');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  try {
    const { user } = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        applicant_type: document.getElementById('applicant_type').value,
        full_name: document.getElementById('full_name').value.trim(),
        id_number: document.getElementById('id_number').value.trim(),
        course_year: document.getElementById('course_year').value.trim(),
        contact_no: document.getElementById('contact_no').value.trim(),
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      })
    });
    window.location.href = user.role === 'admin' ? '/admin/dashboard.html' : '/dashboard.html';
  } catch (err) {
    errEl.textContent = err.message || 'Could not create account.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
});
