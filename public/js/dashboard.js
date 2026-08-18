(async function () {
  const user = await requireAuth('user');
  if (!user) return;
  document.getElementById('welcome').textContent = `Welcome back, ${user.full_name.split(' ')[0]}`;

  // Active reservation
  try {
    const { reservation } = await api('/api/reservations/active');
    const box = document.getElementById('activeReservation');
    if (!reservation) {
      box.innerHTML = `<p class="muted">No active reservation. <a href="/reservations.html">Book a slot</a> to get started.</p>`;
    } else {
      box.innerHTML = `
        <span class="badge badge-ongoing">● Ongoing</span>
        <div class="grid-2" style="margin-top:16px;">
          <div><label>Location</label><div>${esc(reservation.lot_name)}</div></div>
          <div><label>Slot</label><div style="color:var(--maroon);font-weight:700;">#${esc(reservation.slot_number)}</div></div>
          <div><label>Date</label><div>${esc(reservation.reservation_date?.slice(0,10))}</div></div>
          <div><label>Vehicle</label><div>${esc(reservation.plate_no || '—')}</div></div>
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button class="btn" style="flex:1;" id="cancelBtn">Cancel</button>
        </div>`;
      document.getElementById('cancelBtn').addEventListener('click', async () => {
        if (!confirm('Cancel this reservation?')) return;
        await api(`/api/reservations/${reservation.id}/cancel`, { method: 'POST' });
        location.reload();
      });
    }
  } catch (e) {
    document.getElementById('activeReservation').innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
  }

  // Occupancy
  try {
    const { lots } = await api('/api/lots');
    const box = document.getElementById('occupancy');
    box.innerHTML = lots.map(lot => {
      const total = Number(lot.total), available = Number(lot.available);
      const pct = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
      return `
        <div style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;font-weight:700;">
            <span>${esc(lot.name)}</span><span>${pct}% Full</span>
          </div>
          <div style="background:#eee;border-radius:6px;height:8px;margin:6px 0;">
            <div style="background:var(--maroon);width:${pct}%;height:8px;border-radius:6px;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);">
            <span>${available} slots available</span><span>${total} total</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('occupancy').innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
  }
})();
