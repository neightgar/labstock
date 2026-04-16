/**
 * Protocol form: Quill rich-text editor + materials block
 * Loaded only on protocols/form.ejs via extraScripts.
 * Depends on Quill 1.3.x loaded via CDN before this script.
 */
(function () {
  'use strict';

  // ── Quill setup ────────────────────────────────────────

  var TOOLBAR = [
    [{ header: [2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean'],
  ];

  var quillRu = new Quill('#editor-ru', {
    theme:   'snow',
    modules: { toolbar: TOOLBAR },
    placeholder: 'Содержание протокола (RU)…',
  });

  var quillEn = new Quill('#editor-en', {
    theme:   'snow',
    modules: { toolbar: TOOLBAR },
    placeholder: 'Protocol content (EN)…',
  });

  // Load existing HTML content into editors
  var initRu = document.getElementById('init-content-ru');
  var initEn = document.getElementById('init-content-en');
  if (initRu && initRu.textContent.trim()) {
    quillRu.clipboard.dangerouslyPasteHTML(initRu.textContent.trim());
  }
  if (initEn && initEn.textContent.trim()) {
    quillEn.clipboard.dangerouslyPasteHTML(initEn.textContent.trim());
  }

  // Tab switching
  document.querySelectorAll('.editor-tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.tab;
      document.querySelectorAll('.editor-tab-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tab === target);
      });
      document.querySelectorAll('.editor-pane').forEach(function (p) {
        p.style.display = p.dataset.pane === target ? '' : 'none';
      });
    });
  });

  // Before submit — copy Quill HTML into hidden inputs
  var form = document.getElementById('protocol-form');
  if (form) {
    form.addEventListener('submit', function () {
      document.getElementById('input-content-ru').value = quillRu.root.innerHTML;
      document.getElementById('input-content-en').value = quillEn.root.innerHTML;
      document.getElementById('input-items-json').value = JSON.stringify(materialItems);
    });
  }

  // ── Materials block ────────────────────────────────────

  var materialItems = [];
  try {
    var initItemsEl = document.getElementById('init-items-json');
    if (initItemsEl) materialItems = JSON.parse(initItemsEl.textContent) || [];
  } catch (_) {}

  var searchInput   = document.getElementById('mat-search');
  var searchType    = document.getElementById('mat-type');
  var searchResults = document.getElementById('mat-results');
  var materialsList = document.getElementById('materials-list');

  function typeLabel(type) {
    var labels = { reagent: 'Реактив', consumable: 'Расходник', equipment: 'Оборудование' };
    return labels[type] || type;
  }

  function renderMaterials() {
    if (!materialsList) return;
    if (materialItems.length === 0) {
      materialsList.innerHTML = '<p class="empty-text" style="padding:8px 0;margin:0">' +
        (document.documentElement.lang === 'en' ? 'No items added' : 'Нет материалов') + '</p>';
      return;
    }
    materialsList.innerHTML = materialItems.map(function (it, idx) {
      return '<div class="mat-item" data-idx="' + idx + '">' +
        '<span class="mat-badge">' + typeLabel(it.entityType) + '</span>' +
        '<span class="mat-name">' + escHtml(it.nameRu || it.nameEn || '') + '</span>' +
        '<input class="mat-qty form-input" type="number" step="any" min="0" placeholder="кол-во"' +
          ' value="' + (it.quantityNeeded || '') + '"' +
          ' onchange="window._matUpdate(' + idx + ', \'quantityNeeded\', this.value)">' +
        '<input class="mat-unit form-input" type="text" placeholder="ед."' +
          ' value="' + escHtml(it.unit || '') + '"' +
          ' onchange="window._matUpdate(' + idx + ', \'unit\', this.value)">' +
        '<button type="button" class="btn btn-ghost btn-sm" onclick="window._matRemove(' + idx + ')">✕</button>' +
        '</div>';
    }).join('');
  }

  window._matUpdate = function (idx, field, value) {
    if (materialItems[idx]) materialItems[idx][field] = value;
  };
  window._matRemove = function (idx) {
    materialItems.splice(idx, 1);
    renderMaterials();
  };

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Search with debounce
  var searchTimer;
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = searchInput.value.trim();
      if (q.length < 2) { searchResults.innerHTML = ''; return; }
      searchTimer = setTimeout(function () { doSearch(q); }, 300);
    });
  }

  function doSearch(q) {
    var type = searchType ? searchType.value : 'all';
    fetch('/protocols/search-items?q=' + encodeURIComponent(q) + '&type=' + type)
      .then(function (r) { return r.json(); })
      .then(function (rows) { renderSearchResults(rows); })
      .catch(function () { searchResults.innerHTML = ''; });
  }

  function renderSearchResults(rows) {
    if (!rows.length) {
      searchResults.innerHTML = '<div class="mat-result-empty">Ничего не найдено</div>';
      return;
    }
    searchResults.innerHTML = rows.map(function (r) {
      var label = r.nameRu + (r.nameEn && r.nameEn !== r.nameRu ? ' / ' + r.nameEn : '');
      var meta  = r.entityType === 'equipment'
        ? '(' + r.status + ')'
        : '(' + (r.quantity || 0) + ' ' + (r.unit || '') + ')';
      return '<div class="mat-result-item" data-id="' + r.id + '" data-type="' + r.entityType + '"' +
        ' data-name-ru="' + escHtml(r.nameRu || '') + '" data-name-en="' + escHtml(r.nameEn || '') + '"' +
        ' data-unit="' + escHtml(r.unit || '') + '">' +
        '<span class="mat-badge">' + typeLabel(r.entityType) + '</span> ' +
        escHtml(label) + ' <span style="color:var(--text-muted);font-size:0.8rem">' + meta + '</span>' +
        '</div>';
    }).join('');

    searchResults.querySelectorAll('.mat-result-item').forEach(function (el) {
      el.addEventListener('click', function () {
        materialItems.push({
          entityType:    el.dataset.type,
          entityId:      parseInt(el.dataset.id),
          nameRu:        el.dataset.nameRu,
          nameEn:        el.dataset.nameEn,
          unit:          el.dataset.unit || '',
          quantityNeeded: '',
          notes:         '',
        });
        searchResults.innerHTML = '';
        if (searchInput) searchInput.value = '';
        renderMaterials();
      });
    });
  }

  // Initial render
  renderMaterials();
}());
