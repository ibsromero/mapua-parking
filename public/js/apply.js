let currentUser = null;

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
  // Only gate forward movement -- always allow going back without validation.
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
  if (n === 2) {
    for (const doc of REQUIRED_DOCS) {
      if (!files[doc.id]) return false;
    }
  }
  return true;
}

function validateStep(n) {
  const panel = document.querySelector(`.panel[data-panel="${n}"]`);
  const requiredFields = panel.querySelectorAll('[required]:not([type="file"])');
  for (const field of requiredFields) {
    if (!field.checkValidity()) {
      field.reportValidity();
      return false;
    }
  }

  // The three document uploads are hidden <input type="file"> elements
  // (a styled div handles the click), so native reportValidity() on a
  // hidden input isn't reliable across browsers -- check them manually.
  if (n === 2) {
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

function joinParts(parts, sep) {
  return parts.filter(p => p && p.trim()).join(sep);
}

function renderReview() {
  const box = document.getElementById('reviewSummary');
  const applicantLines = currentUser
    ? [currentUser.full_name, currentUser.id_number, currentUser.course_year, currentUser.email]
        .filter(v => v && String(v).trim())
        .map(esc)
    : [];

  const vehicleTitle = joinParts([val('plate_no'), joinParts([val('make'), val('model')], ' ')], ' - ');
  const vehicleDetail = joinParts([val('color'), val('year')], ', ');

  box.innerHTML = `
    <div class="grid-2">
      <div>
        <strong>Applicant Info</strong>
        <p>${applicantLines.join('<br/>') || '<span class="muted">Not available</span>'}</p>
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
  // first so a valid submission never flashes through earlier steps.
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
    let vehicleId = null;
    let vehicleExists = false;
    const plate_no = val('plate_no');
    const make = val('make');
    const model = val('model');
    const year = val('year');
    const color = val('color');
    const trim = val('trim');
    const owner_name = val('owner_name');
    const owner_address = val('owner_address');
    const relation_to_applicant = val('relation_to_applicant');

    try {
      const { vehicle } = await api('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          plate_no, make, model, year,
          color, trim, owner_name,
          owner_address, relation_to_applicant
        })
      });
      vehicleId = vehicle.id;
    } catch (error) {
      if (error.message && error.message.includes('already saved to your account')) {
        vehicleExists = true;
        const { vehicles } = await api('/api/vehicles');
        const existing = vehicles.find(v => v.plate_no && v.plate_no.toUpperCase() === plate_no.toUpperCase());
        if (!existing) throw error;
        vehicleId = existing.id;
      } else {
        throw error;
      }
    }

    const fd = new FormData();
    fd.append('vehicle_id', vehicleId);
    fd.append('rules_acknowledged', document.getElementById('rules_acknowledged').checked);
    fd.append('skip_application_review', document.getElementById('submitBtn')?.dataset.skipReview === 'true' ? 'true' : 'false');
    Object.entries(files).forEach(([key, file]) => fd.append(key, file));
    await api('/api/applications', { method: 'POST', body: fd });

    if (vehicleExists) {
      okEl.textContent = 'Application submitted with your existing vehicle. Redirecting to your dashboard...';
    } else {
      okEl.textContent = 'Application submitted. Redirecting to your dashboard...';
    }

    okEl.style.display = 'block';
    setTimeout(() => (window.location.href = '/dashboard.html'), 1500);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
  }
});

(async function () {
  const user = await requireAuth('user');
  if (!user) return;
  try {
    const { profile } = await api('/api/auth/profile');
    currentUser = profile;
  } catch (e) {
    currentUser = { full_name: user.full_name, id_number: user.id_number };
  }

  try {
    const { vehicles } = await api('/api/vehicles');
    const hasApprovedSticker = vehicles.some(v => v.has_approved_sticker);
    const submitBtn = document.getElementById('submitBtn');
    if (hasApprovedSticker && submitBtn) {
      submitBtn.title = 'Legacy sticker holder: application review bypass enabled for this additional vehicle.';
      submitBtn.dataset.skipReview = 'true';
    }
  } catch (e) {
    // Non-critical: only use the bypass when the current user already has a valid sticker.
  }
})();
