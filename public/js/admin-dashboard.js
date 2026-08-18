(async function () {
  const user = await requireAuth('admin');
  if (!user) return;
  try {
    const data = await api('/api/admin/overview');
    document.getElementById('occPct').textContent = data.occupancy_pct + '%';
    document.getElementById('occDetail').textContent = `${data.slots_occupied} of ${data.slots_total} slots occupied`;
    document.getElementById('activeCount').textContent = data.active_reservations;
    document.getElementById('pendingCount').textContent = data.pending_applications;

    const box = document.getElementById('recentActivity');
    if (!data.recent_activity.length) {
      box.innerHTML = '<p class="muted">No recent entry/exit activity logged yet.</p>';
    } else {
      box.innerHTML = data.recent_activity.map(a => `
        <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--border);">
          <div><strong>Plate: ${esc(a.plate_no || '—')}</strong><br/><span class="muted" style="font-size:13px;">${esc(a.action)}</span></div>
          <span class="muted" style="font-size:13px;">${new Date(a.logged_at).toLocaleString()}</span>
        </div>`).join('');
    }
  } catch (e) {
    document.getElementById('recentActivity').innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
  }
})();
