/* JCompass add-on. Load AFTER app.js. Shares app.js globals (projects, supabaseClient, currentUser...). */
(function () {
  'use strict';

  // ── 1. Per-table sync (same mapping as syncAllDataFromSupabase) ─────────
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
  }

  // ── 2. Realtime subscriptions ───────────────────────────────────────────
  const timers = {};
  function subscribeLive() {
    Object.keys(T).forEach(name => {
      supabaseClient.channel(name + '-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: name }, () => {
          clearTimeout(timers[name]);
          timers[name] = setTimeout(() => refreshTable(name).catch(e => console.error('live', name, e)), 250);
        })
        .subscribe(s => { if (s === 'CHANNEL_ERROR') console.warn('Realtime error:', name); });
    });

    // Full-screen popup when a task / project is assigned to me
    supabaseClient.channel('assign-popup')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assignments' }, p => {
        if (currentUser && p.new.assignee === currentUser.name && p.new.created_by !== currentUser.name)
          showAssignPopup('New task assigned', p.new.title, 'assignments');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'projects' }, p => {
        if (currentUser && p.new.reporter === currentUser.name)
          showAssignPopup('New project assigned', p.new.title, 'dashboard');
      })
      .subscribe();
  }

  const _sub = window.subscribeRealtime;
  window.subscribeRealtime = async function () { await _sub(); subscribeLive(); };

  // Catch up after the phone/tab was asleep
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || typeof currentUser === 'undefined' || !currentUser) return;
    try { await syncAllDataFromSupabase(); rebuildApplicationDOMViews(); applyProjectColors(); } catch (e) {}
  });

  // ── 3. Full-screen assignment popup ─────────────────────────────────────
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

  // ── 4. Project status colours: green active / red overdue / yellow due soon
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
        if (d < 0) c = 'proj-late'; else if (d <= 3) c = 'proj-soon';
      }
      card.classList.add(c);
    });
  }
  ['generateProjectDashboard'].forEach(fn => {
    const orig = window[fn];
    window[fn] = function () { orig.apply(this, arguments); applyProjectColors(); };
  });

  // ── 5. Announcement auto-scroll (loops to top, 0.5 s pause) ─────────────
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

  // ── 6. Init: tiles, username lock, directory, light/dark ────────────────
  function init() {
    // clickable stat tiles
    const go = { statActiveProjects: 'dashboard', statOverdue: 'calendar', statDueSoon: 'calendar',
                 statStaffCount: 'users', statTodayCheckins: 'attend' };
    Object.entries(go).forEach(([id, page]) => {
      const v = document.getElementById(id);
      if (!v) return;
      v.classList.add('stat-link');
      v.setAttribute('role', 'button');
      v.onclick = () => { const n = document.querySelector('.nav-item[data-page="' + page + '"]'); if (n) n.click(); };
    });

    // username locked
    const nameIn = document.getElementById('sidebarNameInput'), save = document.getElementById('saveNameBtn');
    if (nameIn) { nameIn.readOnly = true; nameIn.disabled = true; }
    if (save) save.style.display = 'none';

    // team directory: admin only
    const dir = document.getElementById('staffDirectoryList');
    if (dir && dir.closest('.panel-card')) dir.closest('.panel-card').classList.add('dir-panel');

    // announcements hover-pause
    const ac = document.getElementById('announcementsStreamContainer');
    if (ac) { ac.addEventListener('mouseenter', () => paused = true); ac.addEventListener('mouseleave', () => paused = false); }
    requestAnimationFrame(tickScroll);

    // light / dark toggle in the top bar
    const setMode = m => { document.body.setAttribute('data-mode', m); try { localStorage.setItem('jcompass_mode', m); } catch (e) {} };
    setMode((function () { try { return localStorage.getItem('jcompass_mode'); } catch (e) {} })() || 'dark');
    const right = document.querySelector('.topbar-right');
    if (right) {
      const b = document.createElement('button');
      b.className = 'mode-toggle'; b.type = 'button'; b.title = 'Light / dark mode';
      const sync = () => { b.textContent = document.body.dataset.mode === 'light' ? '🌙' : '☀️'; };
      b.onclick = () => { setMode(document.body.dataset.mode === 'light' ? 'dark' : 'light'); sync(); };
      sync(); right.prepend(b);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* ── Layout part: left profile block, burger → avatar, bell in the sidebar ── */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  function buildLayout() {
    const sidebar = $('sidebar'), nav = document.querySelector('.sidebar-nav');
    if (!sidebar || !nav || $('sideProfile')) return;

    // 1) Profile block at the very top of the sidebar (name "stuck" to the side)
    const prof = document.createElement('div');
    prof.className = 'side-profile'; prof.id = 'sideProfile'; prof.title = 'Workspace settings';
    prof.innerHTML = '<div class="user-avatar" id="sideAvatar">JC</div>' +
      '<div class="side-profile-text"><div class="side-name" id="sideName">Loading…</div>' +
      '<span class="clearance-badge" id="sideRole">STAFF</span></div>';
    sidebar.insertBefore(prof, sidebar.querySelector('.sidebar-brand'));
    prof.onclick = () => { const b = $('settingsSidebarBtn'); if (b) b.click(); };

    // 2) Bell under the menu
    const bell = document.createElement('button');
    bell.className = 'side-bell'; bell.id = 'sideBell'; bell.type = 'button';
    bell.innerHTML = '🔔 <span>Notifications</span><b class="bell-badge" id="bellBadge" hidden>0</b>';
    nav.appendChild(bell);
    bell.onclick = openBell;

    // 3) Burger becomes the user avatar (opens the side panel, existing handler in app.js)
    const burger = $('menuToggle');
    if (burger) { burger.classList.add('avatar-toggle'); burger.innerHTML = '<span id="burgerAvatar">JC</span>'; }
    const chip = $('userAvatarBtn'); if (chip) chip.classList.add('chip-hidden');

    // Mirror name / role / initials from the original elements
    const mirror = () => {
      const g = id => ($(id) || {}).textContent || '';
      $('sideName').textContent = g('displayName'); $('sideRole').textContent = g('displayRole');
      $('sideAvatar').textContent = g('avatarBadgeIcon'); $('burgerAvatar').textContent = g('avatarBadgeIcon');
    };
    ['displayName', 'displayRole', 'avatarBadgeIcon'].forEach(id => {
      if ($(id)) new MutationObserver(mirror).observe($(id), { childList: true, characterData: true, subtree: true });
    });
    mirror();
  }

  // Unread badge: announcements/DMs for me that arrived since the bell was last opened
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
    b.textContent = n > 99 ? '99+' : n; b.hidden = n === 0;
  }
  function openBell() {
    try { localStorage.setItem(SEEN, String(Math.max(0, ...announcements.map(num)))); } catch (e) {}
    updateBadge();
    const nav = document.querySelector('.nav-item[data-page="dashboard"]'); if (nav) nav.click();
    const sb = $('sidebar'); if (sb) sb.classList.remove('active');
    setTimeout(() => { const s = $('announcementsStreamContainer'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 150);
    // ask for push permission the first time
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async OS => { try { if (!OS.Notifications.permission) await OS.Notifications.requestPermission(); } catch (e) {} });
  }

  const origStream = window.generateAnnouncementsStream;
  window.generateAnnouncementsStream = function () { origStream.apply(this, arguments); updateBadge(); };
  const origRebuild = window.rebuildApplicationDOMViews;
  window.rebuildApplicationDOMViews = function () { origRebuild.apply(this, arguments); buildLayout(); updateBadge(); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildLayout); else buildLayout();
})();
