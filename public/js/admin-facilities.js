let lots = [];
let currentLotId = null;
let currentSlots = [];

async function loadLots() {
  const { lots: l } = await api('/api/lots');
  lots = l;
  const tabs = document.getElementById('lotTabs');
  tabs.innerHTML = lots.map((lot, i) => `<div class="lot-tab ${i === 0 ? 'active' : ''}" data-id="${lot.id}">${esc(lot.name)}</div>`).join('');
  tabs.querySelectorAll('.lot-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.lot-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadSlots(tab.dataset.id);
    });
  });
  if (lots[0]) loadSlots(lots[0].id);
}

async function loadSlots(lotId) {
  currentLotId = lotId;
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '<p class="muted">Loading…</p>';
  const { slots } = await api(`/api/admin/slots/${lotId}`);
  currentSlots = slots;
  grid.innerHTML = slots.map(s => `<div class="slot-mini ${s.status}" data-id="${s.id}">${esc(s.slot_number)}<br/><span style="font-size:11px;font-weight:400;text-transform:capitalize;">${esc(s.status)}</span></div>`).join('');
  grid.querySelectorAll('.slot-mini').forEach(el => {
    el.addEventListener('click', () => {
      grid.querySelectorAll('.slot-mini').forEach(s => s.classList.remove('picked'));
      el.classList.add('picked');
      showDetail(currentSlots.find(s => String(s.id) === el.dataset.id));
    });
  });
}

function showDetail(slot) {
  document.getElementById('detailTitle').textContent = `Slot ${slot.slot_number} Details`;
  const body = document.getElementById('detailBody');
  let occupant = '<p class="muted">No active occupant.</p>';
  if (slot.occupant_name) {
    occupant = `
      <p><strong>${esc(slot.occupant_name)}</strong><br/><span class="muted">${esc(slot.applicant_type || '')}</span></p>
      <p>License Plate: <strong>${esc(slot.plate_no || '—')}</strong><br/>
      Make/Model: ${esc(slot.make || '')} ${esc(slot.model || '')}<br/>
      Color: ${esc(slot.color || '—')}</p>
      <p>Time Window: ${esc((slot.start_time||'').slice(0,5))} - ${esc((slot.end_time||'').slice(0,5))}, ${esc(slot.reservation_date ? slot.reservation_date.slice(0,10) : '')}</p>`;
  }

  // Gate actions only make sense for reserved (about to arrive) or occupied
  // (about to leave) slots — this simulates the physical entry/exit gate.
  let gateActions = '';
  if (slot.status === 'reserved') {
    gateActions = `<button class="btn btn-primary" onclick="logGate(${slot.id}, 'entry')">Log Entry (Vehicle Arrived)</button>`;
  } else if (slot.status === 'occupied') {
    gateActions = `<button class="btn btn-primary" onclick="logGate(${slot.id}, 'exit')">Log Exit (Vehicle Left)</button>`;
  }

  body.innerHTML = `
    <span class="badge badge-${slot.status}">${esc(slot.status)}</span>
    <div style="margin:16px 0;">${occupant}</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${gateActions}
      <button class="btn" onclick="setStatus(${slot.id}, 'available')">Mark Available</button>
      <button class="btn" onclick="setStatus(${slot.id}, 'maintenance')">Block for Maintenance</button>
    </div>`;
}

async function logGate(slotId, action) {
  try {
    await api(`/api/admin/slots/${slotId}/${action}`, { method: 'POST' });
    loadSlots(currentLotId);
  } catch (e) {
    alert(e.message);
  }
}

async function setStatus(slotId, status) {
  try {
    await api(`/api/admin/slots/${slotId}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    loadSlots(currentLotId);
  } catch (e) {
    alert(e.message);
  }
}

(async function () {
  const user = await requireAuth('admin');
  if (!user) return;
  loadLots();
})();
