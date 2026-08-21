let lots = [];
let currentLotId = null;
let currentSlots = [];
let selectedSlotId = null;

async function loadLots() {
  const { lots: l } = await api('/api/lots');
  lots = l;
  const tabs = document.getElementById('lotTabs');
  tabs.innerHTML = lots.map((lot, i) => `<div class="lot-tab ${i === 0 ? 'active' : ''}" data-id="${lot.id}">${esc(lot.name)}</div>`).join('');
  tabs.querySelectorAll('.lot-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.lot-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedSlotId = null;
      loadSlots(tab.dataset.id);
    });
  });
  if (lots[0]) loadSlots(lots[0].id);
}

async function loadSlots(lotId) {
  currentLotId = lotId;
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '<p class="muted">Loading...</p>';
  const { slots } = await api(`/api/admin/slots/${lotId}`);
  currentSlots = slots;
  grid.innerHTML = slots.map(s => `<div class="slot-mini ${s.status} ${String(s.id) === String(selectedSlotId) ? 'picked' : ''}" data-id="${s.id}">${esc(s.slot_number)}<br/><span style="font-size:11px;font-weight:400;text-transform:capitalize;">${esc(s.status)}</span></div>`).join('');
  grid.querySelectorAll('.slot-mini').forEach(el => {
    el.addEventListener('click', () => {
      grid.querySelectorAll('.slot-mini').forEach(s => s.classList.remove('picked'));
      el.classList.add('picked');
      selectedSlotId = el.dataset.id;
      showDetail(currentSlots.find(s => String(s.id) === el.dataset.id));
    });
  });

  // If the slot currently shown in the detail panel is one of the ones we
  // just refreshed, re-render its detail too -- otherwise the panel keeps
  // showing stale buttons (e.g. still "Log Entry") after an action that
  // changed that same slot's state, until the admin clicks it again.
  if (selectedSlotId) {
    const updated = currentSlots.find(s => String(s.id) === String(selectedSlotId));
    if (updated) showDetail(updated);
  }
}

function showDetail(slot) {
  document.getElementById('detailTitle').textContent = `Slot ${slot.slot_number} Details`;
  const body = document.getElementById('detailBody');
  let occupant = '<p class="muted">No active occupant.</p>';
  if (slot.occupant_name) {
    occupant = `
      <p><strong>${esc(slot.occupant_name)}</strong><br/><span class="muted">${esc(slot.applicant_type || '')}</span></p>
      <p>License Plate: <strong>${esc(slot.plate_no || '-')}</strong><br/>
      Make/Model: ${esc(slot.make || '')} ${esc(slot.model || '')}<br/>
      Color: ${esc(slot.color || '-')}</p>
      <p>Time Window: ${esc((slot.start_time||'').slice(0,5))} - ${esc((slot.end_time||'').slice(0,5))}, ${esc(slot.reservation_date ? slot.reservation_date.slice(0,10) : '')}</p>`;
  }

  // Gate actions only make sense for reserved (about to arrive) or occupied
  // (about to leave) slots - this simulates the physical entry/exit gate.
  let gateActions = '';
  if (slot.status === 'reserved') {
    gateActions = `<button class="btn btn-primary" data-gate="entry">Log Entry (Vehicle Arrived)</button>`;
  } else if (slot.status === 'occupied') {
    gateActions = `<button class="btn btn-primary" data-gate="exit">Log Exit (Vehicle Left)</button>`;
  }

  // "Mark Available" only means anything when the slot is actually blocked
  // for maintenance -- it can't clear an active booking (that's what
  // "Block for Maintenance" does, deliberately, with a warning below).
  // Offering it against a reserved/occupied slot would look like it does
  // something it doesn't.
  let statusAction;
  if (slot.status === 'maintenance') {
    statusAction = `<button class="btn" data-set-status="available">Mark Available</button>`;
  } else {
    statusAction = `<button class="btn" data-set-status="maintenance">Block for Maintenance</button>`;
  }

  body.innerHTML = `
    <span class="badge badge-${slot.status}">${esc(slot.status)}</span>
    <div style="margin:16px 0;">${occupant}</div>
    <div style="display:flex;flex-direction:column;gap:8px;" data-slot-id="${slot.id}" data-slot-status="${slot.status}">
      ${gateActions}
      ${statusAction}
    </div>`;
}

async function logGate(slotId, action) {
  const verb = action === 'entry' ? 'log this vehicle as arrived (entry)' : 'log this vehicle as departed (exit)';
  if (!confirm(`Are you sure you want to ${verb} for this slot?`)) return;
  try {
    await api(`/api/admin/slots/${slotId}/${action}`, { method: 'POST' });
    loadSlots(currentLotId);
  } catch (e) {
    alert(e.message);
  }
}

async function setStatus(slotId, status, currentSlotStatus) {
  // Blocking a slot that currently has an active reservation cancels that
  // reservation server-side -- warn the admin before doing something a
  // student would otherwise discover the hard way.
  if (status === 'maintenance' && (currentSlotStatus === 'reserved' || currentSlotStatus === 'occupied')) {
    if (!confirm('This slot has an active reservation. Blocking it for maintenance will cancel that booking. Continue?')) {
      return;
    }
  }
  try {
    await api(`/api/admin/slots/${slotId}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    loadSlots(currentLotId);
  } catch (e) {
    alert(e.message);
  }
}

// The detail panel's action buttons (gate log / status change) are
// re-rendered on every showDetail() call, so this listener is delegated on
// the stable #detailBody container instead - data attributes replace the
// inline onclick handlers CSP blocks.
document.getElementById('detailBody').addEventListener('click', (e) => {
  const container = e.target.closest('[data-slot-id]');
  if (!container) return;
  const slotId = Number(container.dataset.slotId);

  const gateBtn = e.target.closest('[data-gate]');
  if (gateBtn) return logGate(slotId, gateBtn.dataset.gate);

  const statusBtn = e.target.closest('[data-set-status]');
  if (statusBtn) return setStatus(slotId, statusBtn.dataset.setStatus, container.dataset.slotStatus);
});

(async function () {
  const user = await requireAuth('admin');
  if (!user) return;
  loadLots();
})();
