/* JCompass layout add-ons — v6. Load AFTER app.js. */
(function () {
  'use strict';
  const { Utils } = window.JC;
  const $ = id => document.getElementById(id);

  window.JC.showAssignPopup = function (heading, title, page) {
    const el = Utils.el('div', { class: 'assign-popup' });
    const box = Utils.el('div', { class: 'assign-popup-box' });
    box.appendChild(Utils.el('div', { style: 'font-size:3rem' }, '📌'));
    box.appendChild(Utils.el('h2', {}, heading));
    box.appendChild(Utils.el('p', {}, title));
    const btn = Utils.el('button', { class: 'btn btn-primary', type: 'button' }, 'OK');
    btn.onclick = () => {
      el.remove();
      document.querySelector('.nav-item[data-page="' + page + '"]')?.click();
    };
    box.appendChild(btn);
    el.appendChild(box);
    document.body.appendChild(el);
    if (navigator.vibrate) navigator.vibrate(200);
  };

  function buildLayout() {
    const sidebar = $('sidebar');
    const topRight = document.querySelector('.topbar-right');
    if (!sidebar) return;

    const brand = sidebar.querySelector('.sidebar-brand');
    if (brand && !$('brandLogoSlot')) {
      brand.querySelector('.brand-icon')?.remove();
      const slot = Utils.el('div', { class: 'brand-logo-slot', id: 'brandLogoSlot' });
      const img = Utils.el('img', { src: 'favicon.ico', alt: 'JCompass logo' });
      img.onerror = () => { img.remove(); slot.appendChild(Utils.el('span', { class: 'brand-logo-placeholder' }, '🧭')); };
      slot.appendChild(img);
      brand.insertBefore(slot, brand.firstChild);
    }

    if (topRight && !$('topbarProfileBtn')) {
      const btn = Utils.el('button', { type: 'button', class: 'topbar-menu-btn', id: 'topbarProfileBtn' });
      btn.appendChild(Utils.el('div', { class: 'hamburger-icon' }, [Utils.el('span'), Utils.el('span'), Utils.el('span')]));
      btn.appendChild(Utils.el('div', { class: 'topbar-avatar', id: 'topbarAvatar' }, 'JC'));
      btn.appendChild(Utils.el('span', { class: 'topbar-name', id: 'topbarName' }, 'Loading…'));
      btn.onclick = () => $('settingsSidebarBtn')?.click();
      topRight.appendChild(btn);
    }

    $('menuToggle')?.classList.remove('avatar-toggle');
    $('userAvatarBtn')?.classList.add('chip-hidden');

    const mirror = () => {
      const g = id => ($(id) || {}).textContent || '';
      const av = $('topbarAvatar'); const nm = $('topbarName');
      if (av) av.textContent = g('avatarBadgeIcon') || 'JC';
      if (nm) nm.textContent = g('displayName') || 'User';
    };
    ['displayName', 'displayRole', 'avatarBadgeIcon'].forEach(id => {
      const el = $(id);
      if (el && !el.dataset.mirrorObserver) {
        el.dataset.mirrorObserver = '1';
        new MutationObserver(mirror).observe(el, { childList: true, characterData: true, subtree: true });
      }
    });
    mirror();

    const nav = sidebar.querySelector('.sidebar-nav');
    if (nav && !$('sideBell')) {
      const bell = Utils.el('button', { class: 'side-bell', id: 'sideBell', type: 'button' });
      bell.appendChild(document.createTextNode('🔔 '));
      bell.appendChild(Utils.el('span', {}, 'Notifications'));
      bell.appendChild(Utils.el('b', { class: 'bell-badge', id: 'bellBadge', hidden: true }, '0'));
      bell.onclick = openBell;
      nav.appendChild(bell);
    }
  }

  const SEEN = 'jcompass_bell_seen';
  const num = a => parseInt(String(a.id).replace('remote-', ''), 10) || 0;
  const currentUserName = () => window.JC.Session.user()?.name || null;
  const mine = () => {
    if (typeof announcements === 'undefined') return [];
    const name = currentUserName();
    if (!name) return [];
    return announcements.filter(a => a.sender !== name && (a.target === 'ALL' || a.target === name));
  };

  function updateBadge() {
    const b = $('bellBadge'); if (!b) return;
    let seen = 0; try { seen = parseInt(localStorage.getItem(SEEN) || '0', 10); } catch {}
    const n = mine().filter(a => num(a) > seen).length;
    b.textContent = n > 99 ? '99+' : n;
    b.hidden = n === 0;
  }

  function openBell() {
    try {
      if (typeof announcements !== 'undefined' && announcements.length) {
        localStorage.setItem(SEEN, String(Math.max(0, ...announcements.map(num))));
      }
    } catch {}
    updateBadge();
    document.querySelector('.nav-item[data-page="dashboard"]')?.click();
    $('sidebar')?.classList.remove('active');
    setTimeout(() => $('announcementsStreamContainer')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }

  let paused = false, waiting = false;
  function tickScroll() {
    const c = $('announcementsStreamContainer');
    if (c && !paused && !waiting && c.scrollHeight > c.clientHeight + 2) {
      if (c.scrollTop + c.clientHeight >= c.scrollHeight - 1) {
        waiting = true;
        setTimeout(() => { c.scrollTop = 0; setTimeout(() => { waiting = false; }, 500); }, 500);
      } else c.scrollTop += 0.6;
    }
    requestAnimationFrame(tickScroll);
  }

  function buildCabinetStats() {
    const grid = document.querySelector('.stats-grid');
    if (!grid) return;
    grid.classList.add('cabinet-stats');

    const targetMap = {
      statActiveProjects: 'dashboard', statOverdue: 'calendar',
      statDueSoon: 'calendar', statStaffCount: 'users', statTodayCheckins: 'attend'
    };
    const isStaff = window.JC.Session.user()?.role !== 'ADMIN';

    grid.querySelectorAll('.stat-card').forEach(card => {
      const valEl = card.querySelector('.stat-value');
      if (!valEl) return;
      const id = valEl.id;

      if (id === 'statStaffCount' && isStaff) { card.style.display = 'none'; return; }
      card.style.display = '';

      const target = targetMap[id];
      if (!target) return;
      card.style.cursor = 'pointer';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      if (!card.dataset.bound) {
        card.dataset.bound = '1';
        const go = ev => {
          if (ev) { ev.preventDefault(); ev.stopPropagation(); }
          document.querySelector('.nav-item[data-page="' + target + '"]')?.click();
          if (window.innerWidth <= 992) $('sidebar')?.classList.remove('active');
        };
        card.addEventListener('click', go);
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
      }
    });
  }

  function initBrightness() {
    const setMode = m => {
      document.body.setAttribute('data-mode', m);
      try { localStorage.setItem('jcompass_mode', m); } catch {}
      document.querySelectorAll('.mode-chip-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    };
    let saved = 'dark';
    try { saved = localStorage.getItem('jcompass_mode') || 'dark'; } catch {}
    setMode(saved);
    document.querySelectorAll('.mode-chip-btn').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
  }

  function init() {
    const nameIn = $('sidebarNameInput'); const save = $('saveNameBtn');
    if (nameIn) { nameIn.readOnly = true; nameIn.disabled = true; }
    if (save) save.style.display = 'none';

    const dir = $('staffDirectoryList');
    if (dir && dir.closest('.panel-card')) dir.closest('.panel-card').classList.add('dir-panel');

    const ac = $('announcementsStreamContainer');
    if (ac) {
      ac.addEventListener('mouseenter', () => paused = true);
      ac.addEventListener('mouseleave', () => paused = false);
    }
    requestAnimationFrame(tickScroll);

    initBrightness();
    buildCabinetStats();
    buildLayout();
    updateBadge();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  const origStats = window.generateDashboardStats;
  if (origStats) {
    window.generateDashboardStats = function () { origStats.apply(this, arguments); buildCabinetStats(); };
  }
  ['generateAnnouncementsStream', 'rebuildApplicationDOMViews'].forEach(fn => {
    const orig = window[fn];
    if (typeof orig !== 'function') return;
    window[fn] = function () { orig.apply(this, arguments); buildLayout(); updateBadge(); };
  });

  document.addEventListener('click', e => {
    if (e.target.closest('.settings-sidebar-btn, #settingsGearBtn, #userAvatarBtn, #topbarProfileBtn')) {
      setTimeout(initBrightness, 50);
    }
  }, true);
})();