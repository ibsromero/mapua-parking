const applicantTypeEl = document.getElementById('applicant_type');
function syncStudentFields() {
  const isStudent = applicantTypeEl.value === 'student';
  ['student_status', 'program'].forEach((id) => {
    const el = document.getElementById(id);
    const field = el.closest('.field');
    el.required = isStudent;
    field.style.display = isStudent ? 'block' : 'none';
    if (!isStudent) el.value = '';
  });
}
applicantTypeEl.addEventListener('change', syncStudentFields);
syncStudentFields();

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('signupError');
  const btn = document.getElementById('signupBtn');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  try {
    const applicantType = document.getElementById('applicant_type').value;
    const { user } = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        applicant_type: applicantType,
        full_name: document.getElementById('full_name').value.trim(),
        id_number: document.getElementById('id_number').value.trim(),
        student_status: applicantType === 'student' ? document.getElementById('student_status').value : null,
        program: applicantType === 'student' ? document.getElementById('program').value : '',
        course_year: applicantType === 'student' ? document.getElementById('program').value : '',
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
