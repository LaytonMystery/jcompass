/* JCompass add-on. Load AFTER app.js. Shares app.js globals (projects, supabaseClient, currentUser...). */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     SECTION 1 — Per-table sync
     ══════════════════════════════════════════════════════════════════ */
  const bool = v => v === true || v === 1 || v === 'true';
  const T = {
    projects: {
      order: ['id', true],
      apply: rows => { projects = rows.map(p => ({
        id: p.id, title: p.title, category: p.category, deadline: p.deadline,
        status: p.status, priority: p.priority, progress: p.progress,
        reporter: p.reporter || '', notes: p.notes || '', tags: p.tags || '',
        archived: bool(p.archived), created_at: p.created_at,
        submission_text: p.submission_text || '', submission_file: p.submission_file || '',
        submitted_by: p.submitted_by || '', submitted_at: p.submitted_at || null })); },
      render: () => { generateDashboardStats(); generateProjectDashboard(); generateArchiveGrid();
                      generateDeadlineCalendarGrid(); generateStaffDirectory(); }
    },
    deployments: {
      order: ['id', true],
      apply: rows => { deployments = rows.map(d => ({
        id: d.id, title: d.title, description: d.description || '', location: d.location || '',
        reporter: d.reporter || '', priority: d.priority || 'MEDIUM', status: d.status || 'ACTIVE',
        imageData: d.image_data || '', createdBy: d.created_by || '',
        archived: d.archived || false, created_at: d.created_at })); },
      render: () => generateDeploymentsGrid()
    },
    events: {
      order: ['id', true],
      apply: rows => { events = rows.map(e => ({
        id: e.id, name: e.name, date: e.date, completed: e.completed || false, archived: e.archived || false })); },
      render: () => { generateEventsTrackerChecklist(); generateDeadlineCalendarGrid(); }
    },
    sources: {
      order: ['id', true],
      apply: rows => { sources = rows.map(s => ({
        id: s.id, name: s.name, beat: s.beat || '', contact: s.contact || '',
        reliability: s.reliability || 'MEDIUM', notes: s.notes || '', createdBy: s.created_by || 'Unknown' })); },
      render: () => generateSourcesGrid()
    },
    audit_log: {
      order: ['created_at', false], limit: 500,
      apply: rows => { auditLog = rows.map(a => ({
        id: a.id, actor: a.actor, action: a.action, target_type: a.target_type || '',
        target_id: a.target_id || '', target_name: a.target_name || '', details: a.details || '',
        created_at: a.created_at })); },
      render: () => { renderAuditLogTable(); generateActivitySummaryGrid(); }
    }
  };

  async function refreshTable(name) {
    const t = T[name];
    let q = supabaseClient.from(name).select('*').order(t.order[0], { ascending: t.order[1] });
    if (t.limit) q = q.limit(t.limit);
    const { data, error } = await q;
    if (error) throw error;
    t.apply(data || []);
    flushCachedCollections();
    t.render();
    applyProjectColors();
    buildCabinetStats();
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 2 — Realtime (single channel, debounced, auto-reconnect)
     ══════════════════════════════════════════════════════════════════ */
  const timers = {};
  let liveChannel = null;
  let reconnectTimer = null;
  let subscribedOnce = false;

  function scheduleRefresh(table) {
    clearTimeout(timers[table]);
    timers[table] = setTimeout(() => {
      refreshTable(table).catch(e => console.error('live refresh', table, e));
    }, 250);
  }

  function subscribeLive() {
    if (subscribedOnce && liveChannel) return; // prevent duplicate channels
    subscribedOnce = true;

    liveChannel = supabaseClient.channel('jcompass-live');

    ['projects', 'deployments', 'events', 'sources', 'audit_log'].forEach(table => {
      liveChannel.on('postgres_changes',
        { event: '*', schema: 'public', table },
        () => scheduleRefresh(table));
    });

    // Assignment popup triggers
    liveChannel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'assignments' },
      p => {
        if (currentUser && p.new.assignee === currentUser.name && p.new.created_by !== currentUser.name) {
          showAssignPopup('New task assigned', p.new.title, 'assignments');
        }
        scheduleRefresh('projects'); // assignments aren't in the auto-sync list, but keep dashboard fresh
      });

    liveChannel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'projects' },
      p => {
        if (currentUser && p.new.reporter === currentUser.name) {
          showAssignPopup('New project assigned', p.new.title, 'dashboard');
        }
      });

    liveChannel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Live channel connected.');
        subscribedOnce = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn('Live channel disconnected, retrying…', status);
        try { supabaseClient.removeChannel(liveChannel); } catch (e) {}
        liveChannel = null;
        subscribedOnce = false;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(subscribeLive, 3000);
      }
    });
  }

  // Wrap the app's original subscribeRealtime so ours hooks in too
  const _sub = window.subscribeRealtime;
  window.subscribeRealtime = async function () {
    try { await _sub(); } catch (e) { console.warn('app realtime:', e); }
    subscribeLive();
  };

  // Re-sync when the tab becomes visible again (phone/tab was asleep)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || typeof currentUser === 'undefined' || !currentUser) return;
    try {
      await syncAllDataFromSupabase();
      rebuildApplicationDOMViews();
      applyProjectColors();
      buildCabinetStats();
    } catch (e) { console.warn('catch-up sync failed', e); }
  });

  /* ══════════════════════════════════════════════════════════════════
     SECTION 3 — Assignment popup
     ══════════════════════════════════════════════════════════════════ */
  function showAssignPopup(heading, title, page) {
    const el = document.createElement('div');
    el.className = 'assign-popup';
    el.innerHTML = '<div class="assign-popup-box"><div style="font-size:3rem">📌</div><h2></h2><p></p>' +
                   '<button class="btn btn-primary" type="button">OK</button></div>';
    el.querySelector('h2').textContent = heading;
    el.querySelector('p').textContent = title;
    el.querySelector('button').onclick = () => {
      el.remove();
      const nav = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (nav) nav.click();
    };
    document.body.appendChild(el);
    if (navigator.vibrate) navigator.vibrate(200);
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 4 — Project status colours
     ══════════════════════════════════════════════════════════════════ */
  function applyProjectColors() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    document.querySelectorAll('#projectGrid .profile-btn').forEach(btn => {
      const p = projects.find(x => x.id === parseInt(btn.dataset.id));
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
  ['generateProjectDashboard'].forEach(fn => {
    const orig = window[fn];
    window[fn] = function () { orig.apply(this, arguments); applyProjectColors(); };
  });

  /* ══════════════════════════════════════════════════════════════════
     SECTION 5 — Announcement auto-scroll
     ══════════════════════════════════════════════════════════════════ */
  let paused = false, waiting = false;
  function tickScroll() {
    const c = document.getElementById('announcementsStreamContainer');
    if (c && !paused && !waiting && c.scrollHeight > c.clientHeight + 2) {
      if (c.scrollTop + c.clientHeight >= c.scrollHeight - 1) {
        waiting = true;
        setTimeout(() => { c.scrollTop = 0; setTimeout(() => { waiting = false; }, 500); }, 500);
      } else c.scrollTop += 0.6;
    }
    requestAnimationFrame(tickScroll);
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 6 — Cabinet stats (clickable, staff filtering)
     ══════════════════════════════════════════════════════════════════ */
  function buildCabinetStats() {
    const grid = document.querySelector('.stats-grid');
    if (!grid) return;
    grid.classList.add('cabinet-stats');

    // Map stat id → nav-item data-page target
    const targetMap = {
      statActiveProjects: 'dashboard',
      statOverdue:        'calendar',
      statDueSoon:        'calendar',
      statStaffCount:     'users',
      statTodayCheckins:  'attend'
    };

    // STAFF: hide "Team Members" tile completely
    const isStaff = currentUser && currentUser.role !== 'ADMIN';

    grid.querySelectorAll('.stat-card').forEach(card => {
      const valEl = card.querySelector('.stat-value');
      if (!valEl) return;
      const id = valEl.id;

      // ---- Filter for STAFF ----
      if (isStaff && id === 'statStaffCount') {
        card.style.display = 'none';
        return;
      } else {
        card.style.display = ''; // restore for admin
      }

      const target = targetMap[id];
      if (!target) return;

      // ---- Make it clickable ----
      card.style.cursor = 'pointer';
      card.dataset.target = target;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.title = 'Open ' + target;

      // Bind once (avoid duplicate listeners)
      if (!card.dataset.bound) {
        card.dataset.bound = '1';

        const go = (ev) => {
          if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
          }
          const nav = document.querySelector('.nav-item[data-page="' + target + '"]');
          if (!nav) {
            console.warn('No nav-item for page:', target);
            return;
          }
          nav.click();

          // On mobile, close the sidebar if it's open
          const sidebar = document.getElementById('sidebar');
          if (sidebar && window.innerWidth <= 992) sidebar.classList.remove('active');
        };

        card.addEventListener('click', go);

        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            go(e);
          }
        });
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 7 — Brightness (Dark / Light) toggle inside the tray
     ══════════════════════════════════════════════════════════════════ */
  function initBrightness() {
    const setMode = m => {
      document.body.setAttribute('data-mode', m);
      try { localStorage.setItem('jcompass_mode', m); } catch (e) {}
      document.querySelectorAll('.mode-chip-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === m);
      });
    };

    let saved = 'dark';
    try { saved = localStorage.getItem('jcompass_mode') || 'dark'; } catch (e) {}
    setMode(saved);

    document.querySelectorAll('.mode-chip-btn').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    // Remove any leftover topbar toggle from older versions
    const oldToggle = document.getElementById('modeToggleBtn');
    if (oldToggle) oldToggle.remove();
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 8 — Init
     ══════════════════════════════════════════════════════════════════ */
  function init() {
    // Lock the "Edit Username" input in the tray
    const nameIn = document.getElementById('sidebarNameInput');
    const save = document.getElementById('saveNameBtn');
    if (nameIn) { nameIn.readOnly = true; nameIn.disabled = true; }
    if (save) save.style.display = 'none';

    // Hide team directory for staff (already handled by CSS class, but ensure it)
    const dir = document.getElementById('staffDirectoryList');
    if (dir && dir.closest('.panel-card')) dir.closest('.panel-card').classList.add('dir-panel');

    // Announcements hover-pause + auto-scroll
    const ac = document.getElementById('announcementsStreamContainer');
    if (ac) {
      ac.addEventListener('mouseenter', () => paused = true);
      ac.addEventListener('mouseleave', () => paused = false);
    }
    requestAnimationFrame(tickScroll);

    initBrightness();
    buildCabinetStats();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // Re-run when the app's stats function fires
  const origStats = window.generateDashboardStats;
  if (origStats) {
    window.generateDashboardStats = function () {
      origStats.apply(this, arguments);
      buildCabinetStats();
    };
  }

  // Re-wire brightness chips when the tray is opened (in case DOM was rebuilt)
  document.addEventListener('click', e => {
    if (e.target.closest('.settings-sidebar-btn, #settingsGearBtn, #userAvatarBtn, #topbarProfileBtn')) {
      setTimeout(initBrightness, 50);
    }
  }, true);

  // Expose for debugging
  window.__jcompass = { buildCabinetStats, subscribeLive, refreshTable };
})();

/* ══════════════════════════════════════════════════════════════════════
   Layout part: logo slot, top-right hamburger, sidebar bell
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  function buildLayout() {
    const sidebar = $('sidebar');
    const topRight = document.querySelector('.topbar-right');
    if (!sidebar) return;

    // Logo slot in the sidebar
    const brand = sidebar.querySelector('.sidebar-brand');
    if (brand && !$('brandLogoSlot')) {
      const oldIcon = brand.querySelector('.brand-icon');
      if (oldIcon) oldIcon.remove();

      const slot = document.createElement('div');
      slot.className = 'brand-logo-slot';
      slot.id = 'brandLogoSlot';
      slot.title = 'Replace favicon.ico to change the logo';

      const img = document.createElement('img');
      img.src = 'favicon.ico';
      img.alt = 'JCompass logo';
      img.onerror = () => {
        img.remove();
        slot.innerHTML = '<span class="brand-logo-placeholder">🧭</span>';
      };
      slot.appendChild(img);
      brand.insertBefore(slot, brand.firstChild);
    }

    // Top-right hamburger profile button
    if (topRight && !$('topbarProfileBtn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'topbar-menu-btn';
      btn.id = 'topbarProfileBtn';
      btn.title = 'Open workspace settings';
      btn.innerHTML =
        '<div class="hamburger-icon"><span></span><span></span><span></span></div>' +
        '<div class="topbar-avatar" id="topbarAvatar">JC</div>' +
        '<span class="topbar-name" id="topbarName">Loading…</span>';
      btn.onclick = () => {
        const settingsBtn = $('settingsSidebarBtn');
        if (settingsBtn) settingsBtn.click();
      };
      topRight.appendChild(btn);
    }

    // Sidebar burger toggle stays a classic hamburger
    const burger = $('menuToggle');
    if (burger) {
      burger.classList.remove('avatar-toggle');
      burger.innerHTML = '☰';
    }

    const chip = $('userAvatarBtn');
    if (chip) chip.classList.add('chip-hidden');

    // Mirror name / avatar from the hidden elements
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

    // Bell in the sidebar
    const nav = sidebar.querySelector('.sidebar-nav');
    if (nav && !$('sideBell')) {
      const bell = document.createElement('button');
      bell.className = 'side-bell';
      bell.id = 'sideBell';
      bell.type = 'button';
      bell.innerHTML = '🔔 <span>Notifications</span><b class="bell-badge" id="bellBadge" hidden>0</b>';
      bell.onclick = openBell;
      nav.appendChild(bell);
    }
  }

  const SEEN = 'jcompass_bell_seen';
  const num = a => parseInt(String(a.id).replace('remote-', ''), 10) || 0;

  function mine() {
    return (typeof announcements === 'undefined' || !currentUser) ? [] : announcements.filter(a =>
      a.sender !== currentUser.name && (a.target === 'ALL' || a.target === currentUser.name));
  }
  function updateBadge() {
    const b = $('bellBadge'); if (!b) return;
    let seen = 0; try { seen = parseInt(localStorage.getItem(SEEN) || '0', 10); } catch (e) {}
    const n = mine().filter(a => num(a) > seen).length;
    b.textContent = n > 99 ? '99+' : n;
    b.hidden = n === 0;
  }
  function openBell() {
    try { localStorage.setItem(SEEN, String(Math.max(0, ...announcements.map(num)))); } catch (e) {}
    updateBadge();
    const nav = document.querySelector('.nav-item[data-page="dashboard"]'); if (nav) nav.click();
    const sb = $('sidebar'); if (sb) sb.classList.remove('active');
    setTimeout(() => {
      const s = $('announcementsStreamContainer');
      if (s) s.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async OS => {
      try { if (!OS.Notifications.permission) await OS.Notifications.requestPermission(); } catch (e) {}
    });
  }

  const origStream = window.generateAnnouncementsStream;
  window.generateAnnouncementsStream = function () { origStream.apply(this, arguments); updateBadge(); };
  const origRebuild = window.rebuildApplicationDOMViews;
  window.rebuildApplicationDOMViews = function () {
    origRebuild.apply(this, arguments);
    buildLayout();
    updateBadge();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildLayout);
  else buildLayout();
})();
/* ══════════════════════════════════════════════════════════════════════
   STAFF RESTRICTIONS
   ══════════════════════════════════════════════════════════════════════ */

/* Hide "Team Members" tile for STAFF */
body[data-user-clearance="STAFF"] .stats-grid.cabinet-stats .stat-card:has(#statStaffCount) {
  display: none !important;
}
body[data-user-clearance="STAFF"] #statStaffCount {
  display: none !important;
}