/* ══════════════════════════════════════════════════════════════════════
   Sentinel JCompass add-on — v6.6
   Load AFTER app.js.
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
    const role = window.JC.Session.user()?.role || 'STAFF';
    const isStaff = role !== 'ADMIN' && role !== 'EDITOR';

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
      if (!m) return;
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
     Notification center (bell)
     ══════════════════════════════════════════════════════════════ */
  const NOTIF_READ_KEY = 'jcompass_read_notifs';

  function getReadNotifIds() {
    try {
      const v = JSON.parse(localStorage.getItem(NOTIF_READ_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  function setReadNotifIds(ids) {
    try { localStorage.setItem(NOTIF_READ_KEY, JSON.stringify([...new Set(ids)])); } catch {}
  }

  function getMyPings() {
    const user = window.JC.Session.user();
    if (!user) return [];
    const anns = (window.JC.getAnnouncements && window.JC.getAnnouncements()) || [];
    return anns.filter(a =>
      a.sender !== user.name && (a.target === 'ALL' || a.target === user.name)
    );
  }

  function getUnreadNotifCount() {
    const readIds = new Set(getReadNotifIds());
    return getMyPings().filter(a => !readIds.has(String(a.id))).length;
  }

  function updateBellUI() {
    const bell = $('topbarBell');
    if (!bell) return;
    const supported = 'Notification' in window;
    const perm = supported ? Notification.permission : 'unsupported';
    let icon = '🔔';
    if (!supported || perm === 'denied') icon = '🔕';

    bell.classList.remove('bell-on', 'bell-off', 'bell-blocked');
    if (!supported || perm === 'denied') bell.classList.add('bell-blocked');
    else if (perm === 'granted') bell.classList.add('bell-on');
    else bell.classList.add('bell-off');

    const count = getUnreadNotifCount();
    const badgeHtml = '<span class="bell-badge"' + (count > 0 ? '' : ' hidden') + '>' +
      (count > 99 ? '99+' : count) + '</span>';
    bell.innerHTML = icon + badgeHtml;
    bell.title = count > 0
      ? count + ' new notification' + (count === 1 ? '' : 's')
      : 'Notifications';
  }

  function notificationStatusLabel() {
    if (!('Notification' in window)) return { text: '🔕 Not supported in this browser', disabled: true };
    if (Notification.permission === 'granted') return { text: '✓ Notifications enabled', disabled: true };
    if (Notification.permission === 'denied') return { text: '🔕 Blocked — enable in browser settings', disabled: true };
    return { text: '🔔 Enable notifications', disabled: false };
  }

  function refreshNotifEnableButton() {
    const btn = $('notifCenterEnable');
    if (!btn) return;
    const status = notificationStatusLabel();
    btn.textContent = status.text;
    btn.disabled = status.disabled;
    btn.classList.toggle('is-enabled', status.disabled && Notification.permission === 'granted');
    btn.classList.toggle('is-blocked', status.disabled && Notification.permission === 'denied');
  }

  function ensureNotifCenter() {
    let modal = $('notifCenterModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'notifCenterModal';
    modal.className = 'modal-overlay';
    modal.innerHTML =
      '<div class="modal" style="max-width:560px;width:95vw;">' +
        '<div class="modal-header">' +
          '<div style="display:flex;flex-direction:column;gap:0.25rem;">' +
            '<div class="card-category">NOTIFICATIONS</div>' +
            '<h2 class="modal-title">Recent Pings &amp; Announcements</h2>' +
          '</div>' +
          '<button class="modal-close" type="button" id="notifCenterClose">✕</button>' +
        '</div>' +
        '<div style="padding:0.75rem 1.25rem; border-bottom:1px solid var(--border-color);">' +
          '<button class="btn btn-ghost" id="notifCenterEnable" type="button" style="width:100%; font-size:0.85rem;">🔔 Enable notifications</button>' +
        '</div>' +
        '<div class="modal-body" id="notifCenterBody" style="gap:0.6rem;"></div>' +
        '<div class="modal-footer" style="justify-content:space-between;">' +
          '<button class="btn btn-ghost" id="notifCenterMarkRead" type="button">✓ Mark all read</button>' +
          '<button class="btn btn-primary" type="button" id="notifCenterDone">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.remove('active');
    });
    modal.querySelector('#notifCenterClose').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#notifCenterDone').addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('#notifCenterMarkRead').addEventListener('click', () => {
      const readIds = getReadNotifIds();
      getMyPings().forEach(a => readIds.push(String(a.id)));
      setReadNotifIds(readIds);
      renderNotifCenter();
      updateBellUI();
    });
    modal.querySelector('#notifCenterEnable').addEventListener('click', async () => {
      const btn = $('notifCenterEnable');
      if (!('Notification' in window)) {
        if (typeof triggerNotificationToast === 'function')
          triggerNotificationToast('Notifications are not supported in this browser.');
        return;
      }
      if (Notification.permission === 'granted') return;
      if (Notification.permission === 'denied') {
        if (typeof triggerNotificationToast === 'function')
          triggerNotificationToast('Notifications are blocked. Enable them in your browser settings.');
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Requesting…'; }
      try {
        const res = await Notification.requestPermission();
        if (res === 'granted') {
          if (typeof triggerNotificationToast === 'function')
            triggerNotificationToast('✓ Notifications enabled.');
          const u = window.JC.Session.user();
          if (u && typeof setOneSignalUser === 'function') setOneSignalUser(u.name).catch(() => {});
          if (typeof window.JC.registerFCM === 'function') {
            window.JC.registerFCM().catch(() => {});
          }
        } else {
          if (typeof triggerNotificationToast === 'function')
            triggerNotificationToast('Notification permission not granted.');
        }
      } catch (err) {
        console.warn('Notification.requestPermission failed:', err);
      }
      refreshNotifEnableButton();
      updateBellUI();
    });

    return modal;
  }

  function renderNotifCenter() {
    const modal = ensureNotifCenter();
    const body = modal.querySelector('#notifCenterBody');
    const list = getMyPings();

    if (list.length === 0) {
      body.innerHTML = '<div class="notif-empty">No pings yet. When an Admin or Editor in Chief messages you, it will appear here.</div>';
      return;
    }

    const readIds = new Set(getReadNotifIds());
    const recent = list.slice().reverse().slice(0, 50);

    body.innerHTML = recent.map(a => {
      const unread = !readIds.has(String(a.id));
      const badge = a.target === 'ALL' ? 'ANNOUNCEMENT' : 'DIRECT MESSAGE';
      return '<div class="notif-item' + (unread ? ' unread' : '') + '">' +
        '<div class="notif-meta">' +
          '<span class="announcement-badge-alert">' + badge + '</span>' +
          '<span>From <b>' + Utils.escapeHtml(a.sender) + '</b></span>' +
          '<span>• ' + Utils.escapeHtml(a.timestamp || '') + '</span>' +
        '</div>' +
        '<div class="notif-body">' + Utils.escapeHtml(a.text) + '</div>' +
      '</div>';
    }).join('');
  }

  function openNotificationCenter() {
    renderNotifCenter();
    refreshNotifEnableButton();
    ensureNotifCenter().classList.add('active');
    setTimeout(() => {
      const readIds = getReadNotifIds();
      getMyPings().forEach(a => readIds.push(String(a.id)));
      setReadNotifIds(readIds);
      updateBellUI();
    }, 900);
  }

  async function toggleBellNotifications() {
    openNotificationCenter();
  }

  /* ══════════════════════════════════════════════════════════════
     Layout: topbar (bell + profile), tray account name, sidebar tidy
     ══════════════════════════════════════════════════════════════ */
  function buildLayout() {
    const sidebar = $('sidebar');
    const topRight = document.querySelector('.topbar-right');
    if (!sidebar) return;

    /* Deduplicate sidebar brand */
    const brands = sidebar.querySelectorAll('.sidebar-brand');
    brands.forEach((b, i) => {
      if (i > 0) { b.remove(); return; }
      const slots = b.querySelectorAll('.brand-logo-slot');
      slots.forEach((s, j) => { if (j > 0) s.remove(); });
      const names = b.querySelectorAll('.brand-name');
      names.forEach((n, j) => { if (j > 0) n.remove(); });
      b.querySelectorAll('.brand-icon').forEach(el => el.remove());

      if (!b.querySelector('.brand-logo-slot')) {
        const slot = Utils.el('div', { class: 'brand-logo-slot', id: 'brandLogoSlot' });
        const img = Utils.el('img', { src: 'favicon.ico', alt: 'JCompass logo' });
        img.onerror = () => { img.remove(); slot.appendChild(Utils.el('span', { class: 'brand-logo-placeholder' }, '🧭')); };
        slot.appendChild(img);
        b.insertBefore(slot, b.firstChild);
      }
      if (!b.querySelector('.brand-name')) {
        b.appendChild(Utils.el('h1', { class: 'brand-name' }, 'Sentinel Journalist Compass'));
      }
    });

    /* Topbar: keep ONLY the bell + profile pill. */
    if (topRight) {
      /* Remove the extra accounts (👥) button if it ever existed */
      $('topbarAccountsBtn')?.remove();

      /* Bell */
      let bell = $('topbarBell');
      if (!bell) {
        bell = Utils.el('button', {
          type: 'button', class: 'topbar-bell', id: 'topbarBell',
          title: 'Notifications', 'aria-label': 'Notifications'
        });
        bell.onclick = toggleBellNotifications;
        topRight.insertBefore(bell, topRight.firstChild);
      } else if (!bell.dataset.boundBell) {
        bell.dataset.boundBell = '1';
        bell.onclick = toggleBellNotifications;
      }
      updateBellUI();

      /* Profile pill */
      if (!$('topbarProfileBtn')) {
        const btn = Utils.el('button', {
          type: 'button', class: 'topbar-menu-btn', id: 'topbarProfileBtn',
          title: 'Open workspace settings'
        });
        btn.appendChild(Utils.el('div', { class: 'topbar-avatar', id: 'topbarAvatar' }, 'JC'));
        btn.appendChild(Utils.el('span', { class: 'topbar-name', id: 'topbarName' }, 'Loading…'));
        btn.onclick = () => $('settingsSidebarBtn')?.click();
        topRight.appendChild(btn);
      }
    }

    /* Hide original user chip */
    $('userAvatarBtn')?.classList.add('chip-hidden');

    /* Remove legacy sidebar bell + tray hamburger if present */
    $('sideBell')?.remove();
    $('trayHamburger')?.remove();

    /* Tray title = account name */
    const trayTitle = $('trayAccountName');
    if (trayTitle) {
      const g = id => ($(id) || {}).textContent || '';
      trayTitle.textContent = g('displayName') || 'Workspace';
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

    /* Mirror name / avatar to tray + topbar pill */
    const mirror = () => {
      const g = id => ($(id) || {}).textContent || '';
      const av = $('topbarAvatar'); const nm = $('topbarName');
      if (av) av.textContent = g('avatarBadgeIcon') || 'JC';
      if (nm) nm.textContent = g('displayName') || 'User';
      const tt = $('trayAccountName');
      if (tt) tt.textContent = g('displayName') || 'Workspace';
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

  /* ── Tray action wiring (once) ───────────────────────────────── */
  function wireTrayActions() {
    const tray = $('controlTray');
    if (!tray || tray.dataset.trayWired === '1') return;
    tray.dataset.trayWired = '1';

    const closeTray = () => {
      $('controlTray')?.classList.remove('active');
      $('controlTrayOverlay')?.classList.remove('active');
    };

    $('trayUserMgmtBtn')?.addEventListener('click', () => {
      closeTray();
      const navItem = document.querySelector('.nav-item[data-page="users"]');
      if (navItem) navItem.click();
    });

    $('trayWorkspaceBtn')?.addEventListener('click', () => {
      closeTray();
      setTimeout(initBrightness, 50);
    });

    $('traySignOutBtn')?.addEventListener('click', () => {
      closeTray();
      try { if (typeof stopAttendanceTicker === 'function') stopAttendanceTicker(); } catch {}
      try { if (typeof stopSpotCheckScheduler === 'function') stopSpotCheckScheduler(); } catch {}
      window.JC.Session.logout();
      window.JC.Utils.store.del('jcompass_user');
      window.location.replace(window.JC.CONFIG.LOGIN_PAGE);
    });
  }

  /* ── Init ────────────────────────────────────────────────────── */
  function init() {
    const nameIn = $('sidebarNameInput'); const save = $('saveNameBtn');
    if (nameIn) { nameIn.readOnly = true; nameIn.disabled = true; }
    if (save) save.style.display = 'none';

    const dir = $('staffDirectoryList');
    if (dir && dir.closest('.panel-card')) dir.closest('.panel-card').classList.add('dir-panel');

    initBrightness();
    buildCabinetStats();
    buildLayout();
    wireTrayActions();

    setInterval(() => { if (window.JC.getAnnouncements) updateBellUI(); }, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  const origStats = window.generateDashboardStats;
  if (origStats) {
    window.generateDashboardStats = function () { origStats.apply(this, arguments); buildCabinetStats(); };
  }
  const origRebuild = window.rebuildApplicationDOMViews;
  if (origRebuild) {
    window.rebuildApplicationDOMViews = function () {
      origRebuild.apply(this, arguments);
      buildLayout();
      wireTrayActions();
    };
  }

  document.addEventListener('click', e => {
    if (e.target.closest('.settings-sidebar-btn, #settingsGearBtn, #userAvatarBtn, #topbarProfileBtn, #trayWorkspaceBtn')) {
      setTimeout(initBrightness, 50);
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateBellUI();
  });
})();