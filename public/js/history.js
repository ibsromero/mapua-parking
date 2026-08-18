function badgeClass(status) {
  return { ongoing: 'badge-ongoing', completed: 'badge-completed', cancelled: 'badge-cancelled' }[status] || 'badge-completed';
}
(async function () {
  const user = await requireAuth('user');
  if (!user) return;
  try {
    const { reservations } = await api('/api/reservations/history');
    const grid = document.getElementById('historyGrid');
    if (!reservations.length) {
      grid.innerHTML = '<p class="muted">No reservations yet.</p>';
      return;
    }
    grid.innerHTML = reservations.map(r => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="muted" style="font-size:13px;">${esc(r.reservation_date?.slice(0,10))}</span>
          <span class="badge ${badgeClass(r.status)}">${esc(r.status)}</span>
        </div>
        <div style="font-weight:700;margin:6px 0 12px;">${esc(r.start_time?.slice(0,5))} - ${esc(r.end_time?.slice(0,5))}</div>
        <div style="background:#f9fafb;border-radius:8px;padding:12px;display:flex;justify-content:space-between;">
          <div><label>Level</label><div>${esc(r.lot_name)}</div></div>
          <div><label>Slot Number</label><div style="color:var(--maroon);font-weight:700;">${esc(r.slot_number)}</div></div>
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('historyGrid').innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
  }
})();
