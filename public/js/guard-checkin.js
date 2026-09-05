let allReservations = [];

document.getElementById('verifyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = document.getElementById('verifyResult');
  const token = document.getElementById('permitToken').value.trim();
  result.innerHTML = '<p class="muted">Checking permit...</p>';
  try {
    const { permit } = await api(`/api/applications/verify/${encodeURIComponent(token)}`);
    result.innerHTML = `<div class="alert alert-info"><strong>Valid digital sticker</strong><br/>
      ${esc(permit.permit_number)} · ${esc(permit.owner_name)} · ${esc(permit.plate_no || 'No plate')}<br/>
      <span class="muted">${esc([permit.make, permit.model, permit.color].filter(Boolean).join(' '))}</span></div>`;
  } catch (err) {
    result.innerHTML = `<div class="alert alert-warning"><strong>Invalid digital sticker</strong><br/>${esc(err.message)}</div>`;
  }
});

function badgeClass(status) {
  return { ongoing: 'badge-ongoing', completed: 'badge-completed', cancelled: 'badge-cancelled', forfeited: 'badge-cancelled' }[status] || 'badge-ongoing';
}

function arrivalLabel(status) {
  if (!status) return '-';
  return { early: 'Early', on_time: 'On time', late: 'Late' }[status] || status;
}

function renderRows(list) {
  const rowsEl = document.getElementById('rows');
  if (!list.length) {
    rowsEl.innerHTML = '<tr><td colspan="8" class="muted">No reservations for today.</td></tr>';
    return;
  }
  rowsEl.innerHTML = list.map(r => {
    let actions = '<span class="muted" style="font-size:12px;">Closed</span>';
    if (r.status === 'ongoing' && !r.checked_in_at) {
      actions = `<button class="btn btn-primary" style="padding:6px 10px;font-size:12px;" data-action="entry" data-id="${r.id}">Log Entry</button>`;
    } else if (r.status === 'ongoing' && r.checked_in_at) {
      actions = `<button class="btn btn-primary" style="padding:6px 10px;font-size:12px;" data-action="exit" data-id="${r.id}">Log Exit</button>`;
    }
    return `
      <tr>
        <td><code>${esc(r.ticket_number)}</code></td>
        <td>${esc((r.start_time||'').slice(0,5))} - ${esc((r.end_time||'').slice(0,5))}</td>
        <td>${esc(r.lot_name)} ${esc(r.slot_number)}</td>
        <td>${esc(r.student_name)}<br/><span class="muted" style="font-size:12px;">${esc(r.id_number)}</span></td>
        <td>${esc(r.plate_no || '-')}</td>
        <td><span class="badge ${badgeClass(r.status)}">${esc(r.status)}</span></td>
        <td>${esc(arrivalLabel(r.arrival_status))}</td>
        <td>${actions}</td>
      </tr>`;
  }).join('');
}

async function load() {
  const { reservations } = await api('/api/admin/today-reservations');
  allReservations = reservations;
  renderRows(allReservations);
}

document.getElementById('searchBox').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return renderRows(allReservations);
  renderRows(allReservations.filter(r =>
    (r.plate_no || '').toLowerCase().includes(q) ||
    (r.slot_number || '').toLowerCase().includes(q) ||
    (r.ticket_number || '').toLowerCase().includes(q)
  ));
});

document.getElementById('rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const reservation = allReservations.find(r => String(r.id) === btn.dataset.id);
  if (!reservation) return;
  const action = btn.dataset.action;
  const verb = action === 'entry' ? 'log this vehicle as arrived' : 'log this vehicle as departed';
  if (!confirm(`Confirm: ${verb}?\n\nTicket: ${reservation.ticket_number}\nPlate: ${reservation.plate_no || 'N/A'}\nSlot: ${reservation.lot_name} ${reservation.slot_number}`)) return;

  try {
    const result = await api(`/api/admin/slots/${reservation.slot_id}/${action}`, { method: 'POST' });
    if (action === 'entry') {
      alert(`Entry logged. Arrival: ${arrivalLabel(result.arrival_status)}.`);
    } else {
      alert(`Exit logged. Departure: ${result.departure_status === 'early' ? 'Left early' : 'On time'}.`);
    }
    load();
  } catch (err) {
    alert(err.message);
  }
});

(async function () {
  const user = await requireAuth('guard');
  if (!user) return;
  load();
})();
