/* ══════════════════════════════════════════════════════════════════════
   JCompass add-on — v6.1
   Load AFTER app.js.
   • Assign popup (JC.showAssignPopup)
   • Auto-scroll announcements
   • Cabinet stats (clickable, hides Team Members for STAFF)
   • Brightness toggle wiring
   • Layout: topbar bell + profile pill, hamburger inside workspace tray
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  const { Utils } = window.JC;
  const $ = id => document.getElementById(id);

  /* ── Assign popup (called from app.js) ────────────────────────── */
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

  /* ── Project status colours ───────────────────────────────────── */
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

  /* ── Announcements auto-scroll ────────────────────────────────── */
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

  /* ── Cabinet stats — hide Team Members tile for STAFF ─────────── */
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

      if (id === 'statStaffCount' && isStaff) {
        card.style.display = 'none';
        return;
      }
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

  /* ── Brightness toggle ────────────────────────────────────────── */
  function initBrightness() {
    const setMode = m => {
      document.body.setAttribute('data-mode', m);
      try { localStorage.setItem('jcompass_mode', m); } catch {}
      document.querySelectorAll('.mode-chip-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === m);
      });
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

  /* ══════════════════════════════════════════════════════════════════
     LAYOUT: topbar bell, profile pill, hamburger in workspace tray
     ══════════════════════════════════════════════════════════════════ */
  function buildLayout() {
    const sidebar = $('sidebar');
    const topRight = document.querySelector('.topbar-right');
    if (!sidebar) return;

    /* ── Bell in the topbar ────────────────────────────────────── */
    if (topRight && !$('topbarBell')) {
      const bell = Utils.el('button', {
        type: 'button', class: 'topbar-bell', id: 'topbarBell',
        title: 'Notifications', 'aria-label': 'Notifications'
      });
      bell.appendChild(document.createTextNode('🔔'));
      bell.appendChild(Utils.el('b', { class: 'bell-badge', id: 'bellBadge', hidden: true }, '0'));
      bell.onclick = openBell;
      topRight.appendChild(bell);
    }

    /* ── Profile pill (avatar + name, no hamburger) ───────────── */
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

    /* ── Hamburger inside the workspace controls tray ─────────── */
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

    /* ── Hide old topbar chip, remove old sidebar bell ─────────── */
    $('userAvatarBtn')?.classList.add('chip-hidden');
    $('sideBell')?.remove();

    /* ── Mirror name / avatar from hidden elements ────────────── */
    const mirror = () => {
      const g = id => ($(id) || {}).textContent || '';
      const av = $('topbarAvatar');
      const nm = $('topbarName');
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

  /* ── Bell badge + open logic ──────────────────────────────────── */
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
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async OS => {
      try { if (!OS.Notifications.permission) await OS.Notifications.requestPermission(); } catch {}
    });
  }

  /* ── Init ─────────────────────────────────────────────────────── */
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

  /* ── Wrap functions to keep cabinet + bell fresh ──────────────── */
  const origStats = window.generateDashboardStats;
  if (origStats) {
    window.generateDashboardStats = function () { origStats.apply(this, arguments); buildCabinetStats(); };
  }
  ['generateAnnouncementsStream', 'rebuildApplicationDOMViews'].forEach(fn => {
    const orig = window[fn];
    if (typeof orig !== 'function') return;
    window[fn] = function () { orig.apply(this, arguments); buildLayout(); updateBadge(); };
  });

  /* ── Re-wire brightness chips when the tray opens ─────────────── */
  document.addEventListener('click', e => {
    if (e.target.closest('.settings-sidebar-btn, #settingsGearBtn, #userAvatarBtn, #topbarProfileBtn')) {
      setTimeout(initBrightness, 50);
    }
  }, true);
})();