let lots = [];
let currentLotId = null;
let selectedSlotId = null;

async function loadLots() {
  const { lots: l } = await api('/api/lots');
  lots = l;
  const tabs = document.getElementById('lotTabs');
  tabs.innerHTML = lots.map((lot, i) =>
    `<div class="lot-tab ${i === 0 ? 'active' : ''}" data-id="${lot.id}">${esc(lot.name)}</div>`
  ).join('');
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
  selectedSlotId = null;
  updateSummary();
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '<p class="muted">Loading slots…</p>';
  const { slots } = await api(`/api/lots/${lotId}/slots`);
  grid.innerHTML = slots.map(s => {
    const cls = s.status === 'available' ? 'available' : s.status;
    return `<div class="slot ${cls}" data-id="${s.id}" data-number="${esc(s.slot_number)}">${esc(s.slot_number)}</div>`;
  }).join('');
  grid.querySelectorAll('.slot.available').forEach(el => {
    el.addEventListener('click', () => {
      grid.querySelectorAll('.slot').forEach(s => s.classList.remove('selected'));
      el.classList.add('selected');
      selectedSlotId = el.dataset.id;
      updateSummary(el.dataset.number);
    });
  });
}

function updateSummary(number) {
  document.getElementById('selectedSlotLabel').textContent = number || 'None';
  document.getElementById('reserveBtn').disabled = !selectedSlotId;
}

async function loadVehicles() {
  const { vehicles } = await api('/api/vehicles');
  const sel = document.getElementById('vehicle_id');
  if (vehicles.length) {
    sel.innerHTML = vehicles.map(v => `<option value="${v.id}">${esc(v.plate_no)} — ${esc(v.make || '')} ${esc(v.model || '')}</option>`).join('');
  }
}

document.getElementById('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('bookError');
  const okEl = document.getElementById('bookSuccess');
  errEl.style.display = 'none';
  okEl.style.display = 'none';
  const btn = document.getElementById('reserveBtn');
  btn.disabled = true;
  try {
    await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({
        slot_id: selectedSlotId,
        vehicle_id: document.getElementById('vehicle_id').value || null,
        reservation_date: document.getElementById('reservation_date').value,
        start_time: document.getElementById('start_time').value,
        end_time: document.getElementById('end_time').value
      })
    });
    okEl.textContent = 'Slot reserved! Redirecting to your dashboard…';
    okEl.style.display = 'block';
    setTimeout(() => (window.location.href = '/dashboard.html'), 1200);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    if (currentLotId) loadSlots(currentLotId); // refresh in case slot was taken
  }
});

(async function () {
  const user = await requireAuth('user');
  if (!user) return;
  document.getElementById('reservation_date').min = new Date().toISOString().slice(0, 10);
  document.getElementById('reservation_date').value = new Date().toISOString().slice(0, 10);
  await loadLots();
  await loadVehicles();
})();
