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
          <div><label>Time</label><div id="resTimeLabel">${esc(reservation.start_time?.slice(0,5))} - ${esc(reservation.end_time?.slice(0,5))}</div></div>
          <div><label>Vehicle</label><div>${esc(reservation.plate_no || '-')}</div></div>
        </div>
        <p id="extendMsg" class="muted" style="margin-top:12px;display:none;"></p>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button class="btn btn-danger" style="flex:1;" id="cancelBtn">Cancel</button>
          <button class="btn btn-primary" style="flex:1;" id="extendBtn">Extend Time (+1 hr)</button>
        </div>`;
      document.getElementById('cancelBtn').addEventListener('click', async () => {
        if (!confirm('Cancel this reservation?')) return;
        await api(`/api/reservations/${reservation.id}/cancel`, { method: 'POST' });
        location.reload();
      });
      document.getElementById('extendBtn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const msg = document.getElementById('extendMsg');
        btn.disabled = true;
        msg.style.display = 'none';
        try {
          const { reservation: updated } = await api(`/api/reservations/${reservation.id}/extend`, {
            method: 'POST',
            body: JSON.stringify({ extra_minutes: 60 })
          });
          document.getElementById('resTimeLabel').textContent =
            `${updated.start_time.slice(0,5)} - ${updated.end_time.slice(0,5)}`;
          msg.textContent = 'Extended by 1 hour.';
          msg.style.color = 'var(--green)';
          msg.style.display = 'block';
        } catch (err) {
          msg.textContent = err.message;
          msg.style.color = '#b91c1c';
          msg.style.display = 'block';
        } finally {
          btn.disabled = false;
        }
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
