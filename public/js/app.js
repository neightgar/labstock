/* ═══════════════════════════════════════════════════════
   MRB-DB Global App JS
   - Toast notifications
   - Custom confirm modal (replaces browser confirm)
   - Responsive sidebar (burger menu)
   - Global search with debounce
   - Sortable table columns (URL params)
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Toast ──────────────────────────────────────────── */
  const toastEl = document.getElementById('app-toast');

  function showToast(msg, type) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'is-visible';
    if (type === 'error')   toastEl.classList.add('toast-error');
    if (type === 'success') toastEl.classList.add('toast-success');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(function () {
      toastEl.classList.remove('is-visible', 'toast-success', 'toast-error');
    }, 3000);
  }

  // Expose globally for order-modal and other inline code
  window.showToast = showToast;

  // Show toast from URL query params (flash messages after redirect)
  (function checkFlashToast() {
    const params = new URLSearchParams(window.location.search);
    const flash  = params.get('_flash');
    const flashErr = params.get('_flashErr');
    if (flash)    showToast(flash, 'success');
    if (flashErr) showToast(flashErr, 'error');
  }());

  /* ── Custom Confirm Modal ───────────────────────────── */
  const confirmModal   = document.getElementById('confirm-modal');
  const confirmYesBtn  = confirmModal && confirmModal.querySelector('#confirm-yes');
  const confirmNoBtn   = confirmModal && confirmModal.querySelector('#confirm-no');
  const confirmMsgEl   = confirmModal && confirmModal.querySelector('#confirm-message');
  let   confirmResolve = null;

  function showConfirm(msg, yesBtnText) {
    if (!confirmModal) {
      // Fallback to browser confirm
      return Promise.resolve(window.confirm(msg));
    }
    return new Promise(function (resolve) {
      if (confirmMsgEl)  confirmMsgEl.textContent  = msg || 'Вы уверены?';
      if (confirmYesBtn && yesBtnText) confirmYesBtn.textContent = yesBtnText;
      confirmResolve = resolve;
      confirmModal.classList.add('is-open');
      if (confirmNoBtn) confirmNoBtn.focus();
    });
  }

  if (confirmYesBtn) {
    confirmYesBtn.addEventListener('click', function () {
      confirmModal.classList.remove('is-open');
      if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
    });
  }

  function closeConfirm() {
    if (confirmModal) confirmModal.classList.remove('is-open');
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  }

  if (confirmNoBtn)  confirmNoBtn.addEventListener('click', closeConfirm);
  if (confirmModal)  confirmModal.addEventListener('click', function (e) {
    if (e.target === confirmModal) closeConfirm();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && confirmModal && confirmModal.classList.contains('is-open')) {
      closeConfirm();
    }
  });

  window.showConfirm = showConfirm;

  // Intercept all forms that use onsubmit with confirm()
  (function patchConfirmForms() {
    document.querySelectorAll('form[onsubmit*="confirm"]').forEach(function (form) {
      // Extract the message from the onsubmit attribute
      var attr = form.getAttribute('onsubmit') || '';
      var match = attr.match(/confirm\(['"](.+?)['"]\)/);
      var msg = match ? match[1] : null;

      form.removeAttribute('onsubmit');

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var targetForm = form;
        showConfirm(msg).then(function (confirmed) {
          if (confirmed) {
            // Temporarily remove this listener to allow actual submit
            targetForm._confirmed = true;
            targetForm.submit();
          }
        });
      });
    });
  }());

  /* ── Responsive Sidebar ─────────────────────────────── */
  const sidebar      = document.querySelector('.sidebar');
  const burgerBtn    = document.getElementById('burger-btn');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    if (sidebar)        sidebar.classList.add('is-open');
    if (sidebarOverlay) sidebarOverlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    if (sidebar)        sidebar.classList.remove('is-open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  if (burgerBtn)      burgerBtn.addEventListener('click', openSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('is-open')) {
      closeSidebar();
    }
  });

  /* ── Global Search ──────────────────────────────────── */
  var searchInput    = document.getElementById('global-search');
  var searchDropdown = document.getElementById('search-dropdown');
  var searchDebTimer = null;
  var activeSearchIdx = -1;

  if (searchInput && searchDropdown) {
    searchInput.addEventListener('input', function () {
      clearTimeout(searchDebTimer);
      var q = searchInput.value.trim();
      if (q.length < 2) {
        searchDropdown.classList.remove('is-open');
        searchDropdown.innerHTML = '';
        return;
      }
      // Show loading
      searchDropdown.classList.add('is-open');
      searchDropdown.innerHTML = '<div class="search-loading">...</div>';
      searchDebTimer = setTimeout(function () {
        doSearch(q);
      }, 300);
    });

    searchInput.addEventListener('keydown', function (e) {
      var items = searchDropdown.querySelectorAll('.search-item');
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSearchIdx = Math.min(activeSearchIdx + 1, items.length - 1);
        highlightSearchItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSearchIdx = Math.max(activeSearchIdx - 1, 0);
        highlightSearchItem(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var active = searchDropdown.querySelector('.search-item.is-focused');
        if (active) {
          var link = active.getAttribute('data-href');
          if (link) window.location.href = link;
        }
      } else if (e.key === 'Escape') {
        searchDropdown.classList.remove('is-open');
        searchInput.blur();
      }
    });

    document.addEventListener('click', function (e) {
      if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.classList.remove('is-open');
      }
    });

    searchInput.addEventListener('focus', function () {
      if (searchInput.value.trim().length >= 2) {
        searchDropdown.classList.add('is-open');
      }
    });
  }

  function highlightSearchItem(items) {
    items.forEach(function (el, i) {
      el.classList.toggle('is-focused', i === activeSearchIdx);
    });
    if (items[activeSearchIdx]) {
      items[activeSearchIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  function doSearch(q) {
    fetch('/search?q=' + encodeURIComponent(q), {
      headers: { 'Accept': 'application/json' }
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      activeSearchIdx = -1;
      renderSearchResults(data);
    })
    .catch(function () {
      searchDropdown.innerHTML = '';
      searchDropdown.classList.remove('is-open');
    });
  }

  function renderSearchResults(data) {
    if (!searchDropdown) return;

    var html = '';
    var total = 0;

    var categoryMap = {
      reagents:    { label: data._labels && data._labels.reagents    || 'Reagents',    icon: '🧪' },
      consumables: { label: data._labels && data._labels.consumables || 'Consumables', icon: '📦' },
      equipment:   { label: data._labels && data._labels.equipment   || 'Equipment',   icon: '⚙️' },
      protocols:   { label: data._labels && data._labels.protocols   || 'Protocols',   icon: '📄' },
    };

    ['reagents', 'consumables', 'equipment', 'protocols'].forEach(function (cat) {
      var items = data[cat];
      if (!items || !items.length) return;
      total += items.length;

      var catInfo = categoryMap[cat];
      html += '<div class="search-group-title">' + catInfo.label + '</div>';

      items.slice(0, 5).forEach(function (item) {
        var href = '/' + cat + '/' + item.id;
        var name = item.nameRu || item.titleRu || item.name || '';
        var sub  = item.nameEn || item.titleEn || item.casNumber || item.model || '';
        html += '<div class="search-item" data-href="' + href + '" onclick="window.location.href=\'' + href + '\'">'
          + '<span class="search-item-name">' + escHtml(name) + '</span>'
          + (sub ? '<span class="search-item-sub">' + escHtml(sub) + '</span>' : '')
          + '</div>';
      });
    });

    if (total === 0) {
      html = '<div class="search-no-results">' + (data._noResults || 'Ничего не найдено') + '</div>';
    }

    searchDropdown.innerHTML = html;
    searchDropdown.classList.add('is-open');
  }

  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* ── Sortable Table Columns ─────────────────────────── */
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.classList.add('sortable');

    var params = new URLSearchParams(window.location.search);
    var currentSort = params.get('sort');
    var currentDir  = params.get('dir') || 'asc';
    var col = th.getAttribute('data-sort');

    if (currentSort === col) {
      th.classList.add(currentDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    th.addEventListener('click', function () {
      var p = new URLSearchParams(window.location.search);
      var prevDir = (p.get('sort') === col) ? p.get('dir') : 'asc';
      var newDir  = prevDir === 'asc' ? 'desc' : 'asc';
      p.set('sort', col);
      p.set('dir', newDir);
      p.set('page', '1');
      window.location.search = p.toString();
    });
  });

  /* ── Auto-hide flash banners ────────────────────────── */
  document.querySelectorAll('.status-banner').forEach(function (el) {
    setTimeout(function () {
      el.style.transition = 'opacity 0.5s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 500);
    }, 4000);
  });

}());
