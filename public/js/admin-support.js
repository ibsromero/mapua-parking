function badgeClass(status) {
  return { new: 'badge-pending', in_progress: 'badge-pending', waiting_for_user: 'badge-reserved', resolved: 'badge-completed' }[status] || 'badge-pending';
}
const NEXT_STATUS = { new: 'in_progress', in_progress: 'resolved', waiting_for_user: 'resolved', resolved: null };
const NEXT_LABEL = { new: 'Start Progress', in_progress: 'Resolve', waiting_for_user: 'Resolve' };

async function loadTickets() {
  const rowsEl = document.getElementById('ticketRows');
  const { tickets } = await api('/api/support');
  if (!tickets.length) { rowsEl.innerHTML = '<tr><td colspan="6" class="muted">No tickets.</td></tr>'; return; }
  rowsEl.innerHTML = tickets.map(t => `
    <tr>
      <td>${esc(t.full_name)}<br/><span class="muted" style="font-size:12px;">ID: ${esc(t.id_number)}</span></td>
      <td>${esc(t.category)}</td>
      <td style="max-width:240px;">${esc(t.description || '')}</td>
      <td><span class="badge ${badgeClass(t.status)}">${esc(t.status.replace('_',' '))}</span></td>
      <td>${new Date(t.created_at).toLocaleDateString()}</td>
      <td>${NEXT_STATUS[t.status] ? `<button class="btn" style="padding:6px 10px;font-size:12px;" data-advance-id="${t.id}" data-advance-status="${NEXT_STATUS[t.status]}">${NEXT_LABEL[t.status]}</button>` : '<span class="muted" style="font-size:12px;">Closed</span>'}</td>
    </tr>`).join('');
}

async function advance(id, status) {
  try {
    await api(`/api/support/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    loadTickets();
  } catch (e) {
    alert(e.message);
  }
}

// Advance/Resolve buttons are re-rendered on every loadTickets() call, so
// this listener is delegated on the table body once — data attributes
// replace the inline onclick that CSP blocks.
document.getElementById('ticketRows').addEventListener('click', (e) => {
  const el = e.target.closest('[data-advance-id]');
  if (el) advance(Number(el.dataset.advanceId), el.dataset.advanceStatus);
});

(async function () {
  const user = await requireAuth('admin');
  if (!user) return;
  loadTickets();
})();
