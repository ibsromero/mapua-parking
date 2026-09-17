(async function () {
  const user = await requireAuth('user');
  if (!user) return;
  document.getElementById('welcome').textContent = `Welcome back, ${user.full_name.split(' ')[0]}`;

  function printSheet(type) {
    document.body.classList.add(`printing-${type}`);
    const cleanup = () => {
      document.body.classList.remove(`printing-${type}`);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  function printPermit(approved) {
    document.getElementById('printPermitSheet').innerHTML = `
      <div class="print-header">
        <div>
          <div class="print-kicker">MAPUA UNIVERSITY</div>
          <h1>Vehicle Parking Sticker</h1>
        </div>
        <span class="print-status">ACTIVE</span>
      </div>
      <div class="permit-print-body">
        <div>
          <p class="print-eyebrow">Permit number</p>
          <div class="print-permit-number">${esc(approved.permit_number)}</div>
          <div class="print-detail-list">
            <div><span>Plate number</span><strong>${esc(approved.plate_no || 'N/A')}</strong></div>
            <div><span>Vehicle</span><strong>${esc([approved.make, approved.model].filter(Boolean).join(' ') || 'N/A')}</strong></div>
            <div><span>Issued</span><strong>${esc(formatPrintDate(approved.permit_issued_at))}</strong></div>
          </div>
        </div>
        <img class="print-qr" src="/api/applications/${approved.id}/qr" alt="QR code for parking permit ${esc(approved.permit_number)}" />
      </div>
      <p class="print-footer">Present this sticker and QR code when entering the Mapua University parking facility.</p>`;
    printSheet('permit');
  }

  function printTicket(reservation, fullName) {
    document.getElementById('printTicketSheet').innerHTML = `
      <div class="print-header">
        <div>
          <div class="print-kicker">MAPUA UNIVERSITY PARKING</div>
          <h1>Parking Ticket</h1>
        </div>
        <span class="print-status">VALID</span>
      </div>
      <div class="ticket-number">${esc(reservation.ticket_number)}</div>
      <div class="ticket-print-grid">
        <div><span>Driver</span><strong>${esc(fullName)}</strong></div>
        <div><span>Vehicle</span><strong>${esc(reservation.plate_no || 'N/A')}</strong></div>
        <div><span>Location</span><strong>${esc(reservation.lot_name)}</strong></div>
        <div><span>Slot</span><strong>${esc(reservation.slot_number)}</strong></div>
        <div><span>Date</span><strong>${esc(formatPrintDate(reservation.reservation_date))}</strong></div>
        <div><span>Time</span><strong>${esc(`${reservation.start_time?.slice(0, 5)} - ${reservation.end_time?.slice(0, 5)}`)}</strong></div>
      </div>
      <p class="print-footer">Keep this ticket available for parking verification. Arrival is required within the grace period.</p>`;
    printSheet('ticket');
  }

  function formatPrintDate(value) {
    if (!value) return 'N/A';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  // Sticker status banner -- reflects the applicant's real application
  // state instead of always nagging regardless of approval.
  try {
    const { applications } = await api('/api/applications/mine');
    const banner = document.getElementById('stickerBanner');
    const hasApproved = applications.some(a => a.status === 'approved');
    const hasPending = applications.some(a => a.status === 'pending');
    // Most recent rejected application (if any) that hasn't since been
    // superseded by a pending/approved one -- so a student who reapplied
    // after a rejection doesn't keep seeing the old rejection notice.
    const rejected = !hasApproved && !hasPending
      ? applications.filter(a => a.status === 'rejected').sort((a, b) => new Date(b.reviewed_at) - new Date(a.reviewed_at))[0]
      : null;

    const approved = applications.find(a => a.status === 'approved' && a.permit_token);
    if (approved) {
      document.getElementById('digitalPermit').innerHTML = `
        <div class="card permit-card">
          <div class="permit-card-content">
            <div>
              <span class="badge badge-completed">● Active digital sticker</span>
              <h2 class="permit-title">Mapúa Parking Permit</h2>
              <p class="muted permit-description">Present this permit and QR code at the parking gate.</p>
              <div class="grid-2">
                <div><label>Permit number</label><div><code>${esc(approved.permit_number)}</code></div></div>
                <div><label>Vehicle</label><div>${esc(approved.plate_no)}${approved.make ? ` · ${esc(approved.make)}` : ''}</div></div>
              </div>
              <button class="btn btn-primary" style="margin-top:18px;" id="printPermit">Print sticker</button>
            </div>
            <img class="permit-qr-preview" src="/api/applications/${approved.id}/qr" alt="QR code for parking permit ${esc(approved.permit_number)}" width="180" height="180" />
          </div>
        </div>`;
      document.getElementById('printPermit').addEventListener('click', () => printPermit(approved));
    }

    if (hasApproved) {
      // Nothing to nag about -- no banner needed.
    } else if (hasPending) {
      banner.innerHTML = `
        <div class="alert alert-info" style="margin:20px 0;">
          <svg class="icon icon-lg alert-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 17H3L12 3Z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <div><strong>Sticker Application Pending</strong><br/>Your vehicle sticker application is awaiting admin review.</div>
        </div>`;
    } else if (rejected) {
      banner.innerHTML = `
        <div class="alert alert-warning" style="margin:20px 0;">
          <svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <div>
            <strong>Sticker Application Rejected</strong><br/>
            ${rejected.rejection_reason ? esc(rejected.rejection_reason) : 'No reason was given.'}
            <a href="/apply.html">Apply again</a>.
          </div>
        </div>`;
    } else {
      banner.innerHTML = `
        <div class="alert alert-warning" style="margin:20px 0;">
          <svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3.5 2.5 18.5A1.5 1.5 0 0 0 3.8 20.5h16.4a1.5 1.5 0 0 0 1.3-2L12 3.5Z"/>
            <path d="M12 9.5v4.8"/>
            <circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none"/>
          </svg>
          <div>
            <strong>Car Sticker Required</strong><br/>
            You need an approved car sticker before you can book a parking slot.
            <a href="/apply.html">Apply for a sticker</a>.
          </div>
        </div>`;
    }
  } catch (e) {
    // Non-critical -- leave the banner area empty rather than blocking the page.
  }

  // Active reservation
  try {
    const { reservation, grace_period_minutes } = await api('/api/reservations/active');
    const box = document.getElementById('activeReservation');
    if (!reservation) {
      box.innerHTML = `<p class="muted">No active reservation. <a href="/reservations.html">Book a slot</a> to get started.</p>`;
    } else {
      const arrived = !!reservation.checked_in_at;
      box.innerHTML = `
        <span class="badge badge-ongoing">● Ongoing</span>
        <div class="grid-2" style="margin-top:16px;">
          <div><label>Ticket #</label><div><code>${esc(reservation.ticket_number)}</code></div></div>
          <div><label>Location</label><div>${esc(reservation.lot_name)}</div></div>
          <div><label>Slot</label><div style="color:var(--maroon);font-weight:700;">#${esc(reservation.slot_number)}</div></div>
          <div><label>Time</label><div id="resTimeLabel">${esc(reservation.start_time?.slice(0,5))} - ${esc(reservation.end_time?.slice(0,5))}</div></div>
          <div><label>Vehicle</label><div>${esc(reservation.plate_no || '-')}</div></div>
        </div>
        ${arrived
          ? `<p class="muted" style="margin-top:12px;">Checked in.</p>`
          : `<div class="alert alert-info" style="margin-top:16px;"><div>If you don't arrive within <strong>${grace_period_minutes} minutes</strong> of your start time, this reservation is automatically forfeited and the slot is released.</div></div>`
        }
        <p id="extendMsg" class="muted" style="margin-top:12px;display:none;"></p>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button class="btn btn-danger" style="flex:1;" id="cancelBtn">Cancel</button>
          <button class="btn btn-primary" style="flex:1;" id="extendBtn">Extend Time (+1 hr)</button>
        </div>`;
      const printTicketButton = document.createElement('button');
      printTicketButton.className = 'btn ticket-print-button';
      printTicketButton.textContent = 'Print ticket';
      printTicketButton.addEventListener('click', () => printTicket(reservation, user.full_name));
      document.getElementById('activeReservation').appendChild(printTicketButton);
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
    const { lots } = await api('/api/reservations/lots');
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

  // Keep the dashboard in sync with gate actions and bookings made in another
  // browser tab without refreshing while the page is hidden.
  setInterval(() => {
    if (document.visibilityState === 'visible') window.location.reload();
  }, 30000);
})();
