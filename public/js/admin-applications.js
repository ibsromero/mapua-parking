function badgeClass(status) {
  return { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected' }[status] || 'badge-pending';
}

function docLink(appId, field, label) {
  return `<a href="/api/applications/${appId}/documents/${field}" target="_blank" rel="noopener" style="font-size:12px;display:block;">${esc(label)}</a>`;
}

async function loadApps(status) {
  const rowsEl = document.getElementById('appRows');
  rowsEl.innerHTML = '<tr><td colspan="8" class="muted">Loading...</td></tr>';
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const { applications } = await api('/api/applications' + qs);
  if (!applications.length) {
    rowsEl.innerHTML = '<tr><td colspan="8" class="muted">No applications found.</td></tr>';
    return;
  }
  rowsEl.innerHTML = applications.map(a => `
    <tr>
      <td>${esc(a.applicant_name)}</td>
      <td>${esc(a.id_number)}</td>
      <td>${esc((a.applicant_type || '').replace('_', '-'))}</td>
      <td>${esc(a.make || '')} ${esc(a.model || '')}</td>
      <td>${esc(a.plate_no || '-')}</td>
      <td>
        ${a.or_cr_file ? docLink(a.id, 'or_cr_file', 'OR/CR') : '<span class="muted" style="font-size:12px;">OR/CR: none</span>'}
        ${a.drivers_license_file ? docLink(a.id, 'drivers_license_file', "Driver's License") : '<span class="muted" style="font-size:12px;">License: none</span>'}
        ${a.university_id_file ? docLink(a.id, 'university_id_file', 'University ID') : '<span class="muted" style="font-size:12px;">ID: none</span>'}
      </td>
      <td>
        <span class="badge ${badgeClass(a.status)}">${esc(a.status)}</span>
        ${a.status === 'rejected' && a.rejection_reason ? `<div class="muted" style="font-size:12px;margin-top:4px;max-width:180px;">${esc(a.rejection_reason)}</div>` : ''}
      </td>
      <td>
        ${a.status === 'pending' ? `
          <button class="btn btn-danger" style="padding:6px 10px;font-size:12px;" data-decide-id="${a.id}" data-decision="rejected">Reject</button>
          <button class="btn btn-primary" style="padding:6px 10px;font-size:12px;" data-decide-id="${a.id}" data-decision="approved">Approve</button>
        ` : '<span class="muted" style="font-size:12px;">Reviewed</span>'}
      </td>
    </tr>`).join('');
}

async function decide(id, decision) {
  let rejection_reason;
  if (decision === 'rejected') {
    rejection_reason = prompt('Reason for rejecting this application (shown to the student):');
    if (rejection_reason === null) return; // cancelled
    if (!rejection_reason.trim()) {
      alert('A reason is required when rejecting an application.');
      return;
    }
  } else if (!confirm('Approve this application?')) {
    return;
  }
  try {
    await api(`/api/applications/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, rejection_reason })
    });
    const active = document.querySelector('#filterTabs .btn.active').dataset.status;
    loadApps(active);
  } catch (e) {
    alert(e.message);
  }
}

// Approve/Reject buttons are re-rendered on every loadApps() call, so this
// listener is delegated on the table body once rather than bound per-row -
// data attributes replace the inline onclick that CSP blocks.
document.getElementById('appRows').addEventListener('click', (e) => {
  const el = e.target.closest('[data-decide-id]');
  if (el) decide(Number(el.dataset.decideId), el.dataset.decision);
});

document.getElementById('filterTabs').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  document.querySelectorAll('#filterTabs .btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  loadApps(e.target.dataset.status);
});

(async function () {
  const user = await requireAuth('admin');
  if (!user) return;
  loadApps('');
})();
