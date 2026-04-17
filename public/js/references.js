/* References page — CRUD without page reload */

const API = {
  location:     '/references/api/locations',
  manufacturer: '/references/api/manufacturers',
  supplier:     '/references/api/suppliers',
  itemtype:     '/references/api/item-types',
};

const feedback = document.getElementById('feedback');

function showFeedback(msg, isError = false) {
  feedback.textContent = msg;
  feedback.classList.toggle('is-error', isError);
  feedback.hidden = false;
  clearTimeout(feedback._timer);
  feedback._timer = setTimeout(() => { feedback.hidden = true; }, 3000);
}

async function apiFetch(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

// ── Add forms ────────────────────────────────────────────

document.querySelectorAll('[data-open-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.openAdd;
    document.getElementById(`add-${key}`).hidden = false;
    btn.hidden = true;
  });
});

document.querySelectorAll('[data-cancel-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.cancelAdd;
    document.getElementById(`add-${key}`).hidden = true;
    document.querySelector(`[data-open-add="${key}"]`).hidden = false;
  });
});

// ── Save new location ─────────────────────────────────────

document.querySelector('[data-save-add="location"]').addEventListener('click', async () => {
  const nameRu = document.getElementById('loc-nameRu').value.trim();
  const nameEn = document.getElementById('loc-nameEn').value.trim();
  if (!nameRu || !nameEn) return showFeedback('Заполните оба поля', true);

  try {
    const loc = await apiFetch(API.location, 'POST', { nameRu, nameEn });
    addRow('locations-list', buildLocationRow(loc));
    document.getElementById('loc-nameRu').value = '';
    document.getElementById('loc-nameEn').value = '';
    document.getElementById('add-location').hidden = true;
    document.querySelector('[data-open-add="location"]').hidden = false;
    showFeedback('Добавлено');
  } catch (e) { showFeedback(e.message, true); }
});

// ── Save new manufacturer ─────────────────────────────────

document.querySelector('[data-save-add="manufacturer"]').addEventListener('click', async () => {
  const name = document.getElementById('mfr-name').value.trim();
  if (!name) return showFeedback('Введите название', true);

  try {
    const mfr = await apiFetch(API.manufacturer, 'POST', { name });
    addRow('manufacturers-list', buildManufacturerRow(mfr));
    document.getElementById('mfr-name').value = '';
    document.getElementById('add-manufacturer').hidden = true;
    document.querySelector('[data-open-add="manufacturer"]').hidden = false;
    showFeedback('Добавлено');
  } catch (e) { showFeedback(e.message, true); }
});

// ── Save new supplier ─────────────────────────────────────

document.querySelector('[data-save-add="supplier"]').addEventListener('click', async () => {
  const name = document.getElementById('sup-name').value.trim();
  if (!name) return showFeedback('Введите название', true);

  try {
    const sup = await apiFetch(API.supplier, 'POST', { name });
    addRow('suppliers-list', buildSupplierRow(sup));
    document.getElementById('sup-name').value = '';
    document.getElementById('add-supplier').hidden = true;
    document.querySelector('[data-open-add="supplier"]').hidden = false;
    showFeedback('Добавлено');
  } catch (e) { showFeedback(e.message, true); }
});

// ── Save new item type ────────────────────────────────────

document.querySelector('[data-save-add="itemtype"]').addEventListener('click', async () => {
  const nameRu   = document.getElementById('itype-nameRu').value.trim();
  const nameEn   = document.getElementById('itype-nameEn').value.trim();
  const category = document.getElementById('itype-category').value;
  if (!nameRu || !nameEn) return showFeedback('Заполните оба поля', true);

  try {
    const it = await apiFetch(API.itemtype, 'POST', { nameRu, nameEn, category });
    addRow('item-types-list', buildItemTypeRow(it));
    document.getElementById('itype-nameRu').value = '';
    document.getElementById('itype-nameEn').value = '';
    document.getElementById('add-itemtype').hidden = true;
    document.querySelector('[data-open-add="itemtype"]').hidden = false;
    showFeedback('Добавлено');
  } catch (e) { showFeedback(e.message, true); }
});

// ── Row edit / delete (event delegation) ─────────────────

document.querySelectorAll('.ref-list').forEach((list) => {
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-edit],[data-delete],[data-cancel-edit],[data-save-edit]');
    if (!btn) return;

    const row  = btn.closest('.ref-row');
    const view = row.querySelector('.ref-row-view');
    const edit = row.querySelector('.ref-row-edit');
    const id   = row.dataset.id;
    const type = row.dataset.type;

    if (btn.dataset.edit !== undefined) {
      view.hidden = true; edit.hidden = false;
    }

    if (btn.dataset.cancelEdit !== undefined) {
      view.hidden = false; edit.hidden = true;
    }

    if (btn.dataset.saveEdit !== undefined) {
      try {
        let body, displayName;
        if (type === 'manufacturer' || type === 'supplier') {
          body = { name: edit.querySelector('.edit-name').value.trim() };
          displayName = body.name;
        } else if (type === 'itemtype') {
          body = {
            nameRu:   edit.querySelector('.edit-nameRu').value.trim(),
            nameEn:   edit.querySelector('.edit-nameEn').value.trim(),
            category: edit.querySelector('.edit-category').value,
          };
          displayName = body.nameRu;
        } else {
          body = {
            nameRu: edit.querySelector('.edit-nameRu').value.trim(),
            nameEn: edit.querySelector('.edit-nameEn').value.trim(),
          };
          displayName = body.nameRu;
        }

        await apiFetch(`${API[type]}/${id}`, 'PUT', body);
        view.querySelector('.ref-name').textContent = displayName;
        if (body.nameEn) view.querySelector('.ref-name-alt').textContent = body.nameEn;
        view.hidden = false; edit.hidden = true;
        showFeedback('Сохранено');
      } catch (e) { showFeedback(e.message, true); }
    }

    if (btn.dataset.delete !== undefined) {
      if (!confirm('Удалить запись?')) return;
      try {
        await apiFetch(`${API[type]}/${id}`, 'DELETE');
        row.remove();
        showFeedback('Удалено');
      } catch (e) { showFeedback(e.message, true); }
    }
  });
});

// ── Helpers ───────────────────────────────────────────────

function addRow(listId, html) {
  const list = document.getElementById(listId);
  const empty = list.querySelector('.empty-text');
  if (empty) empty.remove();
  list.insertAdjacentHTML('beforeend', html);
}

function editIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
}

function deleteIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
}

function buildLocationRow(loc) {
  return `<div class="ref-row" data-id="${loc.id}" data-type="location">
    <div class="ref-row-view">
      <span class="ref-name">${loc.nameRu}</span>
      <span class="ref-name-alt">${loc.nameEn}</span>
      <div class="ref-actions">
        <button type="button" class="med-action" data-edit>${editIcon()}</button>
        <button type="button" class="med-action danger" data-delete>${deleteIcon()}</button>
      </div>
    </div>
    <div class="ref-row-edit" hidden>
      <input type="text" class="edit-nameRu" value="${loc.nameRu}">
      <input type="text" class="edit-nameEn" value="${loc.nameEn}">
      <div class="ref-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cancel-edit>Отмена</button>
        <button type="button" class="btn btn-primary btn-sm" data-save-edit>Сохранить</button>
      </div>
    </div>
  </div>`;
}

function buildSupplierRow(sup) {
  return `<div class="ref-row" data-id="${sup.id}" data-type="supplier">
    <div class="ref-row-view">
      <span class="ref-name">${sup.name}</span>
      <div class="ref-actions">
        <button type="button" class="med-action" data-edit>${editIcon()}</button>
        <button type="button" class="med-action danger" data-delete>${deleteIcon()}</button>
      </div>
    </div>
    <div class="ref-row-edit" hidden>
      <input type="text" class="edit-name" value="${sup.name}">
      <div class="ref-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cancel-edit>Отмена</button>
        <button type="button" class="btn btn-primary btn-sm" data-save-edit>Сохранить</button>
      </div>
    </div>
  </div>`;
}

function buildManufacturerRow(mfr) {
  return `<div class="ref-row" data-id="${mfr.id}" data-type="manufacturer">
    <div class="ref-row-view">
      <span class="ref-name">${mfr.name}</span>
      <div class="ref-actions">
        <button type="button" class="med-action" data-edit>${editIcon()}</button>
        <button type="button" class="med-action danger" data-delete>${deleteIcon()}</button>
      </div>
    </div>
    <div class="ref-row-edit" hidden>
      <input type="text" class="edit-name" value="${mfr.name}">
      <div class="ref-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cancel-edit>Отмена</button>
        <button type="button" class="btn btn-primary btn-sm" data-save-edit>Сохранить</button>
      </div>
    </div>
  </div>`;
}

function buildItemTypeRow(it) {
  const catLabel = it.category === 'glassware' ? 'Посуда' : 'Расходник';
  return `<div class="ref-row" data-id="${it.id}" data-type="itemtype">
    <div class="ref-row-view">
      <span class="ref-name">${it.nameRu}</span>
      <span class="ref-name-alt">${it.nameEn}</span>
      <span class="ref-badge">${catLabel}</span>
      <div class="ref-actions">
        <button type="button" class="med-action" data-edit>${editIcon()}</button>
        <button type="button" class="med-action danger" data-delete>${deleteIcon()}</button>
      </div>
    </div>
    <div class="ref-row-edit" hidden>
      <input type="text" class="edit-nameRu" value="${it.nameRu}">
      <input type="text" class="edit-nameEn" value="${it.nameEn}">
      <select class="edit-category">
        <option value="consumable" ${it.category === 'consumable' ? 'selected' : ''}>Расходник</option>
        <option value="glassware"  ${it.category === 'glassware'  ? 'selected' : ''}>Посуда</option>
      </select>
      <div class="ref-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cancel-edit>Отмена</button>
        <button type="button" class="btn btn-primary btn-sm" data-save-edit>Сохранить</button>
      </div>
    </div>
  </div>`;
}
