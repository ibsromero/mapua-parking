const files = {};
document.querySelectorAll('.upload-box').forEach(box => {
  box.addEventListener('click', () => document.getElementById(box.dataset.for).click());
});
['or_cr_file', 'drivers_license_file', 'university_id_file'].forEach(id => {
  document.getElementById(id).addEventListener('change', (e) => {
    const box = document.querySelector(`.upload-box[data-for="${id}"]`);
    if (e.target.files[0]) {
      files[id] = e.target.files[0];
      box.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> ${esc(e.target.files[0].name)}`;
      box.classList.add('filled');
    }
  });
});

// Step navigation buttons use data-goto instead of inline onclick (blocked by CSP).
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto]');
  if (el) goStep(Number(el.dataset.goto));
});

function goStep(n) {
  document.querySelectorAll('.step').forEach(s => {
    const step = Number(s.dataset.step);
    s.classList.toggle('active', step === n);
    s.classList.toggle('done', step < n);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', Number(p.dataset.panel) === n));
  if (n === 4) renderReview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function val(id) { return document.getElementById(id).value; }

// Joins only the non-empty parts with the given separator, so blank optional
// fields (color, year, course/year, email) don't leave dangling punctuation
// like "ABC 1234 -" or a lone "," in the review summary.
function joinParts(parts, sep) {
  return parts.filter(p => p && p.trim()).join(sep);
}

function renderReview() {
  const applicantLines = [val('full_name'), val('id_number'), val('course_year'), val('email')]
    .filter(v => v && v.trim())
    .map(esc);
  const vehicleTitle = joinParts([val('plate_no'), joinParts([val('make'), val('model')], ' ')], ' - ');
  const vehicleDetail = joinParts([val('color'), val('year')], ', ');

  document.getElementById('reviewSummary').innerHTML = `
    <div class="grid-2">
      <div>
        <strong>Applicant Info</strong>
        <p>${applicantLines.join('<br/>') || '<span class="muted">Not provided</span>'}</p>
      </div>
      <div>
        <strong>Vehicle Info</strong>
        <p>${esc(vehicleTitle) || '<span class="muted">Not provided</span>'}${vehicleDetail ? `<br/>${esc(vehicleDetail)}` : ''}</p>
      </div>
    </div>`;
}

document.getElementById('applyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('applyError');
  const okEl = document.getElementById('applySuccess');
  errEl.style.display = 'none';
  okEl.style.display = 'none';
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;

  try {
    // 1. Register the applicant as a user (id_number + password become their login)
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        id_number: val('id_number'),
        full_name: val('full_name'),
        email: val('email'),
        contact_no: val('contact_no'),
        address: val('address'),
        applicant_type: val('applicant_type'),
        course_year: val('course_year'),
        password: val('password')
      })
    });

    // 2. Save the vehicle
    const { vehicle } = await api('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        plate_no: val('plate_no'), make: val('make'), model: val('model'), year: val('year'),
        color: val('color'), trim: val('trim'), owner_name: val('owner_name'),
        owner_address: val('owner_address'), relation_to_applicant: val('relation_to_applicant')
      })
    });

    // 3. Submit the application with uploaded files
    const fd = new FormData();
    fd.append('vehicle_id', vehicle.id);
    fd.append('rules_acknowledged', document.getElementById('rules_acknowledged').checked);
    Object.entries(files).forEach(([key, file]) => fd.append(key, file));
    await api('/api/applications', { method: 'POST', body: fd });

    okEl.textContent = 'Application submitted! Redirecting to your dashboard…';
    okEl.style.display = 'block';
    setTimeout(() => (window.location.href = '/dashboard.html'), 1500);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
  }
});
