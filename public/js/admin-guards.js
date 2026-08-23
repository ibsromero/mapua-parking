async function loadGuards() {
  const rowsEl = document.getElementById('guardRows');
  const { guards } = await api('/api/admin/guards');
  if (!guards.length) {
    rowsEl.innerHTML = '<tr><td colspan="3" class="muted">No guard accounts yet.</td></tr>';
    return;
  }
  rowsEl.innerHTML = guards.map(g => `
    <tr>
      <td>${esc(g.full_name)}</td>
      <td>${esc(g.id_number)}</td>
      <td>${new Date(g.created_at).toLocaleDateString()}</td>
    </tr>`).join('');
}

document.getElementById('addGuardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('addGuardError');
  const btn = document.getElementById('addGuardBtn');
  errEl.style.display = 'none';
  btn.disabled = true;
  try {
    await api('/api/admin/guards', {
      method: 'POST',
      body: JSON.stringify({
        full_name: document.getElementById('full_name').value.trim(),
        id_number: document.getElementById('id_number').value.trim(),
        password: document.getElementById('password').value
      })
    });
    document.getElementById('addGuardForm').reset();
    loadGuards();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

(async function () {
  const user = await requireAuth('admin');
  if (!user) return;
  loadGuards();
})();
