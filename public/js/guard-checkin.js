let allReservations = [];
let scannerStream = null;
let scannerRunning = false;
let nfcAbortController = null;

function stopScanner() {
  scannerRunning = false;
  if (scannerStream) scannerStream.getTracks().forEach(track => track.stop());
  scannerStream = null;
  const video = document.getElementById('qrVideo');
  video.pause();
  video.srcObject = null;
  video.hidden = true;
  document.getElementById('startScanner').disabled = false;
}

async function scanQrCode() {
  const status = document.getElementById('scannerStatus');
  const video = document.getElementById('qrVideo');
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'Camera access requires a secure connection. Enter the token below.';
    return;
  }

  document.getElementById('startScanner').disabled = true;
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = scannerStream;
    video.hidden = false;
    await video.play();
    scannerRunning = true;
    if (!('BarcodeDetector' in window)) {
      status.textContent = 'Camera preview is active. QR scanning is not supported in this browser; enter the token below.';
      return;
    }

    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    status.textContent = 'Point the camera at a permit QR code.';

    const scanFrame = async () => {
      if (!scannerRunning) return;
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue) {
          document.getElementById('permitToken').value = codes[0].rawValue;
          stopScanner();
          document.getElementById('verifyForm').requestSubmit();
          return;
        }
      } catch (_) {
        status.textContent = 'Unable to read that QR code. Try holding it steady.';
      }
      requestAnimationFrame(scanFrame);
    };
    requestAnimationFrame(scanFrame);
  } catch (err) {
    stopScanner();
    status.textContent = err.name === 'NotAllowedError'
      ? 'Camera access was denied. Enter the token below instead.'
      : 'Could not start the camera. Enter the token below instead.';
  }
}

document.getElementById('startScanner').addEventListener('click', scanQrCode);

document.getElementById('verifyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = document.getElementById('verifyResult');
  const token = document.getElementById('permitToken').value.trim();
  result.innerHTML = '<p class="muted">Checking permit...</p>';
  try {
    const { permit } = await api(`/api/applications/verify/${encodeURIComponent(token)}`);
    result.innerHTML = `<div class="alert alert-info verify-alert">
      <strong>Valid digital sticker</strong>
      <span class="verify-line">${esc(permit.permit_number)} · ${esc(permit.owner_name)} · ${esc(permit.plate_no || 'No plate')}</span>
      <span class="muted verify-line">${esc([permit.make, permit.model, permit.color].filter(Boolean).join(' '))}</span>
    </div>`;
  } catch (err) {
    result.innerHTML = `<div class="alert alert-warning verify-alert">
      <strong>Invalid digital sticker</strong>
      <span class="verify-line">${esc(err.message)}</span>
    </div>`;
  }
});

function decodeNfcRecord(record) {
  if (!record?.data) return '';
  try {
    const bytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
    if (record.recordType === 'text' && bytes.length) {
      const languageLength = bytes[0] & 0x3f;
      return new TextDecoder().decode(bytes.slice(1 + languageLength)).trim();
    }
    return new TextDecoder().decode(bytes).replace(/^\u0000/, '').trim();
  } catch (_) {
    return '';
  }
}

function extractMapuaId(value) {
  const text = String(value || '').trim();
  const labeled = text.match(/(?:mapua\s*)?(?:id|student\s*id)\s*[:#-]?\s*([A-Za-z0-9-]{4,20})/i);
  if (labeled) return labeled[1];
  return /^[A-Za-z0-9-]{4,20}$/.test(text) ? text : '';
}

async function lookupMapuaId(id) {
  const result = document.getElementById('idLookupResult');
  const status = document.getElementById('nfcStatus');
  result.innerHTML = '<p class="muted">Reading student record...</p>';
  try {
    const data = await api(`/api/admin/guard/id/${encodeURIComponent(id)}`);
    const student = data.student;
    const statusLabel = student.student_status === 'graduate_student' ? 'Graduate student' :
      student.student_status === 'current_student' ? 'Currently enrolled' : 'Employee';
    const penalty = student.late_arrival_penalty_until
      ? `<span class="badge badge-cancelled">Parking suspended until ${esc(new Date(student.late_arrival_penalty_until).toLocaleString())}</span>`
      : '';
    const reservations = data.reservations.length
      ? data.reservations.map((reservation) => `<li>${esc(reservation.ticket_number)} · ${esc(reservation.lot_name)} ${esc(reservation.slot_number)} · ${esc((reservation.start_time || '').slice(0, 5))}-${esc((reservation.end_time || '').slice(0, 5))} · ${esc(reservation.status)}</li>`).join('')
      : '<li>No reservation for today.</li>';
    const vehicles = data.vehicles.length
      ? data.vehicles.map((vehicle) => `<li>${esc([vehicle.plate_no, vehicle.make, vehicle.model].filter(Boolean).join(' '))} ${vehicle.has_approved_sticker ? '<span class="badge badge-approved">Sticker approved</span>' : '<span class="badge badge-cancelled">No approved sticker</span>'}</li>`).join('')
      : '<li>No vehicles registered.</li>';
    result.innerHTML = `<div class="alert alert-info verify-alert">
      <strong>${esc(student.full_name)} · ${esc(student.id_number)}</strong>
      <span class="verify-line">${esc(statusLabel)}${student.program ? ` · ${esc(student.program)}` : ''}</span>
      ${penalty}
      <span class="verify-line"><strong>Today’s reservations</strong></span><ul>${reservations}</ul>
      <span class="verify-line"><strong>Registered vehicles</strong></span><ul>${vehicles}</ul>
    </div>`;
    status.textContent = `ID ${student.id_number} recognized.`;
  } catch (err) {
    result.innerHTML = `<div class="alert alert-warning verify-alert"><strong>ID not recognized</strong><span class="verify-line">${esc(err.message)}</span></div>`;
    status.textContent = 'Scan another card or enter the ID manually.';
  }
}

async function startNfcScan() {
  const status = document.getElementById('nfcStatus');
  const button = document.getElementById('startNfcScan');
  if (!window.isSecureContext || !('NDEFReader' in window)) {
    status.textContent = 'Web NFC is unavailable here. Use HTTPS on a supported Android browser or enter the ID manually.';
    return;
  }

  nfcAbortController?.abort();
  nfcAbortController = new AbortController();
  button.disabled = true;
  try {
    const reader = new NDEFReader();
    reader.onreadingerror = () => {
      status.textContent = 'The NFC card could not be read. Hold it near the reader and try again.';
    };
    reader.onreading = async ({ message }) => {
      const values = Array.from(message.records || []).map(decodeNfcRecord);
      const id = values.map(extractMapuaId).find(Boolean);
      if (!id) {
        status.textContent = 'Card detected, but it does not contain a readable Mapúa ID number.';
        return;
      }
      document.getElementById('mapuaId').value = id;
      await lookupMapuaId(id);
      nfcAbortController.abort();
      button.disabled = false;
      status.textContent = `NFC scan complete for ${id}.`;
    };
    await reader.scan({ signal: nfcAbortController.signal });
    status.textContent = 'NFC reader ready. Hold the Mapúa ID near the device.';
  } catch (err) {
    button.disabled = false;
    status.textContent = err.name === 'NotAllowedError'
      ? 'NFC permission was denied. Enter the ID manually.'
      : 'Could not start NFC. Use a supported HTTPS device or enter the ID manually.';
  }
}

document.getElementById('startNfcScan').addEventListener('click', startNfcScan);
document.getElementById('idLookupForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = extractMapuaId(document.getElementById('mapuaId').value);
  if (id) lookupMapuaId(id);
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
    await load();
  } catch (err) {
    alert(err.message);
  }
});

(async function () {
  const user = await requireAuth();
  if (!user) return;
  if (!['guard', 'admin'].includes(user.role)) {
    window.location.href = homeFor(user.role || 'user');
    return;
  }
  document.getElementById('currentGuardName').textContent = user.full_name;
  document.getElementById('currentGuardId').textContent = user.role === 'admin'
    ? 'Admin access'
    : `Guard ID: ${user.id_number}`;
  load().catch((error) => alert(error.message));
  setInterval(() => {
    if (document.visibilityState === 'visible') load().catch(() => {});
  }, 15000);
})();
