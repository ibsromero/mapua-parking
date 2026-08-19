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
      clearStepError();
    }
  });
});

let currentStep = 1;

// Step navigation buttons use data-goto instead of inline onclick (blocked by CSP).
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto]');
  if (!el) return;
  const target = Number(el.dataset.goto);
  // Only gate forward movement — always allow going back without validation.
  if (target > currentStep && !validateStep(currentStep)) return;
  goStep(target);
});

const REQUIRED_DOCS = [
  { id: 'or_cr_file', label: 'Official Receipt / Certificate of Registration (OR/CR)' },
  { id: 'drivers_license_file', label: "Driver's License" },
  { id: 'university_id_file', label: 'University ID' }
];

function isStepValid(n) {
  const panel = document.querySelector(`.panel[data-panel="${n}"]`);
  const requiredFields = panel.querySelectorAll('[required]:not([type="file"])');
  for (const field of requiredFields) {
    if (!field.checkValidity()) return false;
  }
  if (n === 1) {
    for (const doc of REQUIRED_DOCS) {
      if (!files[doc.id]) return false;
    }
  }
  return true;
}

function validateStep(n) {
  const panel = document.querySelector(`.panel[data-panel="${n}"]`);

  // Visible required fields (text/select/checkbox) — use native HTML5
  // validation so the browser shows its normal inline error bubble.
  const requiredFields = panel.querySelectorAll('[required]:not([type="file"])');
  for (const field of requiredFields) {
    if (!field.checkValidity()) {
      field.reportValidity();
      return false;
    }
  }

  // The three document uploads are hidden <input type="file"> elements
  // (a styled div handles the click), so native reportValidity() on a
  // hidden input isn't reliable across browsers — check them manually.
  if (n === 1) {
    for (const doc of REQUIRED_DOCS) {
      if (!files[doc.id]) {
        showStepError(`Please upload your ${doc.label} before continuing.`);
        document.querySelector(`.upload-box[data-for="${doc.id}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
      }
    }
  }

  clearStepError();
  return true;
}

function showStepError(msg) {
  const el = document.getElementById('stepError');
  el.textContent = msg;
  el.style.display = 'block';
}

function clearStepError() {
  const el = document.getElementById('stepError');
  el.style.display = 'none';
}

function goStep(n) {
  currentStep = n;
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

  // Defense in depth: re-validate every step's requirements right before
  // submitting, since a user can navigate back to an earlier step and
  // clear a field after it was already validated once. Checked silently
  // first so a valid submission never flashes through earlier steps;
  // only jumps back and shows the browser's error bubble if something's
  // actually wrong.
  for (const step of [1, 2, 3]) {
    if (!isStepValid(step)) {
      goStep(step);
      validateStep(step);
      return;
    }
  }

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
