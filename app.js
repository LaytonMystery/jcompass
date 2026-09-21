/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  JOURNALIST'S COMPASS v2.3                                          ║
 * ║  Supabase is the SINGLE source of truth.                            ║
 * ║  Local storage = disposable read cache only.                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 1: CONFIG
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://odqfqaywzwvxkvqptzxo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6CWGOKOIj4aXmRpidG6dVA_nYvcctoP';
const SESSION_KEY = 'jcompass_session';

const CACHE_VERSION = 'v2';
const CACHE_PREFIX  = 'jcompass_' + CACHE_VERSION + '_';

let supabaseClient = null;
let realtimePingsChannel = null;
let realtimeAttendanceChannel = null;
let realtimeArchiveChannel = null;

function initSupabaseClient() {
  if (typeof window.supabase === 'undefined') {
    console.error('JCompass: Supabase library not loaded.');
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('JCompass: Supabase client initialized.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 2: LEGACY WIPE + VERSIONED CACHE
// ═══════════════════════════════════════════════════════════════════════

function wipeLegacyCache() {
  const keep = ['jcompass_session', 'jcompass_theme'];
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (!key.startsWith('jcompass_')) continue;
    if (keep.includes(key)) continue;
    if (key.startsWith(CACHE_PREFIX)) continue;
    toRemove.push(key);
  }
  toRemove.forEach(k => {
    try { localStorage.removeItem(k); } catch (e) {}
  });
  if (toRemove.length > 0) {
    console.log('JCompass: wiped ' + toRemove.length + ' legacy cache keys.');
  }
}

const CACHE_KEYS = {
  projects:         CACHE_PREFIX + 'projects',
  assignments:      CACHE_PREFIX + 'assignments',
  beats:            CACHE_PREFIX + 'beats',
  events:           CACHE_PREFIX + 'events',
  announcements:    CACHE_PREFIX + 'announcements',
  attendance:       CACHE_PREFIX + 'attendance',
  sources:          CACHE_PREFIX + 'sources',
  archiveRequests:  CACHE_PREFIX + 'archive_requests',
  dismissedNotices: 'jcompass_dismissed_notices'
};

function cacheLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed === null || parsed === undefined) ? fallback : parsed;
  } catch (err) {
    try { localStorage.removeItem(key); } catch (e) {}
    return fallback;
  }
}

function cacheSave(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (err) { console.warn('JCompass: cache write failed for "' + key + '".', err); }
}

function cacheClearAll() {
  Object.values(CACHE_KEYS).forEach(k => {
    if (k === 'jcompass_dismissed_notices') return;
    try { localStorage.removeItem(k); } catch (e) {}
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 3: APPLICATION STATE
// ═══════════════════════════════════════════════════════════════════════

let currentUser = (function () {
  try {
    const s = window.JCOMPASS_SESSION ||
              JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return (s && s.user) ? s.user : null;
  } catch { return null; }
})();

if (!currentUser) window.location.replace('login.html');

let currentFilter = 'ALL';
let searchQuery = '';
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let sourceSearchQuery = '';
let attendanceSearchQuery = '';
let activeProfileId = null;

let projects          = [];
let assignments       = [];
let beats             = [];
let events            = [];
let announcements     = [];
let attendanceLogs    = [];
let sources           = [];
let archiveRequests   = [];
let registeredUsersDB = [];
let archivedReports   = [];
let activitySummaries = [];
let dismissedNoticeIds = cacheLoad(CACHE_KEYS.dismissedNotices, []);

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 4: CACHE FLUSH
// ═══════════════════════════════════════════════════════════════════════

function flushCachedCollections() {
  cacheSave(CACHE_KEYS.projects, projects);
  cacheSave(CACHE_KEYS.assignments, assignments);
  cacheSave(CACHE_KEYS.beats, beats);
  cacheSave(CACHE_KEYS.events, events);
  cacheSave(CACHE_KEYS.announcements, announcements);
  cacheSave(CACHE_KEYS.attendance, attendanceLogs);
  cacheSave(CACHE_KEYS.sources, sources);
  cacheSave(CACHE_KEYS.archiveRequests, archiveRequests);
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 5: SUPABASE SYNC
// ═══════════════════════════════════════════════════════════════════════

async function syncAllDataFromSupabase() {
  if (!supabaseClient) {
    console.error('JCompass: cannot sync — Supabase not initialized.');
    return;
  }
  console.log('🔄 Syncing all data from Supabase...');

  const tables = [
    {
      table: 'projects', key: 'projects',
      map: p => ({
        id: p.id, title: p.title, category: p.category, deadline: p.deadline,
        status: p.status, priority: p.priority, progress: p.progress,
        reporter: p.reporter || '', notes: p.notes || '', tags: p.tags || '',
        archived: p.archived || false
      })
    },
    {
      table: 'assignments', key: 'assignments',
      map: a => ({ id: a.id, title: a.title, assignee: a.assignee || '', archived: a.archived || false })
    },
    {
      table: 'beats', key: 'beats',
      map: b => ({
        id: b.id, name: b.name, reporter: b.reporter || '',
        priority: b.priority || 'MEDIUM', imgData: b.img_data || '',
        archived: b.archived || false
      })
    },
    {
      table: 'events', key: 'events',
      map: e => ({
        id: e.id, name: e.name, date: e.date,
        completed: e.completed || false, archived: e.archived || false,
        locationNote: e.location_note || ''
      })
    },
    {
      table: 'sources', key: 'sources',
      map: s => ({
        id: s.id, name: s.name, beat: s.beat || '', contact: s.contact || '',
        reliability: s.reliability || 'MEDIUM', notes: s.notes || '',
        createdBy: s.created_by || 'Unknown'
      })
    },
    {
      table: 'archive_requests', key: 'archiveRequests',
      map: r => ({
        id: r.id,
        project_id: r.project_id,
        project_title: r.project_title || '',
        requester: r.requester,
        request_timestamp: r.request_timestamp || '',
        status: r.status || 'PENDING'
      })
    }
  ];

  for (const { table, key, map } of tables) {
    try {
      const { data, error } = await supabaseClient
        .from(table).select('*').order('id', { ascending: true });
      if (error) throw error;
      window[key] = (data || []).map(map);
    } catch (err) {
      console.error(`Sync "${table}" failed:`, err);
    }
  }

  try {
    const { data, error } = await supabaseClient.rpc('list_users');
    if (error) throw error;
    registeredUsersDB = (data || []).map(u => ({
      id: u.id, name: u.name, role: u.role, code: u.code,
      created: u.created_at
        ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—'
    }));
    console.log(`   ✓ Users: ${registeredUsersDB.length}`);
  } catch (err) {
    console.error('Sync "users" failed:', err);
    registeredUsersDB = [];
  }

  try {
    const { data, error } = await supabaseClient
      .from('attendance').select('*')
      .order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    attendanceLogs = (data || []).map(row => ({
      id: 'remote-' + row.id,
      reporter: row.reporter, role: row.role,
      date: row.date, time: row.time,
      lat: row.lat, lon: row.lon, accuracy: row.accuracy,
      location: row.location, note: row.note || '',
      timestamp: row.timestamp_iso
    }));
  } catch (err) {
    console.error('Sync "attendance" failed:', err);
  }

  try {
    const { data, error } = await supabaseClient
      .from('pings').select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    announcements = (data || []).map(row => ({
      id: 'remote-' + row.id,
      sender: row.sender, target: row.target, text: row.message,
      timestamp: new Date(row.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      })
    }));
  } catch (err) {
    console.error('Sync "pings" failed:', err);
  }

  flushCachedCollections();
  console.log('✅ Sync complete.');
}

async function subscribeRealtime() {
  if (!supabaseClient) return;

  if (realtimePingsChannel) supabaseClient.removeChannel(realtimePingsChannel);
  realtimePingsChannel = supabaseClient
    .channel('pings-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings' }, (payload) => {
      const row = payload.new;
      const id = 'remote-' + row.id;
      if (announcements.some(a => a.id === id)) return;
      const ann = {
        id, sender: row.sender, target: row.target, text: row.message,
        timestamp: new Date(row.created_at).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric'
        })
      };
      announcements.push(ann);
      flushCachedCollections();
      generateAnnouncementsStream();
      notifyIncomingPing(ann);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'pings' }, (payload) => {
      const id = 'remote-' + payload.old.id;
      announcements = announcements.filter(a => a.id !== id);
      flushCachedCollections();
      generateAnnouncementsStream();
    })
    .subscribe();

  if (realtimeAttendanceChannel) supabaseClient.removeChannel(realtimeAttendanceChannel);
  realtimeAttendanceChannel = supabaseClient
    .channel('attendance-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, (payload) => {
      const row = payload.new;
      const id = 'remote-' + row.id;
      if (attendanceLogs.some(a => a.id === id)) return;
      attendanceLogs.unshift({
        id, reporter: row.reporter, role: row.role,
        date: row.date, time: row.time,
        lat: row.lat, lon: row.lon, accuracy: row.accuracy,
        location: row.location, note: row.note || '',
        timestamp: row.timestamp_iso
      });
      flushCachedCollections();
      renderAttendanceTable();
      updateAttendanceStats();
    })
    .subscribe();

  if (realtimeArchiveChannel) supabaseClient.removeChannel(realtimeArchiveChannel);
  realtimeArchiveChannel = supabaseClient
    .channel('archive-requests-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'archive_requests' }, async () => {
      try {
        const { data } = await supabaseClient.from('archive_requests').select('*').order('id', { ascending: true });
        archiveRequests = (data || []).map(r => ({
          id: r.id, project_id: r.project_id,
          project_title: r.project_title || '',
          requester: r.requester,
          request_timestamp: r.request_timestamp || '',
          status: r.status || 'PENDING'
        }));
        flushCachedCollections();
        renderArchiveRequestsPanel();
      } catch (e) { /* silent */ }
    })
    .subscribe();
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 6: NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════

function refreshNotificationPermissionUI() {
  const btn = document.getElementById('enableNotificationsBtn');
  const label = document.getElementById('notificationStatusLabel');
  if (!btn || !label || !('Notification' in window)) {
    if (label) label.textContent = 'Push alerts not supported.';
    if (btn) btn.style.display = 'none';
    return;
  }
  if (Notification.permission === 'granted') {
    btn.textContent = '🔔 Push Alerts Enabled';
    btn.disabled = true;
    label.textContent = 'You will get device popups for new pings.';
  } else if (Notification.permission === 'denied') {
    btn.textContent = '🔕 Push Alerts Blocked';
    btn.disabled = true;
    label.textContent = 'Notifications blocked in browser.';
  } else {
    btn.textContent = '🔔 Enable Push Alerts';
    btn.disabled = false;
    label.textContent = 'Not enabled yet.';
  }
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(() => refreshNotificationPermissionUI());
}

function notifyIncomingPing(ann) {
  if (!currentUser) return;
  const isPingedToMe = ann.target === currentUser.name;
  const isBroadcastAll = ann.target === 'ALL';
  if (!isPingedToMe && !isBroadcastAll) return;
  if (ann.sender === currentUser.name) return;

  const title = isBroadcastAll ? 'JCompass — @All Desks' : 'JCompass — Direct Ping';
  const body = ann.sender + ': ' + ann.text;
  const canShowNative = ('Notification' in window) && Notification.permission === 'granted';

  if (canShowNative && document.hidden) {
    const n = new Notification(title, {
      body, icon: 'https://cdn-icons-png.flaticon.com/512/148/148813.png'
    });
    n.onclick = () => { window.focus(); n.close(); };
  } else {
    triggerNotificationToast(body);
  }
}

function triggerNotificationToast(strMessage) {
  const popToast = document.getElementById('toast');
  if (!popToast) return;
  popToast.innerText = strMessage;
  popToast.classList.add('active');
  setTimeout(() => { popToast.classList.remove('active'); }, 3000);
}

async function dispatchPing(sender, target, text) {
  if (!supabaseClient) {
    triggerNotificationToast('Backend unavailable.');
    return;
  }
  try {
    const { error } = await supabaseClient.from('pings').insert({
      sender, target, message: text
    });
    if (error) throw error;
  } catch (err) {
    console.error('Publish ping failed:', err);
    triggerNotificationToast('Failed to send: ' + err.message);
    return;
  }

  if (typeof sendPushNotification === 'function') {
    if (target === 'ALL') {
      sendPushNotification('📰 Newsroom Broadcast', sender + ': ' + text);
    } else {
      sendPushNotification('📌 Direct Ping from ' + sender, text, target);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 7: AUTH / SESSION
// ═══════════════════════════════════════════════════════════════════════

async function enforceSessionGuard() {
  if (!currentUser) return;
  document.body.setAttribute('data-user-clearance', currentUser.role);

  cacheClearAll();
  try { await syncAllDataFromSupabase(); }
  catch (err) { console.error('Sync failed:', err); }

  evaluateClearancePermissions();
  rebuildApplicationDOMViews();
  subscribeRealtime();

  if (typeof setOneSignalUser === 'function') setOneSignalUser(currentUser.name);
}

function evaluateClearancePermissions() {
  if (!currentUser) return;

  const targetLabel  = document.getElementById('displayName');
  const targetRole   = document.getElementById('displayRole');
  const avatarBadge  = document.getElementById('avatarBadgeIcon');
  const sidebarInput = document.getElementById('sidebarNameInput');

  if (targetLabel) targetLabel.innerText = currentUser.name;
  if (targetRole) targetRole.innerText = currentUser.role;
  if (avatarBadge) avatarBadge.innerText = currentUser.code || 'JC';
  if (sidebarInput) sidebarInput.value = currentUser.name;

  document.querySelectorAll('.admin-only-nav').forEach(el => {
    el.style.display = (currentUser.role === 'ADMIN') ? '' : 'none';
  });

  const pingSelect = document.getElementById('announcePingTarget');
  if (pingSelect) {
    pingSelect.innerHTML = '<option value="ALL">@All Desks</option>';
    registeredUsersDB.forEach(u => {
      if (u.role === 'STAFF') {
        pingSelect.innerHTML += '<option value="' + u.name + '">⚡ Ping: ' + u.name + '</option>';
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 8: MASTER REBUILD
// ═══════════════════════════════════════════════════════════════════════

function rebuildApplicationDOMViews() {
  generateDashboardStats();
  generateProjectDashboard();
  generateAnnouncementsStream();
  generateStaffDirectory();
  generateBeatsGrid();
  generateAssignmentsGrid();
  generateEventsTrackerChecklist();
  generateDeadlineCalendarGrid();
  initAttendancePage();
  generateArchiveGrid();
  renderArchiveRequestsPanel();
  generateArchiveReportsGrid();
  generateActivitySummaryGrid();
  generateSourcesGrid();
  generateUsersTable();
  generateNotificationBar();
  injectAdminClearButtons();
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 9: DASHBOARD STATS + PROJECTS
// ═══════════════════════════════════════════════════════════════════════

function generateDashboardStats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const active = projects.filter(p => !p.archived);
  const overdue = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    return new Date(p.deadline) < today;
  });
  const dueSoon = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    const d = new Date(p.deadline);
    const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 3;
  });
  const staffCount = registeredUsersDB.filter(u => u.role === 'STAFF').length;
  const todayStr = today.toLocaleDateString('en-CA');
  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  set('statActiveProjects', active.length);
  set('statOverdue', overdue.length);
  set('statDueSoon', dueSoon.length);
  set('statStaffCount', staffCount);
  set('statTodayCheckins', todayCheckins);
}

function generateProjectDashboard() {
  const container = document.getElementById('projectGrid');
  if (!container) return;
  container.innerHTML = '';

  const subset = projects.filter(item => {
    if (item.archived) return false;
    const matchesFilter = (currentFilter === 'ALL' || item.category === currentFilter);
    const matchesSearch = (item.title || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  if (subset.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1; text-align:center; color:var(--text-muted);">No projects found.</div>';
    return;
  }

  subset.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card card-interactive';

    let statusClass = 'status-active';
    if (p.status === 'IN REVIEW') statusClass = 'status-review';
    if (p.status === 'FILED') statusClass = 'status-filed';
    if (p.status === 'ON HOLD') statusClass = 'status-on-hold';
    if (p.status === 'PUBLISHED') statusClass = 'status-published';

    const tagsHtml = p.tags
      ? p.tags.split(',').filter(t => t.trim()).map(t => '<span class="card-tag">' + t.trim() + '</span>').join('')
      : '';
    const reporterHtml = p.reporter
      ? '<div class="card-reporter-chip"><div class="mini-avatar">' + p.reporter.split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase() + '</div><span>' + p.reporter + '</span></div>'
      : '';

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;"><div class="card-category">' + (p.category || '') + '</div><span style="font-size:0.7rem;font-weight:800;">' + (p.priority || 'MEDIUM') + '</span></div>' +
      '<div class="card-title">' + p.title + '</div>' +
      reporterHtml +
      (tagsHtml ? '<div class="card-tags">' + tagsHtml + '</div>' : '') +
      '<div class="card-meta"><span>📅 ' + (p.deadline || '—') + '</span><span class="status-badge ' + statusClass + '">' + (p.status || 'ACTIVE') + '</span></div>' +
      '<div class="card-actions"><button class="card-action-btn profile-btn" data-id="' + p.id + '">📋 View</button></div>';
    container.appendChild(card);
  });

  container.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProjectProfile(parseInt(btn.dataset.id));
    });
  });
}

function openProjectProfile(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  activeProfileId = projectId;

  document.getElementById('profileModalCategory').innerText = p.category || '';
  document.getElementById('profileModalTitle').innerText = p.title;
  document.getElementById('profileModalStatus').innerText = p.status;
  document.getElementById('profileModalDeadline').innerText = p.deadline || '—';
  document.getElementById('profileProgressBar').style.width = (p.progress || 0) + '%';
  document.getElementById('profileProgressLabel').innerText = (p.progress || 0) + '%';
  document.getElementById('profileProgressInput').value = p.progress || 0;
  document.getElementById('profileAssignedReporter').value = p.reporter || '';
  document.getElementById('profileNotes').value = p.notes || '';
  document.getElementById('profileTags').value = p.tags || '';
  document.getElementById('profileStatusSelect').value = p.status || 'ACTIVE';

  // Highlight current priority button
  document.querySelectorAll('.priority-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === (p.priority || 'MEDIUM'));
  });

  applyProfilePermissions(p);
  document.getElementById('projectProfileModal').classList.add('active');
}

function applyProfilePermissions(p) {
  const isAdmin = currentUser.role === 'ADMIN';

  const archiveBtn = document.getElementById('profileArchiveBtn');
  const deleteBtn  = document.getElementById('profileDeleteBtn');
  const requestBtn = document.getElementById('profileRequestArchiveBtn');
  const staffNotice = document.getElementById('profileStaffNotice');
  const saveBtn = document.getElementById('profileSaveBtn');

  if (archiveBtn) archiveBtn.style.display = isAdmin ? '' : 'none';
  if (deleteBtn)  deleteBtn.style.display  = isAdmin ? '' : 'none';
  if (saveBtn)    saveBtn.style.display    = isAdmin ? '' : 'none';
  if (staffNotice) staffNotice.style.display = isAdmin ? 'none' : 'flex';

  ['profileProgressInput','profileAssignedReporter','profileNotes','profileTags','profileStatusSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isAdmin;
  });

  // Priority buttons: read-only for staff
  document.querySelectorAll('.priority-select-btn').forEach(btn => {
    btn.disabled = !isAdmin;
    btn.style.cursor = isAdmin ? 'pointer' : 'not-allowed';
    btn.style.opacity = isAdmin ? '1' : '0.5';
  });

  if (requestBtn) {
    if (isAdmin) {
      requestBtn.style.display = 'none';
    } else {
      const hasPending = archiveRequests.some(
        r => r.project_id === p.id &&
             r.requester === currentUser.name &&
             r.status === 'PENDING'
      );
      requestBtn.style.display = '';
      if (hasPending) {
        requestBtn.disabled = true;
        requestBtn.innerText = '⏳ Request Pending';
      } else {
        requestBtn.disabled = false;
        requestBtn.innerText = '📤 Request Archive';
      }
    }
  }
}

async function saveProjectProfile() {
  const p = projects.find(x => x.id === activeProfileId);
  if (!p) return;
  if (currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin clearance required.');
    return;
  }

  const activePriorityBtn = document.querySelector('.priority-select-btn.active');
  const priority = activePriorityBtn ? activePriorityBtn.dataset.priority : 'MEDIUM';

  const updates = {
    progress: parseInt(document.getElementById('profileProgressInput').value) || 0,
    reporter: document.getElementById('profileAssignedReporter').value.trim(),
    notes: document.getElementById('profileNotes').value.trim(),
    tags: document.getElementById('profileTags').value.trim(),
    status: document.getElementById('profileStatusSelect').value,
    priority: priority
  };

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('projects')
        .update(updates)
        .eq('id', p.id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Update blocked by Supabase (check RLS policy on projects).');
      }
    } catch (err) {
      console.error('Update project failed:', err);
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  Object.assign(p, updates);
  flushCachedCollections();
  rebuildApplicationDOMViews();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('✓ Project profile saved.');
}

async function archiveProject(projectId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin clearance required.');
    return;
  }
  const p = projects.find(x => x.id === projectId);
  if (!p) { triggerNotificationToast('Project not found.'); return; }

  if (!confirm('Archive "' + p.title + '"? It will move to Project Archive.')) return;

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('projects').update({ archived: true }).eq('id', projectId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked by Supabase.');
    } catch (err) {
      triggerNotificationToast('Archive failed: ' + err.message);
      return;
    }
  }

  p.archived = true;
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Project archived.');
}

async function deleteProject(projectId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin clearance required.');
    return;
  }
  const p = projects.find(x => x.id === projectId);
  if (!p) { triggerNotificationToast('Project not found.'); return; }

  if (!confirm('Permanently delete "' + p.title + '"? This cannot be undone.')) return;

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('projects').delete().eq('id', projectId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Delete blocked by Supabase.');
    } catch (err) {
      triggerNotificationToast('Delete failed: ' + err.message);
      return;
    }
  }

  projects = projects.filter(x => x.id !== projectId);
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Project deleted.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 10: ARCHIVE REQUESTS
// ═══════════════════════════════════════════════════════════════════════

async function submitArchiveRequest(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) { triggerNotificationToast('Project not found.'); return; }

  const hasPending = archiveRequests.some(
    r => r.project_id === projectId && r.requester === currentUser.name && r.status === 'PENDING'
  );
  if (hasPending) { triggerNotificationToast('You already have a pending request.'); return; }

  const payload = {
    project_id: projectId,
    project_title: p.title,
    requester: currentUser.name,
    request_timestamp: new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }),
    status: 'PENDING'
  };

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('archive_requests').insert(payload).select().single();
      if (error) throw error;
      payload.id = data ? data.id : Date.now();
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  } else { payload.id = Date.now(); }

  archiveRequests.push(payload);
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('✓ Archive request submitted.');
}

async function approveArchiveRequest(requestId) {
  if (currentUser.role !== 'ADMIN') return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  if (!confirm('Approve this request? The project will be archived.')) return;

  if (supabaseClient) {
    try {
      const { error: reqErr } = await supabaseClient
        .from('archive_requests').update({ status: 'APPROVED' }).eq('id', requestId);
      if (reqErr) throw reqErr;

      const { error: projErr } = await supabaseClient
        .from('projects').update({ archived: true }).eq('id', req.project_id);
      if (projErr) throw projErr;
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  req.status = 'APPROVED';
  const p = projects.find(x => x.id === req.project_id);
  if (p) p.archived = true;

  flushCachedCollections();
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Archive request approved.');
}

async function denyArchiveRequest(requestId) {
  if (currentUser.role !== 'ADMIN') return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  if (!confirm('Deny this archive request?')) return;

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('archive_requests').update({ status: 'DENIED' }).eq('id', requestId);
      if (error) throw error;
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  req.status = 'DENIED';
  flushCachedCollections();
  renderArchiveRequestsPanel();
  triggerNotificationToast('Archive request denied.');
}

function ensureArchiveRequestsPanel() {
  if (document.getElementById('archiveRequestsPanel')) return;
  const grid = document.getElementById('archiveGrid');
  if (!grid) return;
  const panel = document.createElement('div');
  panel.id = 'archiveRequestsPanel';
  panel.className = 'archive-requests-panel';
  panel.style.display = 'none';
  grid.parentNode.insertBefore(panel, grid);
}

function renderArchiveRequestsPanel() {
  ensureArchiveRequestsPanel();
  const panel = document.getElementById('archiveRequestsPanel');
  if (!panel) return;

  if (!currentUser || currentUser.role !== 'ADMIN') {
    panel.style.display = 'none';
    return;
  }

  const pending = archiveRequests.filter(r => r.status === 'PENDING');
  if (pending.length === 0) { panel.style.display = 'none'; return; }

  panel.style.display = 'block';
  panel.innerHTML =
    '<div class="archive-req-header">' +
      '<span>📥 Pending Archive Requests</span>' +
      '<span class="archive-req-count">' + pending.length + '</span>' +
    '</div>' +
    '<div class="archive-req-list">' +
      pending.map(r =>
        '<div class="archive-req-row">' +
          '<div class="archive-req-info">' +
            '<div style="font-weight:700;font-size:0.9rem;">' + r.project_title + '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-muted);">Requested by <b>' + r.requester + '</b> • ' + (r.request_timestamp || '') + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">' +
            '<button class="req-approve-btn" data-req-approve="' + r.id + '">✓ Approve</button>' +
            '<button class="req-deny-btn" data-req-deny="' + r.id + '">✕ Deny</button>' +
          '</div>' +
        '</div>'
      ).join('') +
    '</div>';

  panel.querySelectorAll('[data-req-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveArchiveRequest(parseInt(btn.dataset.reqApprove)));
  });
  panel.querySelectorAll('[data-req-deny]').forEach(btn => {
    btn.addEventListener('click', () => denyArchiveRequest(parseInt(btn.dataset.reqDeny)));
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 11: ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════

function generateAnnouncementsStream() {
  const container = document.getElementById('announcementsStreamContainer');
  if (!container) return;
  container.innerHTML = '';

  const reversed = [...announcements].reverse();
  const isAdmin = currentUser && currentUser.role === 'ADMIN';

  reversed.forEach(ann => {
    const isPingedToMe = currentUser && ann.target === currentUser.name;
    const isBroadcastAll = ann.target === 'ALL';
    const isMine = currentUser && ann.sender === currentUser.name;
    if (!isBroadcastAll && !isPingedToMe && !isAdmin) return;

    const canDelete = isAdmin || isMine;

    const node = document.createElement('div');
    node.className = 'announcement-node' + (isPingedToMe ? ' pinged' : '');
    node.innerHTML =
      (canDelete ? '<button class="announcement-delete-btn" title="Delete" data-ann-id="' + ann.id + '">✕</button>' : '') +
      '<div class="announcement-meta"><span class="announcement-badge-alert">' + (isBroadcastAll ? 'NEWS FLASH' : 'DIRECT PING') + '</span><span>By <b>' + ann.sender + '</b></span><span>•</span><span>' + ann.timestamp + '</span></div>' +
      '<div class="announcement-body">' + ann.text + '</div>';
    container.appendChild(node);
  });

  if (container.children.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">No announcements.</div>';
  }

  container.querySelectorAll('[data-ann-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteAnnouncement(btn.dataset.annId);
    });
  });
}

async function deleteAnnouncement(annId) {
  if (!confirm('Delete this announcement?')) return;

  if (String(annId).startsWith('remote-') && supabaseClient) {
    const remoteId = parseInt(String(annId).replace('remote-', ''), 10);
    try {
      const { error } = await supabaseClient.from('pings').delete().eq('id', remoteId);
      if (error) throw error;
    } catch (err) {
      triggerNotificationToast('Failed to delete from backend.');
      return;
    }
  }

  announcements = announcements.filter(a => String(a.id) !== String(annId));
  flushCachedCollections();
  generateAnnouncementsStream();
  triggerNotificationToast('Announcement deleted.');
}

function generateStaffDirectory() {
  const container = document.getElementById('staffDirectoryList');
  if (!container) return;
  container.innerHTML = '';

  if (registeredUsersDB.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">No personnel loaded.</div>';
    return;
  }

  registeredUsersDB.forEach(user => {
    const row = document.createElement('div');
    row.className = 'staff-directory-row' + (user.role === 'ADMIN' ? ' role-admin' : '');
    row.innerHTML =
      '<div class="staff-info-block"><div class="staff-avatar-mini">' + user.code + '</div><div class="staff-details"><span class="staff-row-name">' + user.name + '</span><span class="staff-row-role">' + user.role + '</span></div></div>';
    container.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 12: BEATS
// ═══════════════════════════════════════════════════════════════════════

function generateBeatsGrid() {
  const container = document.getElementById('beatsGrid');
  if (!container) return;
  container.innerHTML = '';

  const visible = beats.filter(b => !b.archived);
  const isAdmin = currentUser && currentUser.role === 'ADMIN';

  if (visible.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No beats configured yet.</div>';
    return;
  }

  visible.forEach(b => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<span class="priority-flag priority-' + b.priority + '">' + b.priority + '</span>' +
      '<div class="card-title">' + b.name + '</div>' +
      '<div style="font-size:0.85rem;color:var(--text-muted);">Reporter: <b>' + b.reporter + '</b></div>' +
      (isAdmin
        ? '<div class="card-action-row"><button class="card-action-btn archive-btn" data-beat-id="' + b.id + '">🗄 Archive</button></div>'
        : '');
    container.appendChild(card);
  });

  container.querySelectorAll('[data-beat-id]').forEach(btn => {
    btn.addEventListener('click', () => archiveBeat(parseInt(btn.dataset.beatId)));
  });
}

async function archiveBeat(beatId) {
  if (!confirm('Archive this beat? It will be hidden from the grid.')) return;
  const b = beats.find(x => x.id === beatId);
  if (!b) return;

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('beats').update({ archived: true }).eq('id', beatId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked by Supabase.');
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  b.archived = true;
  flushCachedCollections();
  generateBeatsGrid();
  triggerNotificationToast('Beat archived.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 13: ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════════════

function generateAssignmentsGrid() {
  const container = document.getElementById('assignmentsGrid');
  if (!container) return;
  container.innerHTML = '';

  const visible = assignments.filter(a => !a.archived);
  const isAdmin = currentUser && currentUser.role === 'ADMIN';

  if (visible.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No assignments yet.</div>';
    return;
  }

  visible.forEach(a => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-title" style="font-size:1.05rem;">' + a.title + '</div>' +
      '<div style="font-size:0.85rem;color:var(--text-muted);">Assignee: <b>' + a.assignee + '</b></div>' +
      (isAdmin
        ? '<div class="card-action-row"><button class="card-action-btn archive-btn" data-asg-id="' + a.id + '">🗄 Archive</button></div>'
        : '');
    container.appendChild(card);
  });

  container.querySelectorAll('[data-asg-id]').forEach(btn => {
    btn.addEventListener('click', () => archiveAssignment(parseInt(btn.dataset.asgId)));
  });
}

async function archiveAssignment(asgId) {
  if (!confirm('Archive this assignment?')) return;
  const a = assignments.find(x => x.id === asgId);
  if (!a) return;

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('assignments').update({ archived: true }).eq('id', asgId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked by Supabase.');
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  a.archived = true;
  flushCachedCollections();
  generateAssignmentsGrid();
  triggerNotificationToast('Assignment archived.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 14: EVENTS & CALENDAR
// ═══════════════════════════════════════════════════════════════════════

function generateEventsTrackerChecklist() {
  const container = document.getElementById('eventsChecklistContainer');
  if (!container) return;
  container.innerHTML = '';

  if (events.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">No events scheduled.</div>';
    return;
  }

  events.forEach(evt => {
    const div = document.createElement('div');
    div.className = 'event-row' + (evt.completed ? ' done' : '');
    div.innerHTML =
      '<div><div style="font-weight:600;">' + evt.name + '</div>' +
      '<div style="font-size:0.75rem;color:var(--text-muted);">' + (evt.date || '') + '</div></div>';
    container.appendChild(div);
  });
}

function generateDeadlineCalendarGrid() {
  const container = document.getElementById('calendarMatrixLayout');
  const monthYearLabel = document.getElementById('calMonthYear');
  if (!container) return;
  container.innerHTML = '';

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  if (monthYearLabel) monthYearLabel.innerText = monthNames[calendarMonth] + ' ' + calendarYear;

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell';
    empty.style.opacity = '0.3';
    container.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.innerHTML = '<div class="cal-num">' + day + '</div>';
    const dateStr = calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    projects.filter(p => p.deadline === dateStr && !p.archived).forEach(p => {
      const entry = document.createElement('div');
      entry.className = 'cal-entry';
      entry.innerText = p.title;
      cell.appendChild(entry);
    });
    container.appendChild(cell);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 15: ATTENDANCE
// ═══════════════════════════════════════════════════════════════════════

function renderAttendanceTable() {
  const tbody = document.getElementById('attendanceTableBody');
  const emptyRow = document.getElementById('attendanceEmptyRow');
  if (!tbody) return;

  Array.from(tbody.querySelectorAll('tr:not(#attendanceEmptyRow)')).forEach(r => r.remove());

  const subset = attendanceLogs.filter(log =>
    (log.reporter || '').toLowerCase().includes(attendanceSearchQuery.toLowerCase()) ||
    (log.date || '').includes(attendanceSearchQuery) ||
    (log.location && log.location.toLowerCase().includes(attendanceSearchQuery.toLowerCase()))
  );

  if (subset.length === 0) {
    if (emptyRow) emptyRow.style.display = '';
    return;
  }
  if (emptyRow) emptyRow.style.display = 'none';

  subset.slice(0, 100).forEach((log, idx) => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    tr.innerHTML =
      '<td style="padding:0.75rem 1.5rem;">' + (idx + 1) + '</td>' +
      '<td style="padding:0.75rem 1rem;font-weight:600;">' + log.reporter + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + log.date + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + log.time + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + log.lat + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + log.lon + '</td>' +
      '<td style="padding:0.75rem 1rem;">±' + log.accuracy + 'm</td>' +
      '<td style="padding:0.75rem 1rem;">' + (log.location || '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + (log.note || '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + log.role + '</td>' +
      '<td style="padding:0.75rem 1rem;">🗺️</td>';
    tbody.appendChild(tr);
  });
}

function updateAttendanceStats() {
  const today = new Date().toLocaleDateString('en-CA');
  const todayCount = attendanceLogs.filter(l => l.date === today).length;
  const statToday = document.getElementById('statTodayCount');
  const statTotal = document.getElementById('statTotalCount');
  if (statToday) statToday.innerText = todayCount;
  if (statTotal) statTotal.innerText = attendanceLogs.length;
}

function startLiveClock() {
  const clockEl = document.getElementById('liveClock');
  const dateEl = document.getElementById('liveDate');
  if (!clockEl) return;

  function tick() {
    const now = new Date();
    clockEl.innerText = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (dateEl) dateEl.innerText = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  tick();
  setInterval(tick, 1000);
}

function hasCheckedInToday() {
  if (!currentUser) return false;
  const today = new Date().toLocaleDateString('en-CA');
  return attendanceLogs.some(log => log.reporter === currentUser.name && log.date === today);
}

async function reverseGeocodeLabel(lat, lon) {
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lon);
    const data = await res.json();
    const a = data.address || {};
    return a.suburb || a.village || a.town || a.city || a.county || a.state || 'Unknown Location';
  } catch { return 'Location unavailable'; }
}

async function processFieldTelemetryMarking() {
  const btn = document.getElementById('markAttendanceBtn');
  if (!btn || !currentUser) return;

  if (hasCheckedInToday()) {
    triggerNotificationToast('Already checked in today.');
    return;
  }

  btn.disabled = true;
  btn.innerText = '⏳ Locating...';

  if (!navigator.geolocation) {
    triggerNotificationToast('Geolocation not supported.');
    btn.disabled = false;
    btn.innerText = '📍 Timestamp Geo-Presence Profile';
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;
    const now = new Date();
    const locationLabel = await reverseGeocodeLabel(lat, lon);
    const noteInput = document.getElementById('attendanceLocationNote');
    const note = noteInput ? noteInput.value.trim() : '';

    const entry = {
      reporter: currentUser.name, role: currentUser.role,
      date: now.toLocaleDateString('en-CA'),
      time: now.toLocaleTimeString('en-US', { hour12: true }),
      lat: lat.toFixed(6), lon: lon.toFixed(6),
      accuracy: Math.round(accuracy),
      location: locationLabel, note,
      timestamp: now.toISOString()
    };

    if (supabaseClient) {
      try {
        const { error } = await supabaseClient.from('attendance').insert({
          reporter: entry.reporter, role: entry.role,
          date: entry.date, time: entry.time,
          lat: parseFloat(entry.lat), lon: parseFloat(entry.lon),
          accuracy: entry.accuracy,
          location: entry.location, note: entry.note,
          timestamp_iso: entry.timestamp
        });
        if (error) throw error;
      } catch (err) {
        triggerNotificationToast('Backend error: ' + err.message);
        btn.disabled = false;
        btn.innerText = '📍 Timestamp Geo-Presence Profile';
        return;
      }
    }

    attendanceLogs.unshift({ id: 'remote-pending', ...entry });
    flushCachedCollections();
    renderAttendanceTable();
    updateAttendanceStats();
    btn.disabled = false;
    btn.innerText = '✓ Checked In';
    triggerNotificationToast('Attendance logged: ' + entry.time);
  }, () => {
    btn.disabled = false;
    btn.innerText = '📍 Timestamp Geo-Presence Profile';
    triggerNotificationToast('Location access denied.');
  }, { enableHighAccuracy: true, timeout: 12000 });
}

function initAttendancePage() {
  startLiveClock();
  renderAttendanceTable();
  updateAttendanceStats();
  if (hasCheckedInToday()) {
    const btn = document.getElementById('markAttendanceBtn');
    if (btn) { btn.innerText = '✓ Checked In Today'; btn.style.background = 'var(--success)'; }
  }
}

async function clearAttendanceLog() {
  if (currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin clearance required.');
    return;
  }
  if (!confirm('Permanently clear ALL attendance records?')) return;

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('attendance').delete().neq('id', -1);
      if (error) throw error;
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  attendanceLogs = [];
  flushCachedCollections();
  renderAttendanceTable();
  updateAttendanceStats();
  triggerNotificationToast('Attendance log cleared.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 16: ARCHIVE GRID
// ═══════════════════════════════════════════════════════════════════════

function generateArchiveGrid() {
  const container = document.getElementById('archiveGrid');
  const countBadge = document.getElementById('archiveCountBadge');
  if (!container) return;
  container.innerHTML = '';

  const archived = projects.filter(p => p.archived);
  if (countBadge) countBadge.innerText = archived.length + ' archived';

  if (archived.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No archived projects.</div>';
    return;
  }

  archived.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card archived-card';
    card.innerHTML =
      '<div class="card-category">' + (p.category || '') + '</div>' +
      '<div class="card-title">' + p.title + '</div>' +
      '<div class="card-meta"><span>📅 ' + (p.deadline || '—') + '</span><span>' + (p.status || '') + '</span></div>';
    container.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 17: ARCHIVED REPORTS (clear button lives in header)
// ═══════════════════════════════════════════════════════════════════════

function generateArchiveReportsGrid() {
  const container = document.getElementById('archiveReportsGrid');
  const countBadge = document.getElementById('archiveReportsCountBadge');
  if (!container) return;
  container.innerHTML = '';

  if (countBadge) countBadge.innerText = archivedReports.length + ' filed';

  if (archivedReports.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No reports filed yet.</div>';
    return;
  }

  archivedReports.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-title">' + (r.title || 'Report') + '</div>' +
      '<div style="font-size:0.85rem;color:var(--text-muted); white-space:pre-line; line-height:1.5;">' + (r.summary || '') + '</div>' +
      '<div style="font-size:0.72rem;color:var(--text-muted); margin-top:0.5rem;">Filed by <b>' + (r.closedBy || 'Unknown') + '</b>' +
      (r.timestamp ? ' • ' + r.timestamp : '') + '</div>';
    container.appendChild(card);
  });
}

function clearArchivedReports() {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin clearance required.');
    return;
  }
  if (archivedReports.length === 0) {
    triggerNotificationToast('No reports to clear.');
    return;
  }
  if (!confirm('Clear all ' + archivedReports.length + ' closed-out report(s)? This cannot be undone.')) return;

  archivedReports = [];
  generateArchiveReportsGrid();
  triggerNotificationToast('✓ Reports cleared.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 18: ACTIVITY SUMMARY (clear button + real recap)
// ═══════════════════════════════════════════════════════════════════════

function generateActivitySummaryGrid() {
  const container = document.getElementById('activitySummaryGrid');
  const countBadge = document.getElementById('activitySummaryCountBadge');
  if (!container) return;
  container.innerHTML = '';

  if (countBadge) countBadge.innerText = activitySummaries.length + ' generated';

  if (activitySummaries.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No summaries generated.</div>';
    return;
  }

  activitySummaries.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-title">' + (r.title || 'Summary') + '</div>' +
      '<div style="font-size:0.82rem; color:var(--text-muted); white-space:pre-line; line-height:1.6; font-family:var(--font-body);">' + (r.summary || '') + '</div>' +
      '<div style="font-size:0.72rem;color:var(--text-muted); margin-top:0.75rem;">Generated by <b>' + (r.generatedBy || 'Unknown') + '</b>' +
      (r.timestamp ? ' • ' + new Date(r.timestamp).toLocaleString('en-US') : '') + '</div>';
    container.appendChild(card);
  });
}

function clearActivitySummaries() {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin clearance required.');
    return;
  }
  if (activitySummaries.length === 0) {
    triggerNotificationToast('No summaries to clear.');
    return;
  }
  if (!confirm('Clear all ' + activitySummaries.length + ' generated summary(ies)? This cannot be undone.')) return;

  activitySummaries = [];
  generateActivitySummaryGrid();
  triggerNotificationToast('✓ Summaries cleared.');
}

function generateActivitySummaryReport() {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin clearance required.');
    return;
  }

  const now = new Date();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = now.toLocaleDateString('en-CA');

  const activeProjects = projects.filter(p => !p.archived);
  const archivedProjects = projects.filter(p => p.archived);

  const overdue = activeProjects.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    return new Date(p.deadline) < today;
  });
  const dueSoon = activeProjects.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    const diff = Math.ceil((new Date(p.deadline) - today) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 3;
  });

  const staffCount = registeredUsersDB.filter(u => u.role === 'STAFF').length;
  const adminCount = registeredUsersDB.filter(u => u.role === 'ADMIN').length;

  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr);
  const recentLocation = todayCheckins[0] ? todayCheckins[0].location : 'No activity today';

  const pendingArchive = archiveRequests.filter(r => r.status === 'PENDING').length;

  // Top reporters by active project count
  const reporterCounts = {};
  activeProjects.forEach(p => {
    if (p.reporter) reporterCounts[p.reporter] = (reporterCounts[p.reporter] || 0) + 1;
  });
  const topReporters = Object.entries(reporterCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => '     · ' + name + ' (' + count + ' project' + (count !== 1 ? 's' : '') + ')')
    .join('\n');

  const activeBeats = beats.filter(b => !b.archived).length;
  const activeAssignments = assignments.filter(a => !a.archived).length;
  const totalSources = sources.length;
  const scheduledEvents = events.filter(e => !e.completed).length;

  const dateLabel = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  const summaryText =
    '🗓  ' + dateLabel + '\n' +
    '\n' +
    '📊  PROJECT PORTFOLIO\n' +
    '     Active: ' + activeProjects.length + '    Archived: ' + archivedProjects.length + '\n' +
    '     Overdue: ' + overdue.length + '    Due within 3 days: ' + dueSoon.length + '\n' +
    '\n' +
    '👥  TEAM ON DUTY\n' +
    '     Staff: ' + staffCount + '    Admins: ' + adminCount + '\n' +
    (topReporters ? '     Top reporters by workload:\n' + topReporters + '\n' : '') +
    '\n' +
    '📍  FIELD ACTIVITY\n' +
    '     Check-ins today: ' + todayCheckins.length + '\n' +
    '     Recent location: ' + recentLocation + '\n' +
    '\n' +
    '📁  CONTENT PIPELINE\n' +
    '     Active beats: ' + activeBeats + '\n' +
    '     Open assignments: ' + activeAssignments + '\n' +
    '     Sources in vault: ' + totalSources + '\n' +
    '     Pending events: ' + scheduledEvents + '\n' +
    '\n' +
    '⚠️  ATTENTION REQUIRED\n' +
    '     Pending archive requests: ' + pendingArchive + '\n' +
    '     Overdue projects: ' + overdue.length;

  activitySummaries.unshift({
    id: Date.now(),
    title: 'Activity Summary — ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    summary: summaryText,
    generatedBy: currentUser.name,
    timestamp: now.toISOString()
  });

  generateActivitySummaryGrid();
  triggerNotificationToast('✓ Activity summary generated.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 19: SOURCES (admin-only clear all)
// ═══════════════════════════════════════════════════════════════════════

function generateSourcesGrid() {
  const container = document.getElementById('sourcesGrid');
  if (!container) return;
  container.innerHTML = '';

  const subset = sources.filter(s =>
    (s.name || '').toLowerCase().includes(sourceSearchQuery.toLowerCase()) ||
    (s.beat || '').toLowerCase().includes(sourceSearchQuery.toLowerCase())
  );

  if (subset.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No sources in vault.</div>';
    return;
  }

  subset.forEach(s => {
    const card = document.createElement('div');
    card.className = 'card source-card';
    card.innerHTML =
      '<div class="card-title">' + s.name + '</div>' +
      '<div style="font-size:0.85rem;color:var(--text-muted);">Beat: <b>' + (s.beat || 'Unassigned') + '</b></div>' +
      '<div style="font-size:0.82rem;color:var(--accent-light);">' + (s.contact || 'No contact') + '</div>';
    container.appendChild(card);
  });
}

async function clearAllSources() {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin clearance required.');
    return;
  }
  if (sources.length === 0) {
    triggerNotificationToast('No sources to clear.');
    return;
  }
  if (!confirm('Permanently delete all ' + sources.length + ' sources from the vault?')) return;
  if (!confirm('This cannot be undone. Are you absolutely sure?')) return;

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('sources').delete().neq('id', -1);
      if (error) throw error;
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  sources = [];
  flushCachedCollections();
  generateSourcesGrid();
  triggerNotificationToast('✓ Source vault cleared.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 20: USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

function generateUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (registeredUsersDB.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--text-muted);">No users loaded from backend.</td></tr>';
    return;
  }

  registeredUsersDB.forEach(user => {
    const isSelf = currentUser && currentUser.name === user.name;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    tr.innerHTML =
      '<td style="padding:0.9rem 1.25rem;font-weight:800;">' + (user.code || '—') + '</td>' +
      '<td style="padding:0.9rem 1.25rem;font-weight:600;">' + user.name + '</td>' +
      '<td style="padding:0.9rem 1.25rem;">' + user.role + '</td>' +
      '<td style="padding:0.9rem 1.25rem;color:var(--text-muted);">' + (user.created || '—') + '</td>' +
      '<td style="padding:0.9rem 1.25rem;text-align:right;">' +
        (isSelf
          ? '<span style="color:var(--text-muted);font-size:0.72rem;">(You)</span>'
          : '<button class="user-row-delete-btn" data-uid="' + user.id + '" data-uname="' + user.name + '">🗑 Delete</button>') +
      '</td>';
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-uid]').forEach(btn => {
    btn.addEventListener('click', () => deleteUserFromAdmin(parseInt(btn.dataset.uid), btn.dataset.uname));
  });
}

async function createNewUser() {
  const name = document.getElementById('newUserName').value.trim();
  const pass = document.getElementById('newUserPass').value.trim();
  const role = document.getElementById('newUserRole').value;

  if (name.length < 2 || pass.length < 4) {
    triggerNotificationToast('Name too short or password < 4 characters.');
    return;
  }

  const parts = name.split(' ');
  const code = parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.substring(0, 2).toUpperCase();

  if (!supabaseClient) {
    triggerNotificationToast('Backend unavailable.');
    return;
  }

  try {
    const { error } = await supabaseClient.rpc('create_user', {
      p_name: name, p_pass: pass, p_role: role, p_code: code
    });
    if (error) {
      if (error.message && error.message.toLowerCase().includes('duplicate')) {
        triggerNotificationToast('Username already exists.');
      } else {
        triggerNotificationToast('Error: ' + error.message);
      }
      return;
    }
  } catch (err) {
    triggerNotificationToast('Failed to reach backend.');
    return;
  }

  await refreshUsersFromBackend();
  generateUsersTable();
  generateStaffDirectory();
  evaluateClearancePermissions();

  document.getElementById('addUserModal').classList.remove('active');
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPass').value = '';
  triggerNotificationToast('Account "' + name + '" created.');
}

async function deleteUserFromAdmin(userId, userName) {
  if (currentUser && currentUser.name === userName) {
    triggerNotificationToast('You cannot delete your own account.');
    return;
  }
  if (!confirm('Permanently delete "' + userName + '"? This cannot be undone.')) return;

  if (!supabaseClient) {
    triggerNotificationToast('Backend unavailable.');
    return;
  }

  try {
    const { error } = await supabaseClient.rpc('delete_user', { p_id: userId });
    if (error) throw error;
  } catch (err) {
    triggerNotificationToast('Delete failed: ' + err.message);
    return;
  }

  registeredUsersDB = registeredUsersDB.filter(u => u.id !== userId);
  generateUsersTable();
  generateStaffDirectory();
  evaluateClearancePermissions();
  triggerNotificationToast('User "' + userName + '" deleted.');
}

async function refreshUsersFromBackend() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.rpc('list_users');
    if (error) throw error;
    registeredUsersDB = (data || []).map(u => ({
      id: u.id, name: u.name, role: u.role, code: u.code,
      created: u.created_at
        ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—'
    }));
  } catch (err) {
    console.error('Refresh users failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 21: CSV EXPORT
// ═══════════════════════════════════════════════════════════════════════

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportProjectsCSV() {
  const visible = projects.filter(p => !p.archived);
  if (visible.length === 0) {
    triggerNotificationToast('No projects to export.');
    return;
  }

  const rows = [['ID','Title','Category','Deadline','Status','Priority','Progress','Reporter','Tags','Notes']];
  visible.forEach(p => rows.push([
    p.id, p.title, p.category, p.deadline, p.status, p.priority,
    (p.progress || 0) + '%', p.reporter || '', p.tags || '', p.notes || ''
  ]));

  downloadCSV('jcompass-projects-' + new Date().toISOString().split('T')[0] + '.csv', rows);
  triggerNotificationToast('Exported ' + visible.length + ' projects.');
}

function exportAttendanceCSV() {
  if (attendanceLogs.length === 0) {
    triggerNotificationToast('No attendance data.');
    return;
  }
  const rows = [['Reporter','Role','Date','Time','Latitude','Longitude','Accuracy','Location','Note']];
  attendanceLogs.forEach(l => rows.push([
    l.reporter, l.role, l.date, l.time, l.lat, l.lon, l.accuracy, l.location, l.note || ''
  ]));
  downloadCSV('jcompass-attendance-' + new Date().toISOString().split('T')[0] + '.csv', rows);
  triggerNotificationToast('Exported ' + attendanceLogs.length + ' records.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 22: NOTIFICATION BAR
// ═══════════════════════════════════════════════════════════════════════

function dismissNotice(noticeId) {
  if (!dismissedNoticeIds.includes(noticeId)) {
    dismissedNoticeIds.push(noticeId);
    cacheSave(CACHE_KEYS.dismissedNotices, dismissedNoticeIds);
  }
  generateNotificationBar();
}

function generateNotificationBar() {
  const container = document.getElementById('notificationBarStack');
  if (!container || !currentUser) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const active = projects.filter(p => !p.archived);
  const overdue = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    return new Date(p.deadline) < today;
  });

  const notices = [];
  if (overdue.length > 0) {
    notices.push({ id: 'overdue-' + overdue.length, type: 'danger', icon: '⚠', text: overdue.length + ' project(s) overdue.' });
  }

  if (currentUser.role === 'ADMIN') {
    const pendingReqs = archiveRequests.filter(r => r.status === 'PENDING').length;
    if (pendingReqs > 0) {
      notices.push({
        id: 'archive-reqs-' + pendingReqs,
        type: 'warning',
        icon: '📥',
        text: pendingReqs + ' archive request(s) awaiting your review.'
      });
    }
  }

  const visible = notices.filter(n => !dismissedNoticeIds.includes(n.id));
  container.innerHTML = visible.map(n =>
    '<div class="notice-bar notice-' + n.type + '">' +
    '<span class="notice-icon">' + n.icon + '</span>' +
    '<span class="notice-text">' + n.text + '</span>' +
    '<button class="notice-dismiss-btn">✕</button>' +
    '</div>'
  ).join('');

  container.querySelectorAll('.notice-dismiss-btn').forEach((btn, i) => {
    btn.addEventListener('click', () => dismissNotice(visible[i].id));
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 23: INJECT ADMIN CLEAR BUTTONS
// ═══════════════════════════════════════════════════════════════════════

function injectAdminClearButtons() {
  if (!currentUser || currentUser.role !== 'ADMIN') return;

  // ── Clear Closed-Out Reports button ──────────────────────────────
  const arcRepBadge = document.getElementById('archiveReportsCountBadge');
  if (arcRepBadge && !document.getElementById('clearArchiveReportsBtn')) {
    const btn = document.createElement('button');
    btn.id = 'clearArchiveReportsBtn';
    btn.className = 'btn btn-ghost';
    btn.style.fontSize = '0.75rem';
    btn.style.color = 'var(--danger)';
    btn.style.borderColor = 'rgba(229,62,62,0.3)';
    btn.style.whiteSpace = 'nowrap';
    btn.textContent = '🗑 Clear Reports';
    btn.addEventListener('click', clearArchivedReports);
    arcRepBadge.parentNode.insertBefore(btn, arcRepBadge);
  }

  // ── Clear Activity Summaries button ──────────────────────────────
  const actSumBadge = document.getElementById('activitySummaryCountBadge');
  if (actSumBadge && !document.getElementById('clearActivitySummariesBtn')) {
    const btn = document.createElement('button');
    btn.id = 'clearActivitySummariesBtn';
    btn.className = 'btn btn-ghost';
    btn.style.fontSize = '0.75rem';
    btn.style.color = 'var(--danger)';
    btn.style.borderColor = 'rgba(229,62,62,0.3)';
    btn.style.whiteSpace = 'nowrap';
    btn.textContent = '🗑 Clear Summaries';
    btn.addEventListener('click', clearActivitySummaries);
    actSumBadge.parentNode.insertBefore(btn, actSumBadge);
  }

  // ── Clear Source Vault button ────────────────────────────────────
  const addSourceBtn = document.getElementById('addSourceBtn');
  if (addSourceBtn && !document.getElementById('clearSourcesBtn')) {
    const btn = document.createElement('button');
    btn.id = 'clearSourcesBtn';
    btn.className = 'btn btn-ghost';
    btn.style.fontSize = '0.8rem';
    btn.style.color = 'var(--danger)';
    btn.style.borderColor = 'rgba(229,62,62,0.3)';
    btn.style.marginRight = '0.5rem';
    btn.textContent = '🗑 Clear Vault';
    btn.addEventListener('click', clearAllSources);
    addSourceBtn.parentNode.insertBefore(btn, addSourceBtn);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 24: INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════

function initializeApp() {
  wipeLegacyCache();
  initSupabaseClient();

  const savedTheme = localStorage.getItem('jcompass_theme') || 'forest';
  document.body.setAttribute('data-theme-profile', savedTheme);

  enforceSessionGuard();

  // ── Navigation ─────────────────────────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(nav => {
    nav.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      nav.classList.add('active');
      const targetPage = nav.getAttribute('data-page');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const pageEl = document.getElementById('page-' + targetPage);
      if (pageEl) pageEl.classList.add('active');
      const breadcrumb = document.getElementById('breadcrumbCurrent');
      if (breadcrumb && nav.querySelector('.nav-label')) breadcrumb.innerText = nav.querySelector('.nav-label').innerText;
      if (targetPage === 'attend') initAttendancePage();
      if (targetPage === 'calendar') generateDeadlineCalendarGrid();
      if (targetPage === 'archive') renderArchiveRequestsPanel();
    });
  });

  // ── Sidebar ────────────────────────────────────────────────────────
  const sidebarEl = document.getElementById('sidebar');
  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle && sidebarEl) menuToggle.addEventListener('click', () => sidebarEl.classList.toggle('active'));

  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  if (sidebarCloseBtn && sidebarEl) sidebarCloseBtn.addEventListener('click', () => sidebarEl.classList.remove('active'));

  document.addEventListener('click', (e) => {
    if (window.innerWidth > 992 || !sidebarEl || !sidebarEl.classList.contains('active')) return;
    if (!e.target.closest('.nav-item')) return;
    sidebarEl.classList.remove('active');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebarEl) sidebarEl.classList.remove('active');
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 992 && sidebarEl) sidebarEl.classList.remove('active');
  });

  // ── Sign out ───────────────────────────────────────────────────────
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem('jcompass_user');
      } catch (e) {}
      window.location.replace('login.html');
    });
  }

  // ── Announcements ──────────────────────────────────────────────────
  const announceBtn = document.getElementById('submitAnnouncementBtn');
  if (announceBtn) {
    announceBtn.addEventListener('click', () => {
      const input = document.getElementById('announceTextInput');
      const target = document.getElementById('announcePingTarget');
      if (!input || !input.value.trim() || !currentUser) return;
      dispatchPing(currentUser.name, target.value, input.value.trim());
      input.value = '';
    });
  }

  // ── Attendance ─────────────────────────────────────────────────────
  const attendanceBtn = document.getElementById('markAttendanceBtn');
  if (attendanceBtn) attendanceBtn.addEventListener('click', processFieldTelemetryMarking);

  const clearAttBtn = document.getElementById('clearAttendanceBtn');
  if (clearAttBtn) clearAttBtn.addEventListener('click', clearAttendanceLog);

  const exportAttBtn = document.getElementById('exportAttendanceBtn');
  if (exportAttBtn) exportAttBtn.addEventListener('click', exportAttendanceCSV);

  // ── Export projects CSV ────────────────────────────────────────────
  const exportProjBtn = document.getElementById('quickExportCSVBtn');
  if (exportProjBtn) exportProjBtn.addEventListener('click', exportProjectsCSV);

  // ── Create project ─────────────────────────────────────────────────
  const createProjectBtn = document.getElementById('createProjectBtn');
  if (createProjectBtn) {
    createProjectBtn.addEventListener('click', async () => {
      const title = document.getElementById('newTitle').value.trim();
      const category = document.getElementById('newCategory').value;
      const deadline = document.getElementById('newDeadline').value || new Date().toISOString().split('T')[0];
      if (!title) return;

      const payload = {
        title, category, deadline,
        status: 'ACTIVE', priority: 'MEDIUM', progress: 0,
        reporter: currentUser ? currentUser.name : '',
        notes: '', tags: '', archived: false
      };

      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient.from('projects').insert(payload).select().single();
          if (error) throw error;
          if (data) payload.id = data.id;
        } catch (err) {
          triggerNotificationToast('Backend error: ' + err.message);
          return;
        }
      } else { payload.id = Date.now(); }

      projects.push(payload);
      flushCachedCollections();
      rebuildApplicationDOMViews();
      document.getElementById('newProjectModal').classList.remove('active');
      document.getElementById('newTitle').value = '';
      triggerNotificationToast('Project created.');
    });
  }

  // ── Save user ──────────────────────────────────────────────────────
  const saveUserBtn = document.getElementById('saveUserBtn');
  if (saveUserBtn) saveUserBtn.addEventListener('click', createNewUser);

  // ── Save source ────────────────────────────────────────────────────
  const saveSourceBtn = document.getElementById('saveSourceBtn');
  if (saveSourceBtn) {
    saveSourceBtn.addEventListener('click', async () => {
      const name = document.getElementById('sourceName').value.trim();
      const beat = document.getElementById('sourceBeat').value.trim();
      const contact = document.getElementById('sourceContact').value.trim();
      const reliability = document.getElementById('sourceReliability').value;
      const notes = document.getElementById('sourceNotes').value.trim();
      if (!name) return;

      const payload = {
        name, beat, contact, reliability, notes,
        created_by: currentUser ? currentUser.name : 'Unknown'
      };

      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient.from('sources').insert(payload).select().single();
          if (error) throw error;
          payload.id = data ? data.id : Date.now();
        } catch (err) {
          triggerNotificationToast('Backend error: ' + err.message);
          return;
        }
      } else { payload.id = Date.now(); }

      sources.push({
        id: payload.id, name, beat, contact, reliability, notes,
        createdBy: payload.created_by
      });
      flushCachedCollections();
      generateSourcesGrid();
      document.getElementById('addSourceModal').classList.remove('active');
      document.getElementById('sourceName').value = '';
      document.getElementById('sourceBeat').value = '';
      document.getElementById('sourceContact').value = '';
      document.getElementById('sourceNotes').value = '';
      triggerNotificationToast('Source added.');
    });
  }

  // ── Notifications ──────────────────────────────────────────────────
  refreshNotificationPermissionUI();
  const notifyBtn = document.getElementById('enableNotificationsBtn');
  if (notifyBtn) notifyBtn.addEventListener('click', requestNotificationPermission);

  // ── Calendar nav ───────────────────────────────────────────────────
  const prevBtn = document.getElementById('calPrevMonth');
  const nextBtn = document.getElementById('calNextMonth');
  if (prevBtn) prevBtn.addEventListener('click', () => { calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; } generateDeadlineCalendarGrid(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; } generateDeadlineCalendarGrid(); });

  // ── Dashboard filter chips ─────────────────────────────────────────
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter || 'ALL';
      generateProjectDashboard();
    });
  });

  // ── Search ─────────────────────────────────────────────────────────
  const searchInput = document.getElementById('dashboardSearchInput');
  if (searchInput) searchInput.addEventListener('input', (e) => { searchQuery = e.target.value; generateProjectDashboard(); });

  const sourceSearch = document.getElementById('sourceSearchInput');
  if (sourceSearch) sourceSearch.addEventListener('input', (e) => { sourceSearchQuery = e.target.value; generateSourcesGrid(); });

  const attSearch = document.getElementById('attendanceSearchInput');
  if (attSearch) attSearch.addEventListener('input', (e) => { attendanceSearchQuery = e.target.value; renderAttendanceTable(); });

  // ── Save project profile ───────────────────────────────────────────
  const saveProfileBtn = document.getElementById('profileSaveBtn');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProjectProfile);

  // ── Project modal event delegation ─────────────────────────────────
  const projectModal = document.getElementById('projectProfileModal');
  if (projectModal) {
    projectModal.addEventListener('click', async (e) => {
      // Priority button handling
      const priorityBtn = e.target.closest('.priority-select-btn');
      if (priorityBtn && !priorityBtn.disabled) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.priority-select-btn').forEach(b => b.classList.remove('active'));
        priorityBtn.classList.add('active');
        return;
      }

      const archiveBtn = e.target.closest('#profileArchiveBtn');
      const deleteBtn  = e.target.closest('#profileDeleteBtn');
      const requestBtn = e.target.closest('#profileRequestArchiveBtn');

      if (archiveBtn) {
        e.preventDefault(); e.stopPropagation();
        if (activeProfileId == null) { triggerNotificationToast('No project selected.'); return; }
        await archiveProject(activeProfileId);
      }
      if (deleteBtn) {
        e.preventDefault(); e.stopPropagation();
        if (activeProfileId == null) { triggerNotificationToast('No project selected.'); return; }
        await deleteProject(activeProfileId);
      }
      if (requestBtn) {
        e.preventDefault(); e.stopPropagation();
        if (activeProfileId == null) { triggerNotificationToast('No project selected.'); return; }
        await submitArchiveRequest(activeProfileId);
      }
    });
  }

  // ── Modal close buttons ────────────────────────────────────────────
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('active');
    });
  });

  // ── Modal open buttons ─────────────────────────────────────────────
  const modalButtons = [
    { btnId: 'fabBtn', modalId: 'newProjectModal' },
    { btnId: 'addCalendarProjectBtn', modalId: 'newProjectModal' },
    { btnId: 'addBeatBtn', modalId: 'addBeatModal' },
    { btnId: 'addAssignmentBtn', modalId: 'addAssignmentModal' },
    { btnId: 'addEventBtn', modalId: 'addEventModal' },
    { btnId: 'addUserBtn', modalId: 'addUserModal' },
    { btnId: 'addSourceBtn', modalId: 'addSourceModal' },
    { btnId: 'quickAddProjectBtn', modalId: 'newProjectModal' }
  ];

  modalButtons.forEach(({ btnId, modalId }) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.addEventListener('click', () => {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.add('active');
    });
  });

  // ── Save beat ──────────────────────────────────────────────────────
  const saveBeatBtn = document.getElementById('saveBeatBtn');
  if (saveBeatBtn) {
    saveBeatBtn.addEventListener('click', async () => {
      const name = document.getElementById('beatName').value.trim();
      const reporter = document.getElementById('beatReporter').value.trim() || (currentUser ? currentUser.name : 'Reporter');
      const priority = document.getElementById('beatPriority').value;
      if (!name) return;

      const payload = { name, reporter, priority, img_data: '' };

      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient.from('beats').insert(payload).select().single();
          if (error) throw error;
          payload.id = data ? data.id : Date.now();
        } catch (err) {
          triggerNotificationToast('Backend error: ' + err.message);
          return;
        }
      } else { payload.id = Date.now(); }

      beats.push({ id: payload.id, name, reporter, priority, imgData: '', archived: false });
      flushCachedCollections();
      generateBeatsGrid();
      document.getElementById('addBeatModal').classList.remove('active');
      document.getElementById('beatName').value = '';
      document.getElementById('beatReporter').value = '';
      triggerNotificationToast('Beat created.');
    });
  }

  // ── Save assignment ────────────────────────────────────────────────
  const saveAssignmentBtn = document.getElementById('saveAssignmentBtn');
  if (saveAssignmentBtn) {
    saveAssignmentBtn.addEventListener('click', async () => {
      const title = document.getElementById('asgTitle').value.trim();
      const assignee = document.getElementById('asgAssignee').value.trim() || 'General Desk';
      if (!title) return;

      const payload = { title, assignee };

      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient.from('assignments').insert(payload).select().single();
          if (error) throw error;
          payload.id = data ? data.id : Date.now();
        } catch (err) {
          triggerNotificationToast('Backend error: ' + err.message);
          return;
        }
      } else { payload.id = Date.now(); }

      assignments.push({ id: payload.id, title, assignee, archived: false });
      flushCachedCollections();
      generateAssignmentsGrid();
      document.getElementById('addAssignmentModal').classList.remove('active');
      document.getElementById('asgTitle').value = '';
      document.getElementById('asgAssignee').value = '';
      triggerNotificationToast('Assignment created.');
    });
  }

  // ── Save event ─────────────────────────────────────────────────────
  const saveEventBtn = document.getElementById('saveEventBtn');
  if (saveEventBtn) {
    saveEventBtn.addEventListener('click', async () => {
      const name = document.getElementById('evtName').value.trim();
      const date = document.getElementById('evtDate').value || new Date().toISOString().split('T')[0];
      if (!name) return;

      const payload = { name, date, completed: false };

      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient.from('events').insert(payload).select().single();
          if (error) throw error;
          payload.id = data ? data.id : Date.now();
        } catch (err) {
          triggerNotificationToast('Backend error: ' + err.message);
          return;
        }
      } else { payload.id = Date.now(); }

      events.push(payload);
      flushCachedCollections();
      generateEventsTrackerChecklist();
      document.getElementById('addEventModal').classList.remove('active');
      document.getElementById('evtName').value = '';
      triggerNotificationToast('Event added.');
    });
  }

  // ── Save display name ──────────────────────────────────────────────
  const saveNameBtn = document.getElementById('saveNameBtn');
  if (saveNameBtn) {
    saveNameBtn.addEventListener('click', () => {
      const input = document.getElementById('sidebarNameInput');
      if (!input || !currentUser) return;
      const newName = input.value.trim();
      if (!newName) return;
      currentUser.name = newName;
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        const s = raw ? JSON.parse(raw) : null;
        if (s && s.user) {
          s.user.name = newName;
          localStorage.setItem(SESSION_KEY, JSON.stringify(s));
          window.JCOMPASS_SESSION = s;
        }
      } catch (e) {}
      evaluateClearancePermissions();
      triggerNotificationToast('Name updated locally.');
    });
  }

  // ── Activity summary generation ────────────────────────────────────
  const genSummaryBtn = document.getElementById('generateActivitySummaryBtn');
  if (genSummaryBtn) genSummaryBtn.addEventListener('click', generateActivitySummaryReport);

  // ── Theme buttons ──────────────────────────────────────────────────
  document.querySelectorAll('.theme-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-chip-btn').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const theme = btn.getAttribute('data-theme');
      document.body.setAttribute('data-theme-profile', theme);
      localStorage.setItem('jcompass_theme', theme);
    });
  });

  console.log('✅ JCompass initialized (v2.3)');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 25: CONTROL TRAY
// ═══════════════════════════════════════════════════════════════════════

(function wireControlTray() {
  function openTray() {
    const tray = document.getElementById('controlTray');
    const ov = document.getElementById('controlTrayOverlay');
    if (tray) tray.classList.add('active');
    if (ov) ov.classList.add('active');
  }
  function closeTray() {
    const tray = document.getElementById('controlTray');
    const ov = document.getElementById('controlTrayOverlay');
    if (tray) tray.classList.remove('active');
    if (ov) ov.classList.remove('active');
  }

  const gearBtn = document.getElementById('settingsGearBtn');
  if (gearBtn) gearBtn.addEventListener('click', openTray);
  const sideBtn = document.getElementById('settingsSidebarBtn');
  if (sideBtn) sideBtn.addEventListener('click', openTray);
  const userChip = document.getElementById('userAvatarBtn');
  if (userChip) userChip.addEventListener('click', openTray);
  const trayClose = document.getElementById('controlTrayCloseBtn');
  if (trayClose) trayClose.addEventListener('click', closeTray);
  const trayOv = document.getElementById('controlTrayOverlay');
  if (trayOv) trayOv.addEventListener('click', closeTray);
})();

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 26: ONESIGNAL
// ═══════════════════════════════════════════════════════════════════════

const ONESIGNAL_APP_ID = 'e76cbe01-1a76-4f3d-a45d-9d155a126093';
const ONESIGNAL_API_KEY = 'os_v2_app_45wl4ai2ozht3jc5tukvuetasocbd7a6dhwu2amqs23bpvmhaaeqpcgmitmhidymddsixetmj4uovgolydndk7lgmszycyc43sqhw4q';

async function sendPushNotification(title, message, targetUserName = null) {
  try {
    const notificationData = {
      app_id: ONESIGNAL_APP_ID,
      contents: { en: message },
      headings: { en: title },
      priority: 10,
      data: { type: 'ping' },
      chrome_web_icon: 'https://cdn-icons-png.flaticon.com/512/148/148813.png',
      chrome_web_badge: 'https://cdn-icons-png.flaticon.com/512/148/148813.png',
    };
    if (targetUserName) {
      notificationData.include_external_user_ids = [targetUserName];
    } else {
      notificationData.included_segments = ['Subscribed Users'];
    }
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Key ' + ONESIGNAL_API_KEY },
      body: JSON.stringify(notificationData)
    });
    return await response.json();
  } catch (err) {
    console.error('Push notification failed:', err);
  }
}

async function setOneSignalUser(userName) {
  if (window.OneSignal) {
    try { await window.OneSignal.login(userName); } catch (err) {}
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 27: BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}