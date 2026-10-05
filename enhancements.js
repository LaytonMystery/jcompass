/* ══════════════════════════════════════════════════════════════════════
   JCompass add-on — v6.2
   Load AFTER app.js.
   • Topbar bell toggles notification permission (no more badge)
   • Mobile hamburger replaced with logo
   • Bell vertically aligned with profile pill
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  const { Utils } = window.JC;
  const $ = id => document.getElementById(id);

  /* ── Assign popup ────────────────────────────────────────────── */
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

  /* ── Project status colours ──────────────────────────────────── */
  function applyProjectColors() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    document.querySelectorAll('#projectGrid .profile-btn').forEach(btn => {
      const p = (typeof projects !== 'undefined') ? projects.find(x => x.id === parseInt(btn.dataset.id)) : null;
      const card = btn.closest('.card');
      if (!p || !card) return;
      card.classList.remove('proj-ok', 'proj-late', 'proj-soon');
      let c = 'proj-ok';
      if (p.deadline && p.status !== 'FILED' && p.status !== 'PUBLISHED') {
        const d = Math.ceil((new Date(p.deadline) - today) / 86400000);
        if (d < 0) c = 'proj-late';
        else if (d <= 3) c = 'proj-soon';
      }
      card.classList.add(c);
    });
  }
  const origProjDash = window.generateProjectDashboard;
  if (origProjDash) {
    window.generateProjectDashboard = function () {
      origProjDash.apply(this, arguments);
      applyProjectColors();
    };
  }

  /* ── Announcements auto-scroll ───────────────────────────────── */
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

  /* ── Cabinet stats ───────────────────────────────────────────── */
  function buildCabinetStats() {
    const grid = document.querySelector('.stats-grid');
    if (!grid) return;
    grid.classList.add('cabinet-stats');

    const targetMap = {
      statActiveProjects: 'dashboard',
      statOverdue:        'calendar',
      statDueSoon:        'calendar',
      statStaffCount:     'users',
      statTodayCheckins:  'attend'
    };
    const isStaff = (window.JC.Session.user()?.role || 'STAFF') !== 'ADMIN';

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
        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); }
        });
      }
    });
  }

  /* ── Brightness toggle ───────────────────────────────────────── */
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

  /* ══════════════════════════════════════════════════════════════
     Bell — enable / disable notifications
     ══════════════════════════════════════════════════════════════ */
  function updateBellUI() {
    const bell = $('topbarBell');
    if (!bell) return;

    const supported = 'Notification' in window;
    const perm = supported ? Notification.permission : 'unsupported';

    bell.classList.remove('bell-on', 'bell-off', 'bell-blocked');
    bell.innerHTML = '';
    bell.appendChild(document.createTextNode((!supported || perm === 'denied') ? '🔕' : '🔔'));

    if (!supported || perm === 'denied') {
      bell.classList.add('bell-blocked');
      bell.title = supported
        ? 'Notifications blocked — enable in browser settings'
        : 'Notifications not supported';
    } else if (perm === 'granted') {
      bell.classList.add('bell-on');
      bell.title = 'Notifications enabled';
    } else {
      bell.classList.add('bell-off');
      bell.title = 'Click to enable notifications';
    }
  }

  async function toggleBellNotifications() {
    if (!('Notification' in window)) {
      if (typeof triggerNotificationToast === 'function')
        triggerNotificationToast('Notifications are not supported in this browser.');
      return;
    }
    if (Notification.permission === 'granted') {
      if (typeof triggerNotificationToast === 'function')
        triggerNotificationToast('Notifications already enabled. Disable them in your browser settings.');
      return;
    }
    if (Notification.permission === 'denied') {
      if (typeof triggerNotificationToast === 'function')
        triggerNotificationToast('Notifications are blocked. Enable them in your browser settings.');
      return;
    }
    const result = await Notification.requestPermission();
    updateBellUI();
    if (result === 'granted') {
      if (typeof triggerNotificationToast === 'function')
        triggerNotificationToast('✓ Notifications enabled.');
      const u = window.JC.Session.user();
      if (u && typeof setOneSignalUser === 'function') setOneSignalUser(u.name).catch(() => {});
    } else {
      if (typeof triggerNotificationToast === 'function')
        triggerNotificationToast('Notifications were not enabled.');
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Layout — bell, profile pill, tray hamburger, mobile logo
     ══════════════════════════════════════════════════════════════ */
  function buildLayout() {
    const sidebar = $('sidebar');
    const topRight = document.querySelector('.topbar-right');
    if (!sidebar) return;

/* Sidebar brand slot — only add if neither the ID nor the class is present */
const brand = sidebar.querySelector('.sidebar-brand');
if (brand && !brand.querySelector('.brand-logo-slot')) {
  brand.querySelector('.brand-icon')?.remove();
  const slot = Utils.el('div', { class: 'brand-logo-slot', id: 'brandLogoSlot' });
  const img = Utils.el('img', { src: 'favicon.ico', alt: 'JCompass logo' });
  img.onerror = () => { img.remove(); slot.appendChild(Utils.el('span', { class: 'brand-logo-placeholder' }, '🧭')); };
  slot.appendChild(img);
  brand.insertBefore(slot, brand.firstChild);
}

    /* Topbar bell */
    if (topRight && !$('topbarBell')) {
      const bell = Utils.el('button', {
        type: 'button', class: 'topbar-bell', id: 'topbarBell',
        title: 'Enable notifications', 'aria-label': 'Notifications'
      });
      bell.onclick = toggleBellNotifications;
      topRight.insertBefore(bell, topRight.firstChild);
    }
    updateBellUI();

    /* Profile pill */
    if (topRight && !$('topbarProfileBtn')) {
      const btn = Utils.el('button', {
        type: 'button', class: 'topbar-menu-btn', id: 'topbarProfileBtn',
        title: 'Open workspace settings'
      });
      btn.appendChild(Utils.el('div', { class: 'topbar-avatar', id: 'topbarAvatar' }, 'JC'));
      btn.appendChild(Utils.el('span', { class: 'topbar-name', id: 'topbarName' }, 'Loading…'));
      btn.onclick = () => $('settingsSidebarBtn')?.click();
      topRight.appendChild(btn);
    }

    /* Hamburger inside the workspace tray */
    const trayHeader = document.querySelector('.control-tray .tray-header');
    if (trayHeader && !$('trayHamburger')) {
      const hb = Utils.el('button', {
        type: 'button', class: 'tray-hamburger', id: 'trayHamburger',
        title: 'Toggle navigation', 'aria-label': 'Toggle navigation'
      });
      hb.appendChild(Utils.el('div', { class: 'hamburger-icon' }, [
        Utils.el('span'), Utils.el('span'), Utils.el('span')
      ]));
      hb.onclick = () => {
        $('controlTray')?.classList.remove('active');
        $('controlTrayOverlay')?.classList.remove('active');
        $('sidebar')?.classList.add('active');
      };
      trayHeader.insertBefore(hb, trayHeader.firstChild);
    }

    /* Mobile menu-toggle → logo */
    const menuBtn = $('menuToggle');
    if (menuBtn && !menuBtn.querySelector('img')) {
      menuBtn.innerHTML = '';
      const img = document.createElement('img');
      img.src = 'favicon.ico';
      img.alt = 'Open navigation';
      img.onerror = () => { menuBtn.textContent = '☰'; };
      menuBtn.appendChild(img);
    }

    /* Legacy cleanup */
    $('userAvatarBtn')?.classList.add('chip-hidden');
    $('sideBell')?.remove();

    /* Mirror name + avatar */
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
  }

  /* ── Init ────────────────────────────────────────────────────── */
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* Wrap to keep cabinet + bell fresh */
  const origStats = window.generateDashboardStats;
  if (origStats) {
    window.generateDashboardStats = function () { origStats.apply(this, arguments); buildCabinetStats(); };
  }
  const origRebuild = window.rebuildApplicationDOMViews;
  if (origRebuild) {
    window.rebuildApplicationDOMViews = function () {
      origRebuild.apply(this, arguments);
      buildLayout();
    };
  }

  document.addEventListener('click', e => {
    if (e.target.closest('.settings-sidebar-btn, #settingsGearBtn, #userAvatarBtn, #topbarProfileBtn')) {
      setTimeout(initBrightness, 50);
    }
  }, true);

  // Re-check permission when the tab regains focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateBellUI();
  });
})();