function badgeClass(status) {
  return { new: 'badge-pending', in_progress: 'badge-pending', waiting_for_user: 'badge-reserved', resolved: 'badge-completed' }[status] || 'badge-pending';
}
async function loadTickets() {
  const { tickets } = await api('/api/support/mine');
  const list = document.getElementById('ticketList');
  if (!tickets.length) { list.innerHTML = '<p class="muted">No tickets yet.</p>'; return; }
  list.innerHTML = tickets.map(t => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;">
        <strong>${esc(t.category)}</strong>
        <span class="badge ${badgeClass(t.status)}">${esc(t.status.replace('_',' '))}</span>
      </div>
      <p class="muted" style="margin:8px 0 0;">${esc(t.description || '')}</p>
    </div>`).join('');
}

document.getElementById('ticketForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('ticketError');
  errEl.style.display = 'none';
  try {
    await api('/api/support', {
      method: 'POST',
      body: JSON.stringify({
        category: document.getElementById('category').value,
        description: document.getElementById('description').value
      })
    });
    document.getElementById('description').value = '';
    loadTickets();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

(async function () {
  const user = await requireAuth('user');
  if (!user) return;
  loadTickets();
})();
