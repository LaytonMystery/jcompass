/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  JOURNALIST'S COMPASS v6.3                                          ║
 * ║  · Editor in Chief role (admin minus user management)               ║
 * ║  · EIC included in task/field-op/announcement selectors             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const { CONFIG, Utils, Session } = window.JC;
const { escapeHtml: esc } = Utils;
const CACHE_PREFIX = window.JC.CACHE_PREFIX;
const SESSION_KEY  = CONFIG.SESSION_KEY;

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 1: CACHE
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE_KEYS = {
  projects:         CACHE_PREFIX + 'projects',
  deployments:      CACHE_PREFIX + 'deployments',
  assignments:      CACHE_PREFIX + 'assignments',
  events:           CACHE_PREFIX + 'events',
  announcements:    CACHE_PREFIX + 'announcements',
  attendance:       CACHE_PREFIX + 'attendance',
  sources:          CACHE_PREFIX + 'sources',
  archiveRequests:  CACHE_PREFIX + 'archive_requests',
  auditLog:         CACHE_PREFIX + 'audit_log',
  dismissedNotices: 'jcompass_dismissed_notices'
};

const cacheLoad = (key, fb) => Utils.store.get(key, fb);
const cacheSave = (key, val) => Utils.store.set(key, val);

function cacheClearAll() {
  Object.values(CACHE_KEYS).forEach(k => {
    if (k === 'jcompass_dismissed_notices') return;
    Utils.store.del(k);
  });
}

function wipeLegacyCache() {
  const keep = [SESSION_KEY, 'jcompass_theme', 'jcompass_mode'];
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('jcompass_')) continue;
    if (keep.includes(key) || key.startsWith(CACHE_PREFIX)) continue;
    toRemove.push(key);
  }
  toRemove.forEach(k => Utils.store.del(k));
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 2: STATE
   ═══════════════════════════════════════════════════════════════════════ */

let currentUser = null;
let supabaseClient = null;
let realtimeChannel = null;

const PRIVILEGED_ROLES = ['ADMIN', 'EDITOR'];
const isPrivileged = () => !!currentUser && PRIVILEGED_ROLES.includes(currentUser.role);
const isAdmin = () => !!currentUser && currentUser.role === 'ADMIN';
// Anyone who can be assigned work — every non-admin role.
// Future roles (MANAGER, INTERN, etc.) automatically qualify.
const isAssignable = (role) => role !== 'ADMIN';

let currentFilter = 'ALL';
let searchQuery = '';
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let sourceSearchQuery = '';
let attendanceSearchQuery = '';
let auditSearchQuery = '';
let activeProfileId = null;
let activeDeploymentId = null;
let activeSubmissionId = null;

let projects          = cacheLoad(CACHE_KEYS.projects, []);
let assignments       = cacheLoad(CACHE_KEYS.assignments, []);
let deployments       = cacheLoad(CACHE_KEYS.deployments, []);
let events            = cacheLoad(CACHE_KEYS.events, []);
let announcements     = cacheLoad(CACHE_KEYS.announcements, []);
let attendanceLogs    = cacheLoad(CACHE_KEYS.attendance, []);
let sources           = cacheLoad(CACHE_KEYS.sources, []);
let archiveRequests   = cacheLoad(CACHE_KEYS.archiveRequests, []);
let registeredUsersDB = [];
let archivedReports   = [];
let activitySummaries = [];
let auditLog          = cacheLoad(CACHE_KEYS.auditLog, []);
let dismissedNoticeIds = cacheLoad(CACHE_KEYS.dismissedNotices, []);

function flushCachedCollections() {
  cacheSave(CACHE_KEYS.projects, projects);
  cacheSave(CACHE_KEYS.deployments, deployments);
  cacheSave(CACHE_KEYS.assignments, assignments);
  cacheSave(CACHE_KEYS.events, events);
  cacheSave(CACHE_KEYS.announcements, announcements);
  cacheSave(CACHE_KEYS.attendance, attendanceLogs);
  cacheSave(CACHE_KEYS.sources, sources);
  cacheSave(CACHE_KEYS.archiveRequests, archiveRequests);
  cacheSave(CACHE_KEYS.auditLog, auditLog);
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 3: AUDIT
   ═══════════════════════════════════════════════════════════════════════ */

async function logAudit(action, targetType, targetId, targetName, details) {
  if (!currentUser) return;
  const entry = {
    actor: currentUser.name, action, target_type: targetType,
    target_id: String(targetId || ''), target_name: targetName || '',
    details: details || ''
  };
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('audit_log').insert(entry).select().single();
      if (error) throw error;
      auditLog.unshift({ ...entry, id: data.id, created_at: data.created_at });
      cacheSave(CACHE_KEYS.auditLog, auditLog);
      renderAuditLogTable();
    } catch (err) { console.warn('Audit write failed:', err); }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 4: SYNC
   ═══════════════════════════════════════════════════════════════════════ */

async function syncAllDataFromSupabase() {
  if (!supabaseClient) return;
  console.log('🔄 Syncing (parallel)…');
  const token = Session.getToken();

  async function retryOnce(fn, label) {
    try { return await fn(); }
    catch (e1) {
      if (e1 && e1.name === 'AbortError') {
        console.warn('Retrying ' + label + ' after AbortError…');
        await new Promise(r => setTimeout(r, 400));
        return await fn();
      }
      throw e1;
    }
  }

  const jobs = [
    () => supabaseClient.from('projects').select('*').order('id', { ascending: true }),
    () => supabaseClient.from('deployments').select('*').order('id', { ascending: true }),
    () => supabaseClient.from('assignments').select('*').order('id', { ascending: false }),
    () => supabaseClient.from('events').select('*').order('id', { ascending: true }),
    () => supabaseClient.from('sources').select('*').order('id', { ascending: true }),
    () => supabaseClient.from('archive_requests').select('*').order('id', { ascending: true }),
    () => supabaseClient.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500),
    () => supabaseClient.from('attendance').select('*').order('created_at', { ascending: false }).limit(500),
    () => supabaseClient.from('pings').select('*').order('created_at', { ascending: true }),
    () => supabaseClient.rpc('list_users', { p_token: token })
  ];

  const labels = ['projects','deployments','assignments','events','sources','archive_requests','audit_log','attendance','pings','users'];

  const results = await Promise.allSettled(
    jobs.map((fn, i) => retryOnce(fn, labels[i]))
  );

  const pick = i => results[i].status === 'fulfilled'
    ? results[i].value
    : { data: null, error: results[i].reason };
  const b = Utils.bool;

  {
    const { data, error } = pick(0);
    if (!error) projects = (data || []).map(p => ({
      id: p.id, title: p.title, category: p.category, deadline: p.deadline,
      status: p.status, priority: p.priority, progress: p.progress,
      reporter: p.reporter || '', notes: p.notes || '', tags: p.tags || '',
      archived: b(p.archived), created_at: p.created_at,
      submission_text: p.submission_text || '',
      submission_file: p.submission_file || '',
      submitted_by: p.submitted_by || '', submitted_at: p.submitted_at || null,
      created_by: p.created_by || ''
    }));
    else console.error('projects sync', error);
  }
  {
    const { data, error } = pick(1);
    if (!error) deployments = (data || []).map(d => ({
      id: d.id, title: d.title, description: d.description || '',
      location: d.location || '', reporter: d.reporter || '',
      priority: d.priority || 'MEDIUM', status: d.status || 'ACTIVE',
      imageData: d.image_data || '', createdBy: d.created_by || '',
      archived: b(d.archived), created_at: d.created_at
    }));
    else console.error('deployments sync', error);
  }
  {
    const { data, error } = pick(2);
    if (!error) assignments = (data || []).map(a => ({
      id: a.id, title: a.title, assignee: a.assignee || '',
      description: a.description || '', priority: a.priority || 'MEDIUM',
      due_date: a.due_date || '', created_by: a.created_by || '',
      status: a.status || 'PENDING',
      submission_text: a.submission_text || '', submission_file: a.submission_file || '',
      submitted_by: a.submitted_by || '', submitted_at: a.submitted_at || null,
      reviewed_by: a.reviewed_by || '', reviewed_at: a.reviewed_at || null,
      review_notes: a.review_notes || '',
      archived: b(a.archived), created_at: a.created_at
    }));
    else console.error('assignments sync', error);
  }
  {
    const { data, error } = pick(3);
    if (!error) events = (data || []).map(e => ({
      id: e.id, name: e.name, date: e.date,
      completed: b(e.completed), archived: b(e.archived)
    }));
    else console.error('events sync', error);
  }
  {
    const { data, error } = pick(4);
    if (!error) sources = (data || []).map(s => ({
      id: s.id, name: s.name, beat: s.beat || '', contact: s.contact || '',
      reliability: s.reliability || 'MEDIUM', notes: s.notes || '',
      createdBy: s.created_by || 'Unknown'
    }));
    else console.error('sources sync', error);
  }
  {
    const { data, error } = pick(5);
    if (!error) archiveRequests = (data || []).map(r => ({
      id: r.id, project_id: r.project_id, project_title: r.project_title || '',
      requester: r.requester, request_timestamp: r.request_timestamp || '',
      status: r.status || 'PENDING'
    }));
    else console.error('archive_requests sync', error);
  }
  {
    const { data, error } = pick(6);
    if (!error) auditLog = (data || []).map(a => ({
      id: a.id, actor: a.actor, action: a.action,
      target_type: a.target_type || '', target_id: a.target_id || '',
      target_name: a.target_name || '', details: a.details || '',
      created_at: a.created_at
    }));
    else console.error('audit_log sync', error);
  }
  {
    const { data, error } = pick(7);
    if (!error) attendanceLogs = (data || []).map(row => ({
      id: 'remote-' + row.id, reporter: row.reporter, role: row.role,
      date: row.date, time: row.time, lat: row.lat, lon: row.lon,
      accuracy: row.accuracy, location: row.location, note: row.note || '',
      timestamp: row.timestamp_iso,
      check_out_time: row.check_out_time || '',
      check_out_lat: row.check_out_lat || '',
      check_out_lon: row.check_out_lon || '',
      check_out_timestamp: row.check_out_timestamp || '',
      task_ref: row.task_ref || '', task_ref_id: row.task_ref_id || ''
    }));
    else console.error('attendance sync', error);
  }
  {
    const { data, error } = pick(8);
    if (!error) announcements = (data || []).map(row => ({
      id: 'remote-' + row.id, sender: row.sender, target: row.target, text: row.message,
      timestamp: Utils.fmtDate(row.created_at, { month: 'short', day: 'numeric', year: 'numeric' })
    }));
    else console.error('pings sync', error);
  }
  {
    const r = pick(9);
    if (!r.error && r.data) registeredUsersDB = r.data.map(u => ({
      id: u.id, name: u.name, role: u.role, code: u.code,
      created: u.created_at ? Utils.fmtDate(u.created_at, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
    }));
    else if (r.error) console.error('users sync', r.error);
  }

  flushCachedCollections();
  console.log('✅ Sync complete.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 5: REALTIME
   ═══════════════════════════════════════════════════════════════════════ */

function subscribeRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) { try { supabaseClient.removeChannel(realtimeChannel); } catch {} }

  realtimeChannel = supabaseClient.channel('jcompass-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings' }, ({ new: row }) => {
      const id = 'remote-' + row.id;
      if (announcements.some(a => a.id === id)) return;
      const ann = {
        id, sender: row.sender, target: row.target, text: row.message,
        timestamp: Utils.fmtDate(row.created_at, { month: 'short', day: 'numeric', year: 'numeric' })
      };
      announcements.push(ann);
      flushCachedCollections();
      generateAnnouncementsStream();
      notifyIncomingPing(ann);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'pings' }, ({ old }) => {
      announcements = announcements.filter(a => a.id !== 'remote-' + old.id);
      flushCachedCollections();
      generateAnnouncementsStream();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assignments' }, ({ new: row }) => {
      if (row.assignee === currentUser.name && row.created_by !== currentUser.name && window.JC.showAssignPopup) {
        window.JC.showAssignPopup('New task assigned', row.title, 'assignments');
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'projects' }, ({ new: row }) => {
      if (row.reporter === currentUser.name && window.JC.showAssignPopup) {
        window.JC.showAssignPopup('New project assigned', row.title, 'dashboard');
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, ({ new: row }) => {
      const id = 'remote-' + row.id;
      if (attendanceLogs.some(a => a.id === id)) return;
      attendanceLogs.unshift({
        id, reporter: row.reporter, role: row.role, date: row.date, time: row.time,
        lat: row.lat, lon: row.lon, accuracy: row.accuracy, location: row.location,
        note: row.note || '', timestamp: row.timestamp_iso,
        check_out_time: row.check_out_time || '', check_out_lat: row.check_out_lat || '',
        check_out_lon: row.check_out_lon || '', check_out_timestamp: row.check_out_timestamp || '',
        task_ref: row.task_ref || '', task_ref_id: row.task_ref_id || ''
      });
      flushCachedCollections();
      renderAttendanceTable();
      updateAttendanceStats();
      updateAttendanceButtons();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attendance' }, ({ new: row }) => {
      const idx = attendanceLogs.findIndex(a => a.id === 'remote-' + row.id);
      if (idx >= 0) Object.assign(attendanceLogs[idx], {
        check_out_time: row.check_out_time || '',
        check_out_lat: row.check_out_lat || '',
        check_out_lon: row.check_out_lon || '',
        check_out_timestamp: row.check_out_timestamp || ''
      });
      flushCachedCollections();
      renderAttendanceTable();
      updateAttendanceStats();
      updateAttendanceButtons();
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Live channel connected.');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn('Realtime dropped, retrying…', status);
        setTimeout(subscribeRealtime, 3000);
      }
    });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 6: NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════════════ */

function refreshNotificationPermissionUI() {
  const btn = document.getElementById('enableNotificationsBtn');
  const label = document.getElementById('notificationStatusLabel');
  if (!btn || !label || !('Notification' in window)) {
    if (label) label.textContent = 'Push alerts not supported.';
    if (btn) btn.style.display = 'none';
    return;
  }
  if (Notification.permission === 'granted') {
    btn.textContent = '🔔 Push Alerts Enabled'; btn.disabled = true;
    label.textContent = 'You will get device popups for new messages.';
  } else if (Notification.permission === 'denied') {
    btn.textContent = '🔕 Push Alerts Blocked'; btn.disabled = true;
    label.textContent = 'Notifications blocked in browser.';
  } else {
    btn.textContent = '🔔 Enable Push Alerts'; btn.disabled = false;
    label.textContent = 'Not enabled yet.';
  }
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(refreshNotificationPermissionUI);
}

function notifyIncomingPing(ann) {
  if (!currentUser) return;
  const isPingedToMe = ann.target === currentUser.name;
  const isBroadcastAll = ann.target === 'ALL';
  if (!isPingedToMe && !isBroadcastAll) return;
  if (ann.sender === currentUser.name) return;

  const title = isBroadcastAll ? 'JCompass — Announcement' : 'JCompass — Direct Message';
  const body = ann.sender + ': ' + ann.text;

  if (('Notification' in window) && Notification.permission === 'granted' && document.hidden) {
    const n = new Notification(title, { body, icon: 'favicon.ico' });
    n.onclick = () => { window.focus(); n.close(); };
  } else {
    triggerNotificationToast(body);
  }
}

function triggerNotificationToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.classList.add('active');
  setTimeout(() => t.classList.remove('active'), 3000);
}

async function dispatchPing(sender, target, text) {
  if (!supabaseClient) { triggerNotificationToast('Backend unavailable.'); return; }
  try {
    const { error } = await supabaseClient.from('pings').insert({ sender, target, message: text });
    if (error) throw error;
  } catch (err) {
    console.error('Publish ping failed:', err);
    triggerNotificationToast('Failed: ' + err.message);
    return;
  }
  if (typeof sendPushNotification === 'function') {
    if (target === 'ALL') sendPushNotification('📰 Announcement', sender + ': ' + text);
    else sendPushNotification('📌 Message from ' + sender, text, target);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 7: SESSION / PERMISSIONS
   ═══════════════════════════════════════════════════════════════════════ */

async function enforceSessionGuard() {
  if (!currentUser) return;
  document.body.setAttribute('data-user-clearance', currentUser.role);

  try { await syncAllDataFromSupabase(); }
  catch (err) { console.error('Sync failed:', err); }

  evaluateClearancePermissions();
  rebuildApplicationDOMViews();
  subscribeRealtime();

  if (typeof setOneSignalUser === 'function') setOneSignalUser(currentUser.name);
}

function evaluateClearancePermissions() {
  if (!currentUser) return;
  const tLabel = document.getElementById('displayName');
  const tRole  = document.getElementById('displayRole');
  const aBadge = document.getElementById('avatarBadgeIcon');
  if (tLabel) tLabel.innerText = currentUser.name;
  if (tRole)  tRole.innerText  = currentUser.role;
  if (aBadge) aBadge.innerText = currentUser.code || 'JC';

  const showAdminNav = isPrivileged();
  document.querySelectorAll('.admin-only-nav').forEach(el => {
    el.style.display = showAdminNav ? '' : 'none';
  });

  // Hide admin-only action buttons from editors
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  const staffCard = document.getElementById('statStaffCountParent');
  if (staffCard) staffCard.style.display = showAdminNav ? '' : 'none';

  // Ping dropdown — include STAFF and EDITOR
  const pingSelect = document.getElementById('announcePingTarget');
  if (pingSelect) {
    pingSelect.innerHTML = '<option value="ALL">Send to All</option>';
    registeredUsersDB.forEach(u => {
      if (isAssignable(u.role)) {
        const opt = document.createElement('option');
        opt.value = u.name;
        opt.textContent = 'Message: ' + u.name;
        pingSelect.appendChild(opt);
      }
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 8: MASTER REBUILD
   ═══════════════════════════════════════════════════════════════════════ */

function rebuildApplicationDOMViews() {
  generateDashboardStats();
  populateAttendanceTaskRefs();
  generateProjectDashboard();
  generateAnnouncementsStream();
  generateStaffDirectory();
  generateDeploymentsGrid();
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
  renderAuditLogTable();
  injectAdminClearButtons();
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 9: DASHBOARD STATS
   ═══════════════════════════════════════════════════════════════════════ */

function generateDashboardStats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const active = projects.filter(p => !p.archived);
  const overdue = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    return new Date(p.deadline) < today;
  });
  const dueSoon = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    const diff = Math.ceil((new Date(p.deadline) - today) / 86400000);
    return diff >= 0 && diff <= 3;
  });
  const staffCount = registeredUsersDB.filter(u => u.role === 'STAFF').length;
  const todayStr = Utils.todayLocalISO();
  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  set('statActiveProjects', active.length);
  set('statOverdue', overdue.length);
  set('statDueSoon', dueSoon.length);
  set('statStaffCount', staffCount);
  set('statTodayCheckins', todayCheckins);
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 10: PROJECTS
   ═══════════════════════════════════════════════════════════════════════ */

function formatCreatedBy(item) {
  if (!item) return '';
  const name = item.creator || item.createdBy || item.created_by || '';
  if (!name) return '';
  const date = item.created_at
    ? Utils.fmtDate(item.created_at, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  return '<div class="card-creator-footer">👤 Created by <b>' + esc(name) + '</b>' +
    (date ? ' • ' + esc(date) : '') + '</div>';
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
      ? p.tags.split(',').filter(t => t.trim()).map(t => '<span class="card-tag">' + esc(t.trim()) + '</span>').join('')
      : '';
    const reporterHtml = p.reporter
      ? '<div class="card-reporter-chip"><div class="mini-avatar">' +
        esc(p.reporter.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()) +
        '</div><span>' + esc(p.reporter) + '</span></div>'
      : '';

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;">' +
        '<div class="card-category">' + esc(p.category || '') + '</div>' +
        '<span style="font-size:0.7rem;font-weight:800;">' + esc(p.priority || 'MEDIUM') + '</span>' +
      '</div>' +
      '<div class="card-title">' + esc(p.title) + '</div>' +
      reporterHtml +
      (tagsHtml ? '<div class="card-tags">' + tagsHtml + '</div>' : '') +
      '<div class="card-meta"><span>📅 ' + esc(p.deadline || '—') + '</span>' +
        '<span class="status-badge ' + statusClass + '">' + esc(p.status || 'ACTIVE') + '</span></div>' +
      '<div class="card-actions"><button class="card-action-btn profile-btn" data-id="' + esc(p.id) + '" type="button">📋 View Details</button></div>' +
      formatCreatedBy({ creator: p.created_by, created_at: p.created_at });
    container.appendChild(card);
  });

  container.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openProjectProfile(parseInt(btn.dataset.id, 10)); });
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

  document.querySelectorAll('.priority-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === (p.priority || 'MEDIUM'));
  });

  const subInfo = document.getElementById('profileSubmissionInfo');
  const subBtn = document.getElementById('profileSubmitOutputBtn');
  if (subInfo && subBtn) {
    if (p.submitted_by) {
      subInfo.innerHTML =
        '<div style="color:#9ae6b4; font-weight:600;">✓ Submitted by ' + esc(p.submitted_by) + '</div>' +
        '<div style="font-size:0.78rem; color:var(--text-muted); margin-top:0.25rem;">' +
          esc(Utils.fmtDateTime(p.submitted_at)) + '</div>' +
        (p.submission_text
          ? '<div style="margin-top:0.5rem; background:rgba(0,0,0,0.2); padding:0.6rem; border-radius:6px; white-space:pre-line; font-size:0.82rem;">' +
            esc(p.submission_text) + '</div>'
          : '') +
        (p.submission_file
          ? '<div style="margin-top:0.5rem;"><a href="#" data-download-file="' + esc(p.submission_file) + '" class="btn btn-ghost" style="font-size:0.78rem; text-decoration:none;">⬇ Download Attachment</a></div>'
          : '');
      subBtn.innerText = '🔄 Update Output';
    } else {
      subInfo.textContent = 'No output submitted yet.';
      subBtn.innerText = '📤 Submit Output';
    }

    subInfo.querySelectorAll('[data-download-file]').forEach(a => {
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = await Utils.signedUrl(supabaseClient, CONFIG.STORAGE_BUCKET, a.dataset.downloadFile);
        if (url) window.open(url, '_blank');
        else triggerNotificationToast('Could not generate download link.');
      });
    });

    const isAssigned = p.reporter && p.reporter.toLowerCase() === currentUser.name.toLowerCase();
    if (isAssigned) {
      subBtn.style.display = '';
      subBtn.onclick = () => openProjectSubmissionModal(p.id);
    } else {
      subBtn.style.display = 'none';
      if (!p.submitted_by) {
        subInfo.innerHTML = '<div style="background:rgba(139,92,246,0.15); border:1px solid rgba(139,92,246,0.4); border-radius:8px; padding:0.7rem 0.9rem; font-size:0.82rem; color:#ddd6fe;">🔒 Only <b>' + esc(p.reporter || 'the assigned member') + '</b> can submit output for this project.</div>';
      }
    }
  }

  applyProfilePermissions(p);
  document.getElementById('projectProfileModal').classList.add('active');
}

function applyProfilePermissions(p) {
  const canEdit = isPrivileged();
  const archiveBtn  = document.getElementById('profileArchiveBtn');
  const deleteBtn   = document.getElementById('profileDeleteBtn');
  const requestBtn  = document.getElementById('profileRequestArchiveBtn');
  const staffNotice = document.getElementById('profileStaffNotice');
  const saveBtn     = document.getElementById('profileSaveBtn');

  if (archiveBtn)  archiveBtn.style.display  = canEdit ? '' : 'none';
  if (deleteBtn)   deleteBtn.style.display   = canEdit ? '' : 'none';
  if (saveBtn)     saveBtn.style.display     = canEdit ? '' : 'none';
  if (staffNotice) staffNotice.style.display = canEdit ? 'none' : 'flex';

  ['profileProgressInput','profileAssignedReporter','profileNotes','profileTags','profileStatusSelect']
    .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !canEdit; });

  document.querySelectorAll('.priority-select-btn').forEach(btn => {
    btn.disabled = !canEdit;
    btn.style.cursor = canEdit ? 'pointer' : 'not-allowed';
    btn.style.opacity = canEdit ? '1' : '0.5';
  });

  if (requestBtn) {
    if (canEdit) requestBtn.style.display = 'none';
    else {
      const hasPending = archiveRequests.some(r => r.project_id === p.id && r.requester === currentUser.name && r.status === 'PENDING');
      requestBtn.style.display = '';
      if (hasPending) { requestBtn.disabled = true; requestBtn.innerText = '⏳ Request Pending'; }
      else { requestBtn.disabled = false; requestBtn.innerText = '📤 Request Archive'; }
    }
  }
}

async function saveProjectProfile() {
  const p = projects.find(x => x.id === activeProfileId);
  if (!p) return;
  if (!isPrivileged()) { triggerNotificationToast('Admin access required.'); return; }
  const activePriorityBtn = document.querySelector('.priority-select-btn.active');
  const priority = activePriorityBtn ? activePriorityBtn.dataset.priority : 'MEDIUM';
  const updates = {
    progress: parseInt(document.getElementById('profileProgressInput').value, 10) || 0,
    reporter: document.getElementById('profileAssignedReporter').value.trim(),
    notes: document.getElementById('profileNotes').value.trim(),
    tags: document.getElementById('profileTags').value.trim(),
    status: document.getElementById('profileStatusSelect').value,
    priority
  };
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('projects').update(updates).eq('id', p.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  }
  Object.assign(p, updates);
  await logAudit('update_project', 'project', p.id, p.title, 'Progress: ' + updates.progress + '%, Status: ' + updates.status);
  flushCachedCollections();
  rebuildApplicationDOMViews();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('✓ Project saved.');
}

async function archiveProject(projectId) {
  if (!isPrivileged()) { triggerNotificationToast('Admin access required.'); return; }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (!confirm('Archive "' + p.title + '"?')) return;
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('projects').update({ archived: true }).eq('id', projectId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) { triggerNotificationToast('Archive failed: ' + err.message); return; }
  }
  p.archived = true;
  await logAudit('archive_project', 'project', p.id, p.title, 'Moved to archive');
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Project archived.');
}

async function deleteProject(projectId) {
  if (!isPrivileged()) { triggerNotificationToast('Admin access required.'); return; }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (!confirm('Permanently delete "' + p.title + '"?')) return;
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('projects').delete().eq('id', projectId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Delete blocked.');
    } catch (err) { triggerNotificationToast('Delete failed: ' + err.message); return; }
  }
  projects = projects.filter(x => x.id !== projectId);
  await logAudit('delete_project', 'project', projectId, p.title, 'Permanently deleted');
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Project deleted.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 11: PROJECT OUTPUT SUBMISSION
   ═══════════════════════════════════════════════════════════════════════ */

function openProjectSubmissionModal(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (!p.reporter || p.reporter.toLowerCase() !== currentUser.name.toLowerCase()) {
    triggerNotificationToast('Only the assigned member can submit this output.');
    return;
  }
  activeProfileId = projectId;
  document.getElementById('projectSubModalCategory').innerText = 'PROJECT OUTPUT · ' + (p.category || '');
  document.getElementById('projectSubModalTitle').innerText = p.title;
  const body = document.getElementById('projectSubModalBody');
  const footer = document.getElementById('projectSubModalFooter');
  body.innerHTML =
    '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Project</span><div style="margin-top:0.25rem;font-size:0.95rem;">' + esc(p.title) + '</div></div>' +
    '<div><label class="form-label">Your Output / Report</label><textarea class="form-input" id="projectSubText" rows="6" placeholder="Describe the output of your work on this project..." style="font-family:var(--font-body); resize:vertical;">' + esc(p.submission_text || '') + '</textarea></div>' +
    '<div><label class="form-label">Attach File (optional)</label><input type="file" id="projectSubFile" class="form-input" style="padding:0.5rem;" accept=".pdf,.doc,.docx,.txt,.jpg,.png,.zip"></div>' +
    '<div style="font-size:0.75rem;color:var(--text-muted);">Submitting as <b>' + esc(currentUser.name) + '</b></div>';
  footer.innerHTML =
    '<button class="btn btn-ghost" data-close="projectSubmissionModal" type="button">Cancel</button>' +
    '<button class="btn btn-primary" id="projectSubConfirmBtn" type="button">📤 Submit Output</button>';
  document.getElementById('projectSubConfirmBtn').onclick = () => submitProjectOutput(projectId);
  document.getElementById('projectSubmissionModal').classList.add('active');
}

async function submitProjectOutput(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (!p.reporter || p.reporter.toLowerCase() !== currentUser.name.toLowerCase()) {
    triggerNotificationToast('Only the assigned member can submit this output.');
    return;
  }
  const text = document.getElementById('projectSubText').value.trim();
  const fileInput = document.getElementById('projectSubFile');
  const file = fileInput && fileInput.files[0];
  if (!text && !file) { triggerNotificationToast('Please provide output or attach a file.'); return; }

  let filePath = p.submission_file || null;
  if (file) {
    try { filePath = await Utils.uploadFile(supabaseClient, CONFIG.STORAGE_BUCKET, 'projects/' + p.id, file); }
    catch (err) { triggerNotificationToast(err.message); return; }
  }

  const updates = {
    submission_text: text,
    submission_file: filePath,
    submitted_by: currentUser.name,
    submitted_at: new Date().toISOString()
  };
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('projects').update(updates).eq('id', p.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) { triggerNotificationToast('Error: ' + err.message); return; }
  }
  Object.assign(p, updates);
  await logAudit('submit_project_output', 'project', p.id, p.title, 'Submitted by ' + currentUser.name);
  await dispatchPing(currentUser.name, 'ALL', '📤 ' + currentUser.name + ' submitted output for: "' + p.title + '"');
  flushCachedCollections();
  document.getElementById('projectSubmissionModal').classList.remove('active');
  document.getElementById('projectProfileModal').classList.remove('active');
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Output submitted.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 12: ARCHIVE REQUESTS
   ═══════════════════════════════════════════════════════════════════════ */

async function submitArchiveRequest(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) { triggerNotificationToast('Project not found.'); return; }
  const hasPending = archiveRequests.some(r => r.project_id === projectId && r.requester === currentUser.name && r.status === 'PENDING');
  if (hasPending) { triggerNotificationToast('You already have a pending request.'); return; }
  const payload = {
    project_id: projectId,
    project_title: p.title,
    requester: currentUser.name,
    request_timestamp: Utils.fmtDate(new Date(), { month: 'short', day: 'numeric', year: 'numeric' }),
    status: 'PENDING'
  };
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('archive_requests').insert(payload).select().single();
      if (error) throw error;
      payload.id = data ? data.id : Date.now();
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  } else { payload.id = Date.now(); }
  archiveRequests.push(payload);
  await logAudit('request_archive', 'project', projectId, p.title, 'Archive requested');
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('✓ Archive request submitted.');
}

async function approveArchiveRequest(requestId) {
  if (!isPrivileged()) return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  if (!confirm('Approve this request?')) return;
  if (supabaseClient) {
    try {
      const { error: reqErr } = await supabaseClient.from('archive_requests').update({ status: 'APPROVED' }).eq('id', requestId);
      if (reqErr) throw reqErr;
      const { error: projErr } = await supabaseClient.from('projects').update({ archived: true }).eq('id', req.project_id);
      if (projErr) throw projErr;
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  }
  req.status = 'APPROVED';
  const p = projects.find(x => x.id === req.project_id);
  if (p) p.archived = true;
  await logAudit('approve_archive', 'project', req.project_id, req.project_title, 'Requested by ' + req.requester);
  flushCachedCollections();
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Archive request approved.');
}

async function denyArchiveRequest(requestId) {
  if (!isPrivileged()) return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  if (!confirm('Deny this archive request?')) return;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('archive_requests').update({ status: 'DENIED' }).eq('id', requestId);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  }
  req.status = 'DENIED';
  await logAudit('deny_archive', 'project', req.project_id, req.project_title, 'Denied');
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
  if (!isPrivileged()) { panel.style.display = 'none'; return; }
  const pending = archiveRequests.filter(r => r.status === 'PENDING');
  if (pending.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  panel.innerHTML =
    '<div class="archive-req-header"><span>📥 Pending Archive Requests</span><span class="archive-req-count">' + pending.length + '</span></div>' +
    '<div class="archive-req-list">' +
      pending.map(r =>
        '<div class="archive-req-row">' +
          '<div class="archive-req-info">' +
            '<div style="font-weight:700;font-size:0.9rem;">' + esc(r.project_title) + '</div>' +
            '<div style="font-size:0.75rem;color:var(--text-muted);">Requested by <b>' + esc(r.requester) + '</b> • ' + esc(r.request_timestamp || '') + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">' +
            '<button class="req-approve-btn" data-req-approve="' + esc(r.id) + '" type="button">✓ Approve</button>' +
            '<button class="req-deny-btn" data-req-deny="' + esc(r.id) + '" type="button">✕ Deny</button>' +
          '</div>' +
        '</div>'
      ).join('') +
    '</div>';
  panel.querySelectorAll('[data-req-approve]').forEach(btn =>
    btn.addEventListener('click', () => approveArchiveRequest(parseInt(btn.dataset.reqApprove, 10))));
  panel.querySelectorAll('[data-req-deny]').forEach(btn =>
    btn.addEventListener('click', () => denyArchiveRequest(parseInt(btn.dataset.reqDeny, 10))));
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 13: ANNOUNCEMENTS + STAFF DIRECTORY
   ═══════════════════════════════════════════════════════════════════════ */

function generateAnnouncementsStream() {
  const container = document.getElementById('announcementsStreamContainer');
  if (!container) return;
  container.innerHTML = '';
  const reversed = [...announcements].reverse();
  const canSeeAll = isPrivileged();

  reversed.forEach(ann => {
    const isPingedToMe = currentUser && ann.target === currentUser.name;
    const isBroadcastAll = ann.target === 'ALL';
    const isMine = currentUser && ann.sender === currentUser.name;
    if (!isBroadcastAll && !isPingedToMe && !canSeeAll) return;

    const canDelete = canSeeAll || isMine;
    const node = document.createElement('div');
    node.className = 'announcement-node' + (isPingedToMe ? ' pinged' : '');
    node.innerHTML =
      (canDelete ? '<button class="announcement-delete-btn" title="Delete" data-ann-id="' + esc(ann.id) + '" type="button">✕</button>' : '') +
      '<div class="announcement-meta">' +
        '<span class="announcement-badge-alert">' + (isBroadcastAll ? 'ANNOUNCEMENT' : 'DIRECT MESSAGE') + '</span>' +
        '<span>From <b>' + esc(ann.sender) + '</b></span><span>•</span><span>' + esc(ann.timestamp) + '</span>' +
      '</div>' +
      '<div class="announcement-body">' + esc(ann.text) + '</div>';
    container.appendChild(node);
  });

  if (container.children.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">No announcements.</div>';
  }

  container.querySelectorAll('[data-ann-id]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteAnnouncement(btn.dataset.annId); });
  });
}

async function deleteAnnouncement(annId) {
  if (!confirm('Delete this message?')) return;
  if (String(annId).startsWith('remote-') && supabaseClient) {
    const remoteId = parseInt(String(annId).replace('remote-', ''), 10);
    try {
      const { error } = await supabaseClient.from('pings').delete().eq('id', remoteId);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Failed to delete.'); return; }
  }
  announcements = announcements.filter(a => String(a.id) !== String(annId));
  await logAudit('delete_announcement', 'announcement', annId, 'Message', 'Removed from stream');
  flushCachedCollections();
  generateAnnouncementsStream();
  triggerNotificationToast('Message deleted.');
}

function generateStaffDirectory() {
  const container = document.getElementById('staffDirectoryList');
  if (!container) return;
  container.innerHTML = '';
  if (registeredUsersDB.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">No members loaded.</div>';
    return;
  }
  registeredUsersDB.forEach(user => {
    const row = document.createElement('div');
    row.className = 'staff-directory-row' + (user.role === 'ADMIN' ? ' role-admin' : '');
    row.innerHTML =
      '<div class="staff-info-block">' +
        '<div class="staff-avatar-mini">' + esc(user.code) + '</div>' +
        '<div class="staff-details">' +
          '<span class="staff-row-name">' + esc(user.name) + '</span>' +
          '<span class="staff-row-role">' + esc(user.role) + '</span>' +
        '</div>' +
      '</div>';
    container.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 14: FIELD OPERATIONS
   ═══════════════════════════════════════════════════════════════════════ */

function generateDeploymentsGrid() {
  const container = document.getElementById('beatsGrid');
  if (!container) return;
  container.innerHTML = '';
  const visible = deployments.filter(d => !d.archived);
  const canManage = isPrivileged();

  if (visible.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No field operations yet.</div>';
    return;
  }

  visible.forEach(d => {
    const reporters = (d.reporter || '').split(',').map(r => r.trim()).filter(r => r);
    const card = document.createElement('div');
    card.className = 'card card-interactive';
    card.innerHTML =
      '<span class="priority-flag priority-' + esc(d.priority) + '">' + esc(d.priority) + '</span>' +
      '<div class="card-category">FIELD OPERATION</div>' +
      '<div class="card-title">' + esc(d.title) + '</div>' +
      (d.location ? '<div style="font-size:0.82rem;color:var(--text-muted);">📍 ' + esc(d.location) + '</div>' : '') +
      '<div style="font-size:0.85rem;color:var(--text-muted);">👥 ' + reporters.length + ' member(s): <b>' +
        esc(reporters.join(', ')) + '</b></div>' +
      (d.description
        ? '<div style="font-size:0.8rem;color:var(--text-muted); white-space:pre-line; line-height:1.5;">' +
          esc(d.description.substring(0, 120)) + (d.description.length > 120 ? '…' : '') + '</div>'
        : '') +
      '<div class="card-actions"><button class="card-action-btn deployment-view-btn" data-deployment-id="' + esc(d.id) + '" type="button">📡 View Details</button></div>' +
      (canManage ? '<div class="card-action-row"><button class="card-action-btn archive-btn" data-deployment-archive="' + esc(d.id) + '" type="button">🗄 Archive</button></div>' : '') +
      formatCreatedBy({ creator: d.createdBy, created_at: d.created_at });
    container.appendChild(card);
  });

  container.querySelectorAll('[data-deployment-id]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openDeploymentProfile(parseInt(btn.dataset.deploymentId, 10)); }));
  container.querySelectorAll('[data-deployment-archive]').forEach(btn =>
    btn.addEventListener('click', () => archiveDeployment(parseInt(btn.dataset.deploymentArchive, 10))));
}

function populateReporterCheckboxes() {
  const container = document.getElementById('reporterCheckboxList');
  if (!container) return;
  const staffUsers = registeredUsersDB.filter(u => isAssignable(u.role));
  if (staffUsers.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No staff members available.</div>';
    return;
  }
  container.innerHTML = staffUsers.map(u =>
    '<label style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem; border-radius:6px; cursor:pointer;">' +
      '<input type="checkbox" value="' + esc(u.name) + '" style="width:18px; height:18px; accent-color:var(--accent-light); cursor:pointer;">' +
      '<div style="display:flex; align-items:center; gap:0.5rem; flex:1;">' +
        '<div class="staff-avatar-mini">' + esc(u.code || '??') + '</div>' +
        '<span style="font-weight:600; font-size:0.9rem;">' + esc(u.name) + '</span>' +
        '<span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">' + esc(u.role) + '</span>' +
      '</div>' +
    '</label>'
  ).join('');
}

function openDeploymentModal() {
  populateReporterCheckboxes();
  document.getElementById('addBeatModal').classList.add('active');
}

function openDeploymentProfile(deploymentId) {
  const d = deployments.find(x => x.id === deploymentId);
  if (!d) return;
  activeDeploymentId = deploymentId;
  const canManage = isPrivileged();
  const reporters = (d.reporter || '').split(',').map(r => r.trim()).filter(r => r);

  document.getElementById('deploymentModalCategory').innerText = 'FIELD OPERATION · ' + d.priority;
  document.getElementById('deploymentModalTitle').innerText = d.title;

  const body = document.getElementById('deploymentModalBody');
  body.innerHTML =
    (d.location ? '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">📍 Location</span><div style="margin-top:0.25rem; font-size:0.95rem;">' + esc(d.location) + '</div></div>' : '') +
    '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">👥 Assigned Members (' + reporters.length + ')</span>' +
      '<div style="margin-top:0.5rem; display:flex; flex-wrap:wrap; gap:0.5rem;">' +
        reporters.map(r => '<span style="background:rgba(76,110,73,0.25); border:1px solid rgba(76,110,73,0.5); color:#9ae6b4; padding:0.35rem 0.75rem; border-radius:20px; font-size:0.82rem; font-weight:600;">' + esc(r) + '</span>').join('') +
      '</div>' +
    '</div>' +
    '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">📅 Created</span><div style="margin-top:0.25rem; font-size:0.9rem;">' + esc(Utils.fmtDateTime(d.created_at)) + '</div></div>' +
    (d.description ? '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">📝 Instructions</span><div style="margin-top:0.4rem; font-size:0.9rem; white-space:pre-line; line-height:1.6; background:rgba(0,0,0,0.2); padding:0.75rem; border-radius:6px;">' + esc(d.description) + '</div></div>' : '') +
    '<div style="font-size:0.75rem; color:var(--text-muted);">Created by <b>' + esc(d.createdBy || 'Admin') + '</b></div>';

  const actions = document.getElementById('deploymentModalActions');
  actions.innerHTML =
    (canManage ? '<button class="btn btn-ghost" id="pingDeployBtn" style="color:var(--accent-light);" type="button">🔔 Notify All</button>' : '') +
    (canManage ? '<button class="btn btn-ghost" id="archiveDeployBtn" style="color:var(--warning);" type="button">🗄 Archive</button>' : '');

  if (canManage) {
    const pingBtn = document.getElementById('pingDeployBtn');
    if (pingBtn) pingBtn.addEventListener('click', async () => {
      if (reporters.length === 0) { triggerNotificationToast('No members assigned.'); return; }
      for (const r of reporters) {
        await dispatchPing(currentUser.name, r, '📡 Update on "' + d.title + '" — ' + (d.location || 'Location TBD'));
      }
      await logAudit('notify_deployment', 'deployment', d.id, d.title, 'Notified ' + reporters.length + ' member(s)');
      triggerNotificationToast('✓ Notified ' + reporters.length + ' member(s).');
    });
    const archiveBtn = document.getElementById('archiveDeployBtn');
    if (archiveBtn) archiveBtn.addEventListener('click', () => archiveDeployment(d.id));
  }

  document.getElementById('deploymentProfileModal').classList.add('active');
}

async function archiveDeployment(deploymentId) {
  if (!isPrivileged()) { triggerNotificationToast('Admin access required.'); return; }
  const d = deployments.find(x => x.id === deploymentId);
  if (!d) { triggerNotificationToast('Operation not found.'); return; }
  if (!confirm('Archive this operation?')) return;
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('deployments').update({ archived: true }).eq('id', deploymentId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) { triggerNotificationToast('Archive failed: ' + err.message); return; }
  }
  d.archived = true;
  await logAudit('archive_deployment', 'deployment', d.id, d.title, 'Assigned members: ' + (d.reporter || '—'));
  flushCachedCollections();
  document.getElementById('deploymentProfileModal').classList.remove('active');
  generateDeploymentsGrid();
  triggerNotificationToast('✓ Operation archived.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 15: ASSIGNMENTS
   ═══════════════════════════════════════════════════════════════════════ */

function generateAssignmentsGrid() {
  const container = document.getElementById('assignmentsGrid');
  if (!container) return;
  container.innerHTML = '';

  const visible = assignments.filter(a => !a.archived);
  const canManage = isPrivileged();

  if (visible.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No tasks yet.</div>';
    return;
  }

  visible.forEach(a => {
    const card = document.createElement('div');
    card.className = 'card';

    let statusBadge = '<span class="status-badge status-active">PENDING</span>';
    if (a.status === 'SUBMITTED') statusBadge = '<span class="status-badge status-review">📤 SUBMITTED</span>';
    if (a.status === 'REVIEWED')  statusBadge = '<span class="status-badge status-published">✓ REVIEWED</span>';

    const isAssignee = currentUser && currentUser.name.toLowerCase() === (a.assignee || '').toLowerCase();
    const canView = isAssignee || canManage;

    let actionBtn = '';
    if (canView) {
      if (isAssignee && a.status === 'PENDING') {
        actionBtn = '<button class="card-action-btn" data-submit-id="' + esc(a.id) + '" style="background:rgba(76,110,73,0.3); color:#9ae6b4; border-color:rgba(76,110,73,0.6);" type="button">📤 Submit Work</button>';
      } else if (a.submitted_by) {
        actionBtn = '<button class="card-action-btn" data-submit-id="' + esc(a.id) + '" type="button">👁 View Submission</button>';
      } else {
        actionBtn = '<button class="card-action-btn" data-submit-id="' + esc(a.id) + '" type="button">👁 View Task</button>';
      }
    }

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">' +
        '<div class="card-title" style="font-size:1.05rem;flex:1;">' + esc(a.title) + '</div>' +
        statusBadge +
      '</div>' +
      (a.description ? '<div style="font-size:0.82rem;color:var(--text-muted); white-space:pre-line; line-height:1.5;">' + esc(a.description) + '</div>' : '') +
      '<div style="font-size:0.85rem;color:var(--text-muted);">👤 Assigned to: <b>' + esc(a.assignee || '—') + '</b></div>' +
      (a.due_date ? '<div style="font-size:0.8rem;color:var(--text-muted);">📅 Due: ' + esc(a.due_date) + '</div>' : '') +
      (a.submitted_by ? '<div style="font-size:0.78rem; color:#9ae6b4;">📎 Submitted by ' + esc(a.submitted_by) + ' on ' + esc(Utils.fmtDate(a.submitted_at)) + '</div>' : '') +
      (actionBtn ? '<div class="card-action-row">' + actionBtn + '</div>' : '') +
      (canManage && a.status !== 'ARCHIVED' ? '<div class="card-action-row"><button class="card-action-btn archive-btn" data-asg-archive="' + esc(a.id) + '" type="button">🗄 Archive</button></div>' : '') +
      formatCreatedBy({ creator: a.created_by, created_at: a.created_at });
    container.appendChild(card);
  });

  container.querySelectorAll('[data-submit-id]').forEach(btn =>
    btn.addEventListener('click', () => openSubmissionModal(parseInt(btn.dataset.submitId, 10))));
  container.querySelectorAll('[data-asg-archive]').forEach(btn =>
    btn.addEventListener('click', () => archiveAssignment(parseInt(btn.dataset.asgArchive, 10))));
}

function populateAssigneeRadios() {
  const container = document.getElementById('assigneeRadioList');
  if (!container) return;
  const staffUsers = registeredUsersDB.filter(u => isAssignable(u.role));
  if (staffUsers.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No staff members available. Create staff accounts first.</div>';
    return;
  }
  container.innerHTML = staffUsers.map((u, idx) =>
    '<label style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem; border-radius:6px; cursor:pointer;">' +
      '<input type="radio" name="assignee" value="' + esc(u.name) + '" ' + (idx === 0 ? 'checked' : '') + ' style="width:18px; height:18px; accent-color:var(--accent-light); cursor:pointer;">' +
      '<div style="display:flex; align-items:center; gap:0.5rem; flex:1;">' +
        '<div class="staff-avatar-mini">' + esc(u.code || '??') + '</div>' +
        '<span style="font-weight:600; font-size:0.9rem;">' + esc(u.name) + '</span>' +
        '<span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">' + esc(u.role) + '</span>' +
      '</div>' +
    '</label>'
  ).join('');
}

function openAssignmentModal() {
  populateAssigneeRadios();
  document.getElementById('addAssignmentModal').classList.add('active');
}

function openSubmissionModal(assignmentId) {
  const a = assignments.find(x => x.id === assignmentId);
  if (!a) return;
  activeSubmissionId = assignmentId;

  const isAssignee = currentUser.name.toLowerCase() === (a.assignee || '').toLowerCase();
  const canManage = isPrivileged();
  const canSubmit = isAssignee && a.status === 'PENDING';
  const canReview = canManage && a.status === 'SUBMITTED';
  const isReadOnlyForAdmin = canManage && !isAssignee;

  document.getElementById('submissionModalCategory').innerText = 'TASK · ' + (a.priority || 'MEDIUM');
  document.getElementById('submissionModalTitle').innerText = a.title;

  const body = document.getElementById('submissionModalBody');
  const footer = document.getElementById('submissionModalFooter');

  if (canSubmit) {
    body.innerHTML =
      (a.description ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Description</span><div style="margin-top:0.25rem;font-size:0.9rem;white-space:pre-line;line-height:1.5;">' + esc(a.description) + '</div></div>' : '') +
      '<div><label class="form-label">Your Work / Report</label><textarea class="form-input" id="submissionText" rows="6" placeholder="Describe your progress, findings, or next steps..." style="font-family:var(--font-body); resize:vertical;"></textarea></div>' +
      '<div><label class="form-label">Attach File (optional)</label><input type="file" id="submissionFile" class="form-input" style="padding:0.5rem;" accept=".pdf,.doc,.docx,.txt,.jpg,.png,.zip"></div>' +
      '<div style="font-size:0.75rem;color:var(--text-muted);">Submitting as <b>' + esc(currentUser.name) + '</b></div>';
    footer.innerHTML =
      '<button class="btn btn-ghost" data-close="assignmentSubmissionModal" type="button">Cancel</button>' +
      '<button class="btn btn-primary" id="confirmSubmitBtn" type="button">📤 Submit Task</button>';
    document.getElementById('confirmSubmitBtn').addEventListener('click', submitAssignment);
  } else {
    const readOnlyBanner = isReadOnlyForAdmin && a.status === 'PENDING'
      ? '<div style="background:rgba(139,92,246,0.15); border:1px solid rgba(139,92,246,0.4); border-radius:8px; padding:0.85rem 1rem; font-size:0.85rem; color:#ddd6fe; display:flex; gap:0.6rem; align-items:center;">' +
        '<span style="font-size:1.2rem;">🔒</span><span>Only <b>' + esc(a.assignee || 'the assignee') + '</b> can submit output for this task. You are viewing in read-only mode.</span></div>'
      : '';

    body.innerHTML =
      readOnlyBanner +
      '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Assigned To</span><div style="margin-top:0.25rem;font-size:0.95rem;">' + esc(a.assignee || '—') + '</div></div>' +
      '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Submitted By</span><div style="margin-top:0.25rem;font-size:0.95rem;">' + esc(a.submitted_by || '—') + '</div></div>' +
      '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Submitted At</span><div style="margin-top:0.25rem;font-size:0.9rem;">' + esc(Utils.fmtDateTime(a.submitted_at)) + '</div></div>' +
      (a.submission_text ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Work Submitted</span><div style="margin-top:0.4rem;font-size:0.9rem;white-space:pre-line;line-height:1.6;background:rgba(0,0,0,0.2);padding:0.75rem;border-radius:6px;">' + esc(a.submission_text) + '</div></div>' : '') +
      (a.submission_file ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Attached File</span><div style="margin-top:0.4rem;"><a href="#" data-download-file="' + esc(a.submission_file) + '" class="btn btn-ghost" style="font-size:0.8rem;text-decoration:none;">⬇ Download Attachment</a></div></div>' : '') +
      (a.review_notes ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Admin Review</span><div style="margin-top:0.4rem;font-size:0.85rem;">' + esc(a.review_notes) + '</div></div>' : '');

    let footerHtml = '<button class="btn btn-ghost" data-close="assignmentSubmissionModal" type="button">Close</button>';
    if (canReview) {
      footerHtml =
        '<button class="btn btn-ghost" id="rejectSubmissionBtn" style="color:var(--warning);" type="button">↩ Send Back</button>' +
        '<button class="btn btn-primary" id="approveSubmissionBtn" type="button">✓ Approve</button>';
    }
    footer.innerHTML = footerHtml;

    if (canReview) {
      document.getElementById('approveSubmissionBtn').addEventListener('click', () => reviewSubmission(true));
      document.getElementById('rejectSubmissionBtn').addEventListener('click', () => reviewSubmission(false));
    }

    body.querySelectorAll('[data-download-file]').forEach(a2 => {
      a2.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = await Utils.signedUrl(supabaseClient, CONFIG.STORAGE_BUCKET, a2.dataset.downloadFile);
        if (url) window.open(url, '_blank');
        else triggerNotificationToast('Could not generate download link.');
      });
    });
  }

  document.getElementById('assignmentSubmissionModal').classList.add('active');
}

async function submitAssignment() {
  const a = assignments.find(x => x.id === activeSubmissionId);
  if (!a) return;
  if (currentUser.name.toLowerCase() !== (a.assignee || '').toLowerCase()) {
    triggerNotificationToast('Only the assigned member can submit this task.'); return;
  }
  const text = document.getElementById('submissionText').value.trim();
  const fileInput = document.getElementById('submissionFile');
  const file = fileInput && fileInput.files[0];
  if (!text && !file) { triggerNotificationToast('Please provide work or attach a file.'); return; }

  let filePath = '';
  if (file) {
    try { filePath = await Utils.uploadFile(supabaseClient, CONFIG.STORAGE_BUCKET, 'tasks/' + a.id, file); }
    catch (err) { triggerNotificationToast(err.message); return; }
  }

  const updates = {
    submission_text: text,
    submission_file: filePath || null,
    submitted_by: currentUser.name,
    submitted_at: new Date().toISOString(),
    status: 'SUBMITTED'
  };
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('assignments').update(updates).eq('id', a.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  }
  Object.assign(a, updates);
  await logAudit('submit_task', 'assignment', a.id, a.title, 'Submitted by ' + currentUser.name);
  await dispatchPing(currentUser.name, a.created_by || 'ALL', '📤 ' + currentUser.name + ' submitted: "' + a.title + '"');
  flushCachedCollections();
  document.getElementById('assignmentSubmissionModal').classList.remove('active');
  generateAssignmentsGrid();
  triggerNotificationToast('✓ Task submitted.');
}

async function reviewSubmission(approved) {
  const a = assignments.find(x => x.id === activeSubmissionId);
  if (!a) return;
  const updates = {
    status: approved ? 'REVIEWED' : 'PENDING',
    reviewed_by: currentUser.name,
    reviewed_at: new Date().toISOString(),
    review_notes: approved ? 'Approved by ' + currentUser.name : 'Returned for revision'
  };
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('assignments').update(updates).eq('id', a.id);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  }
  Object.assign(a, updates);
  await logAudit(approved ? 'approve_submission' : 'reject_submission', 'assignment', a.id, a.title, approved ? 'Approved' : 'Returned');
  await dispatchPing(currentUser.name, a.submitted_by, approved
    ? '✅ Your submission "' + a.title + '" was approved.'
    : '↩ Your submission "' + a.title + '" needs revision.');
  flushCachedCollections();
  document.getElementById('assignmentSubmissionModal').classList.remove('active');
  generateAssignmentsGrid();
  triggerNotificationToast(approved ? '✓ Approved.' : '↩ Returned.');
}

async function archiveAssignment(asgId) {
  if (!confirm('Archive this task?')) return;
  const a = assignments.find(x => x.id === asgId);
  if (!a) return;
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('assignments').update({ archived: true }).eq('id', asgId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  }
  a.archived = true;
  await logAudit('archive_assignment', 'assignment', a.id, a.title, 'Archived');
  flushCachedCollections();
  generateAssignmentsGrid();
  triggerNotificationToast('Task archived.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 16: EVENTS + CALENDAR
   ═══════════════════════════════════════════════════════════════════════ */

function generateEventsTrackerChecklist() {
  const container = document.getElementById('eventsChecklistContainer');
  if (!container) return;
  container.innerHTML = '';
  if (events.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">No upcoming events.</div>';
    return;
  }
  events.forEach(evt => {
    const div = document.createElement('div');
    div.className = 'event-row' + (evt.completed ? ' done' : '');
    div.innerHTML =
      '<div><div style="font-weight:600;">' + esc(evt.name) + '</div>' +
      '<div style="font-size:0.75rem;color:var(--text-muted);">' + esc(evt.date || '') + '</div></div>';
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
    const dayProjects = projects.filter(p => p.deadline === dateStr && !p.archived);
    const dayTasks = assignments.filter(a => a.due_date === dateStr && !a.archived);
    dayProjects.forEach(p => {
      const entry = document.createElement('div');
      entry.className = 'cal-entry';
      entry.innerText = '📋 ' + p.title;
      cell.appendChild(entry);
    });
    dayTasks.forEach(t => {
      const entry = document.createElement('div');
      entry.className = 'cal-entry';
      entry.style.background = 'rgba(139, 92, 246, 0.4)';
      entry.innerText = '🔔 ' + t.title;
      cell.appendChild(entry);
    });
    cell.addEventListener('click', () => openCalendarDayModal(dateStr));
    container.appendChild(cell);
  }
}

function openCalendarDayModal(dateStr) {
  const title = document.getElementById('calendarDayTitle');
  const body = document.getElementById('calendarDayBody');
  if (!title || !body) return;
  const d = new Date(dateStr + 'T00:00:00');
  title.innerText = '📅 ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const dayProjects = projects.filter(p => p.deadline === dateStr && !p.archived);
  const dayTasks = assignments.filter(a => a.due_date === dateStr && !a.archived);
  const dayEvents = events.filter(e => e.date === dateStr && !e.archived);

  if (dayProjects.length === 0 && dayTasks.length === 0 && dayEvents.length === 0) {
    body.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:2rem;">No items scheduled on this date.</div>';
    document.getElementById('calendarDayModal').classList.add('active');
    return;
  }
  let html = '';
  dayProjects.forEach(p => {
    html += '<div class="cal-day-item"><div class="cal-item-title">📋 ' + esc(p.title) + '</div>' +
      '<div class="cal-item-meta"><span>📁 Project</span><span>Status: <b>' + esc(p.status || 'ACTIVE') + '</b></span><span>Priority: <b>' + esc(p.priority || 'MEDIUM') + '</b></span></div>' +
      (p.reporter ? '<div class="cal-item-meta"><span>👤 Assigned to <b>' + esc(p.reporter) + '</b></span></div>' : '') +
      (p.notes ? '<div class="cal-item-notes">' + esc(p.notes) + '</div>' : '') + '</div>';
  });
  dayTasks.forEach(t => {
    html += '<div class="cal-day-item" style="border-left-color:#8b5cf6;"><div class="cal-item-title">🔔 ' + esc(t.title) + '</div>' +
      '<div class="cal-item-meta"><span>👤 Task</span><span>Assignee: <b>' + esc(t.assignee || '—') + '</b></span><span>Status: <b>' + esc(t.status || 'PENDING') + '</b></span></div>' +
      (t.description ? '<div class="cal-item-notes">' + esc(t.description) + '</div>' : '') + '</div>';
  });
  dayEvents.forEach(e => {
    html += '<div class="cal-day-item" style="border-left-color:#fbd38d;"><div class="cal-item-title">📌 ' + esc(e.name) + '</div>' +
      '<div class="cal-item-meta"><span>Event' + (e.completed ? ' • ✅ Completed' : '') + '</span></div></div>';
  });
  body.innerHTML = html;
  document.getElementById('calendarDayModal').classList.add('active');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 17: ATTENDANCE
   ═══════════════════════════════════════════════════════════════════════ */

const getTodayStr = () => Utils.todayLocalISO();

function hasAnyCheckInToday() {
  if (!currentUser) return false;
  const today = getTodayStr();
  return attendanceLogs.some(log => log.reporter === currentUser.name && log.date === today);
}

function getActiveAttendanceSession() {
  if (!currentUser) return null;
  const today = getTodayStr();
  const todays = attendanceLogs
    .filter(l => l.reporter === currentUser.name && l.date === today)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return todays.find(l => !l.check_out_time) || null;
}

function populateAttendanceTaskRefs() {
  const select = document.getElementById('attendanceTaskRef');
  if (!select || !currentUser) return;
  const myDeployments = deployments.filter(d =>
    !d.archived && (d.reporter || '').split(',').map(s => s.trim()).includes(currentUser.name)
  );
  select.innerHTML = '<option value="">— Not linked —</option>';
  myDeployments.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id + '|' + d.title;
    opt.textContent = '📡 ' + d.title + (d.location ? ' — ' + d.location : '');
    select.appendChild(opt);
  });
  if (myDeployments.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = 'No active deployments';
    select.appendChild(opt);
  }
}

function updateAttendanceButtons() {
  const btnIn = document.getElementById('checkInBtn');
  const btnOut = document.getElementById('checkOutBtn');
  const statusEl = document.getElementById('attendanceTodayStatus');
  if (!btnIn || !btnOut || !statusEl) return;

  const activeSession = getActiveAttendanceSession();
  const anyCheckIn = hasAnyCheckInToday();

  if (activeSession) {
    btnIn.disabled = true;
    btnIn.textContent = '✓ Checked In';
    btnIn.style.background = 'var(--success)';
    btnOut.disabled = false;
    btnOut.style.background = '';
    statusEl.innerHTML = '✓ Checked in at <b>' + esc(activeSession.time) + '</b>' +
      (activeSession.location ? ' · ' + esc(activeSession.location) : '') +
      ' · Not yet checked out';
  } else if (anyCheckIn) {
    btnIn.disabled = false;
    btnIn.textContent = '📍 Check In Again';
    btnIn.style.background = '';
    btnOut.disabled = true;
    btnOut.style.background = '';
    statusEl.innerHTML = '✓ You have already completed a session today. You can check in again if needed.';
  } else {
    btnIn.disabled = false;
    btnIn.textContent = '📍 Check In';
    btnIn.style.background = '';
    btnOut.disabled = true;
    btnOut.style.background = '';
    statusEl.innerHTML = 'You have not checked in today.';
  }
}

function renderAttendanceTable() {
  const tbody = document.getElementById('attendanceTableBody');
  const emptyRow = document.getElementById('attendanceEmptyRow');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr:not(#attendanceEmptyRow)')).forEach(r => r.remove());
  const q = attendanceSearchQuery.toLowerCase();
  const subset = attendanceLogs.filter(log =>
    (log.reporter || '').toLowerCase().includes(q) ||
    (log.date || '').includes(attendanceSearchQuery) ||
    (log.location && log.location.toLowerCase().includes(q)) ||
    (log.task_ref && log.task_ref.toLowerCase().includes(q))
  );
  if (subset.length === 0) { if (emptyRow) emptyRow.style.display = ''; return; }
  if (emptyRow) emptyRow.style.display = 'none';

  subset.slice(0, 100).forEach((log, idx) => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    tr.innerHTML =
      '<td style="padding:0.75rem 1.25rem;">' + (idx + 1) + '</td>' +
      '<td style="padding:0.75rem 1rem;font-weight:600;">' + esc(log.reporter) + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + esc(log.date) + '</td>' +
      '<td style="padding:0.75rem 1rem;color:#9ae6b4;">' + esc(log.time) + '</td>' +
      '<td style="padding:0.75rem 1rem;color:' + (log.check_out_time ? '#fc8181' : 'var(--text-muted)') + ';">' + esc(log.check_out_time || '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;font-size:0.75rem;">' + esc((log.lat || '—') + ', ' + (log.lon || '—')) + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + esc(log.location || '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;font-size:0.78rem;">' + (log.task_ref ? '📡 ' + esc(log.task_ref) : '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + esc(log.note || '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;">' + esc(log.role) + '</td>' +
      '<td style="padding:0.75rem 1rem;"><button class="card-action-btn" data-map-idx="' + idx + '" style="padding:0.25rem 0.5rem; font-size:0.85rem;" type="button">🗺️</button></td>';
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-map-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.mapIdx, 10);
      const log = subset[idx];
      if (log) openGeoMap(log);
    });
  });
}

function openGeoMap(log) {
  if (!log) return;
  const info = document.getElementById('geoMapReporterInfo');
  info.innerHTML =
    '<div style="display:flex; flex-wrap:wrap; gap:1rem; align-items:center;">' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">NAME</span><div style="font-weight:700;">' + esc(log.reporter) + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">DATE</span><div style="font-weight:600;">' + esc(log.date) + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">IN</span><div style="font-weight:600; color:#9ae6b4;">' + esc(log.time) + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">OUT</span><div style="font-weight:600; color:' + (log.check_out_time ? '#fc8181' : 'var(--text-muted)') + ';">' + esc(log.check_out_time || '—') + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">LOCATION</span><div style="font-weight:600;">' + esc(log.location || '—') + '</div></div>' +
      (log.task_ref ? '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">LINKED TO</span><div style="font-weight:600;">📡 ' + esc(log.task_ref) + '</div></div>' : '') +
    '</div>' +
    (log.note ? '<div style="margin-top:0.5rem; font-size:0.82rem; color:var(--text-muted);">📝 ' + esc(log.note) + '</div>' : '');

  const lat = parseFloat(log.lat);
  const lon = parseFloat(log.lon);
  const bbox = (lon - 0.008) + ',' + (lat - 0.008) + ',' + (lon + 0.008) + ',' + (lat + 0.008);
  document.getElementById('geoMapIframe').src =
    'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + lat + ',' + lon;
  document.getElementById('geoMapOpenBtn').href = 'https://www.google.com/maps?q=' + lat + ',' + lon;
  document.getElementById('geoMapModal').classList.add('active');
}

function updateAttendanceStats() {
  const today = Utils.todayLocalISO();
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

async function reverseGeocodeLabel(lat, lon) {
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lon);
    const data = await res.json();
    const a = data.address || {};
    return a.suburb || a.village || a.town || a.city || a.county || a.state || 'Unknown Location';
  } catch { return 'Location unavailable'; }
}

async function processCheckIn() {
  const btn = document.getElementById('checkInBtn');
  if (!btn || !currentUser) return;
  if (getActiveAttendanceSession()) {
    triggerNotificationToast('You are already checked in. Please check out first.');
    return;
  }

  btn.disabled = true;
  btn.innerText = '⏳ Locating...';

  if (!navigator.geolocation) {
    triggerNotificationToast('Geolocation not supported.');
    btn.disabled = false;
    btn.innerText = '📍 Check In';
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
    const taskRefSelect = document.getElementById('attendanceTaskRef');
    const taskRefVal = taskRefSelect ? taskRefSelect.value : '';
    let taskRefTitle = '', taskRefId = '';
    if (taskRefVal) {
      const parts = taskRefVal.split('|');
      taskRefId = parts[0] || '';
      taskRefTitle = parts[1] || '';
    }

    const entry = {
      id: 'pending',
      reporter: currentUser.name,
      role: currentUser.role,
      date: Utils.todayLocalISO(),
      time: Utils.fmtTime(now),
      lat: lat.toFixed(6),
      lon: lon.toFixed(6),
      accuracy: Math.round(accuracy),
      location: locationLabel,
      note,
      timestamp: now.toISOString(),
      check_out_time: '', check_out_lat: '', check_out_lon: '', check_out_timestamp: '',
      task_ref: taskRefTitle,
      task_ref_id: taskRefId
    };

    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('attendance').insert({
          reporter: entry.reporter, role: entry.role, date: entry.date, time: entry.time,
          lat: parseFloat(entry.lat), lon: parseFloat(entry.lon), accuracy: entry.accuracy,
          location: entry.location, note: entry.note, timestamp_iso: entry.timestamp,
          task_ref: entry.task_ref, task_ref_id: entry.task_ref_id
        }).select().single();
        if (error) throw error;
        if (data && data.id) entry.id = 'remote-' + data.id;
      } catch (err) {
        triggerNotificationToast('Backend error: ' + err.message);
        btn.disabled = false;
        btn.innerText = '📍 Check In';
        return;
      }
    }

    attendanceLogs.unshift(entry);
    flushCachedCollections();
    renderAttendanceTable();
    updateAttendanceStats();
    updateAttendanceButtons();
    triggerNotificationToast('✓ Checked in at ' + entry.time);
  }, () => {
    btn.disabled = false;
    btn.innerText = '📍 Check In';
    triggerNotificationToast('Location access denied.');
  }, { enableHighAccuracy: true, timeout: 12000 });
}

async function processCheckOut() {
  const btn = document.getElementById('checkOutBtn');
  if (!btn || !currentUser) return;
  const activeSession = getActiveAttendanceSession();
  if (!activeSession) { triggerNotificationToast('You are not currently checked in.'); return; }

  btn.disabled = true;
  btn.innerText = '⏳ Locating...';

  if (!navigator.geolocation) {
    triggerNotificationToast('Geolocation not supported.');
    btn.disabled = false;
    btn.innerText = '🚪 Check Out';
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const now = new Date();
    const updates = {
      check_out_time: Utils.fmtTime(now),
      check_out_lat: lat.toFixed(6),
      check_out_lon: lon.toFixed(6),
      check_out_timestamp: now.toISOString()
    };

    if (supabaseClient && String(activeSession.id).startsWith('remote-')) {
      const remoteId = parseInt(String(activeSession.id).replace('remote-', ''), 10);
      if (!isNaN(remoteId)) {
        try {
          const { error } = await supabaseClient.from('attendance').update(updates).eq('id', remoteId);
          if (error) throw error;
        } catch (err) {
          triggerNotificationToast('Backend error: ' + err.message);
          btn.disabled = false;
          btn.innerText = '🚪 Check Out';
          return;
        }
      }
    }

    Object.assign(activeSession, updates);
    flushCachedCollections();
    renderAttendanceTable();
    updateAttendanceStats();
    updateAttendanceButtons();
    triggerNotificationToast('✓ Checked out at ' + updates.check_out_time);
  }, () => {
    btn.disabled = false;
    btn.innerText = '🚪 Check Out';
    triggerNotificationToast('Location access denied.');
  }, { enableHighAccuracy: true, timeout: 12000 });
}

function initAttendancePage() {
  startLiveClock();
  populateAttendanceTaskRefs();
  renderAttendanceTable();
  updateAttendanceStats();
  updateAttendanceButtons();
}

async function clearAttendanceLog() {
  if (!isPrivileged()) { triggerNotificationToast('Admin access required.'); return; }
  if (!confirm('Clear ALL attendance records?')) return;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('attendance').delete().neq('id', -1);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  }
  attendanceLogs = [];
  await logAudit('clear_attendance', 'attendance', '', 'All records', 'Wiped');
  flushCachedCollections();
  renderAttendanceTable();
  updateAttendanceStats();
  updateAttendanceButtons();
  triggerNotificationToast('Attendance log cleared.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 18: ARCHIVE
   ═══════════════════════════════════════════════════════════════════════ */

function generateArchiveGrid() {
  const container = document.getElementById('archiveGrid');
  const countBadge = document.getElementById('archiveCountBadge');
  if (!container) return;
  container.innerHTML = '';

  const archived = projects.filter(p => p.archived);
  if (countBadge) countBadge.innerText = archived.length + ' archived';

  const canManage = isPrivileged();

  if (archived.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No archived projects.</div>';
    return;
  }

  archived.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card archived-card';
    card.innerHTML =
      '<div class="card-category">' + esc(p.category || '') + '</div>' +
      '<div class="card-title">' + esc(p.title) + '</div>' +
      '<div class="card-meta"><span>📅 ' + esc(p.deadline || '—') + '</span><span>' + esc(p.status || '') + '</span></div>' +
      (canManage ? '<div class="card-action-row">' +
        '<button class="card-action-btn restore-btn" data-archive-restore="' + esc(p.id) + '" type="button">↩ Restore</button>' +
        '<button class="card-action-btn delete-btn" data-archive-delete="' + esc(p.id) + '" type="button">🗑 Delete</button>' +
      '</div>' : '');
    container.appendChild(card);
  });

  container.querySelectorAll('[data-archive-restore]').forEach(btn =>
    btn.addEventListener('click', () => restoreArchivedProject(parseInt(btn.dataset.archiveRestore, 10))));
  container.querySelectorAll('[data-archive-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteArchivedProject(parseInt(btn.dataset.archiveDelete, 10))));
}

async function restoreArchivedProject(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (!confirm('Restore "' + p.title + '"?')) return;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('projects').update({ archived: false }).eq('id', projectId);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Restore failed: ' + err.message); return; }
  }
  p.archived = false;
  await logAudit('restore_project', 'project', p.id, p.title, 'Restored from archive');
  flushCachedCollections();
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Project restored.');
}

async function deleteArchivedProject(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (!confirm('Permanently delete "' + p.title + '"?')) return;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('projects').delete().eq('id', projectId);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Delete failed: ' + err.message); return; }
  }
  projects = projects.filter(x => x.id !== projectId);
  await logAudit('delete_project', 'project', projectId, p.title, 'Deleted from archive');
  flushCachedCollections();
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Archived project deleted.');
}

async function clearAllArchivedProjects() {
  if (!isPrivileged()) return;
  const archived = projects.filter(p => p.archived);
  if (archived.length === 0) { triggerNotificationToast('No archived projects.'); return; }
  if (!confirm('Delete ALL ' + archived.length + ' archived project(s)?')) return;
  if (!confirm('Absolutely sure?')) return;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('projects').delete().eq('archived', true);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
  }
  projects = projects.filter(p => !p.archived);
  await logAudit('clear_archive', 'project', '', 'All archived', archived.length + ' deleted');
  flushCachedCollections();
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Archive cleared.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 19: ARCHIVED REPORTS
   ═══════════════════════════════════════════════════════════════════════ */

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
    card.innerHTML = '<div class="card-title">' + esc(r.title || 'Report') + '</div>' +
      '<div style="font-size:0.85rem;color:var(--text-muted);white-space:pre-line;line-height:1.5;">' + esc(r.summary || '') + '</div>';
    container.appendChild(card);
  });
}

async function clearArchivedReports() {
  if (!isPrivileged()) return;
  if (archivedReports.length === 0) { triggerNotificationToast('No reports to clear.'); return; }
  if (!confirm('Clear all ' + archivedReports.length + ' reports?')) return;
  archivedReports = [];
  await logAudit('clear_reports', 'reports', '', 'All reports', 'Cleared');
  generateArchiveReportsGrid();
  triggerNotificationToast('✓ Reports cleared.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 20: ACTIVITY SUMMARY
   ═══════════════════════════════════════════════════════════════════════ */

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
    card.innerHTML = '<div class="card-title">' + esc(r.title || 'Summary') + '</div>' +
      '<div style="font-size:0.82rem;color:var(--text-muted);white-space:pre-line;line-height:1.6;">' + esc(r.summary || '') + '</div>';
    container.appendChild(card);
  });
}

async function clearActivitySummaries() {
  if (!isPrivileged()) return;
  if (activitySummaries.length === 0) { triggerNotificationToast('No summaries.'); return; }
  if (!confirm('Clear all summaries?')) return;
  activitySummaries = [];
  await logAudit('clear_summaries', 'summaries', '', 'All activity summaries', 'Cleared');
  generateActivitySummaryGrid();
  triggerNotificationToast('✓ Summaries cleared.');
}

function generateActivitySummaryReport() {
  if (!isPrivileged()) return;
  const now = new Date();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = Utils.todayLocalISO();
  const activeProjects = projects.filter(p => !p.archived);
  const archivedProjects = projects.filter(p => p.archived);
  const overdue = activeProjects.filter(p => {
    if (!p.deadline || p.status === 'FILED') return false;
    return new Date(p.deadline) < today;
  });
  const staffCount = registeredUsersDB.filter(u => u.role === 'STAFF').length;
  const adminCount = registeredUsersDB.filter(u => u.role === 'ADMIN').length;
  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr);
  const activeDeployments = deployments.filter(d => !d.archived).length;
  const pendingAssignments = assignments.filter(a => !a.archived && a.status === 'PENDING').length;
  const submittedAssignments = assignments.filter(a => !a.archived && a.status === 'SUBMITTED').length;

  const summaryText =
    '🗓 ' + now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '\n\n' +
    '📊 PROJECTS\n     Active: ' + activeProjects.length + '    Archived: ' + archivedProjects.length + '\n     Overdue: ' + overdue.length + '\n\n' +
    '📡 FIELD OPS\n     Active: ' + activeDeployments + '\n\n' +
    '📋 TASKS\n     Pending: ' + pendingAssignments + '    Awaiting Review: ' + submittedAssignments + '\n\n' +
    '👥 TEAM\n     Staff: ' + staffCount + '    Admins: ' + adminCount + '\n\n' +
    '📍 FIELD ACTIVITY\n     Check-ins today: ' + todayCheckins.length + '\n';

  activitySummaries.unshift({
    id: Date.now(),
    title: 'Activity Summary — ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    summary: summaryText,
    generatedBy: currentUser.name,
    timestamp: now.toISOString()
  });
  generateActivitySummaryGrid();
  triggerNotificationToast('✓ Summary generated.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 21: WORK ASSIGNED
   ═══════════════════════════════════════════════════════════════════════ */

function generateSourcesGrid() {
  const container = document.getElementById('sourcesGrid');
  if (!container) return;
  container.innerHTML = '';

  const teamMembers = registeredUsersDB.filter(u => u.role === 'STAFF' || u.role === 'ADMIN' || u.role === 'EDITOR');
  const q = sourceSearchQuery.toLowerCase();
  const filtered = teamMembers.filter(u => !q || u.name.toLowerCase().includes(q));

  if (filtered.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No team members found.</div>';
    return;
  }

  filtered.forEach(member => {
    const memberProjects = projects.filter(p => !p.archived && (p.reporter || '').split(',').map(s => s.trim()).includes(member.name));
    const memberTasks = assignments.filter(a => !a.archived && (a.assignee || '').trim() === member.name.trim());
    const memberDeployments = deployments.filter(d => !d.archived && (d.reporter || '').split(',').map(s => s.trim()).includes(member.name));

    const card = document.createElement('div');
    card.className = 'card';

    const projectsHtml = memberProjects.length > 0
      ? memberProjects.map(p => '<div style="padding:0.4rem 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.82rem;">📋 <b>' + esc(p.title) + '</b> <span style="color:var(--text-muted);">(' + esc(p.status || 'ACTIVE') + ')</span></div>').join('')
      : '<div style="font-size:0.78rem; color:var(--text-muted);">— No projects</div>';

    const tasksHtml = memberTasks.length > 0
      ? memberTasks.map(t => '<div style="padding:0.4rem 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.82rem;">🔔 <b>' + esc(t.title) + '</b> <span style="color:var(--text-muted);">(' + esc(t.status || 'PENDING') + ')</span></div>').join('')
      : '<div style="font-size:0.78rem; color:var(--text-muted);">— No tasks</div>';

    const deploymentsHtml = memberDeployments.length > 0
      ? memberDeployments.map(d => '<div style="padding:0.4rem 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.82rem;">📡 <b>' + esc(d.title) + '</b> <span style="color:var(--text-muted);">(' + esc(d.location || 'Location TBD') + ')</span></div>').join('')
      : '<div style="font-size:0.78rem; color:var(--text-muted);">— No field ops</div>';

    const totalLoad = memberProjects.length + memberTasks.length + memberDeployments.length;

    card.innerHTML =
      '<div style="display:flex; align-items:center; gap:0.75rem;">' +
        '<div class="staff-avatar-mini" style="width:38px; height:38px; font-size:0.9rem;">' + esc(member.code || '??') + '</div>' +
        '<div style="flex:1;">' +
          '<div class="card-title" style="font-size:1.1rem; margin:0;">' + esc(member.name) + '</div>' +
          '<div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; font-weight:700;">' + esc(member.role) + ' • ' + totalLoad + ' active item(s)</div>' +
        '</div>' +
      '</div>' +
      '<div style="border-top:1px solid var(--border-color); padding-top:0.5rem; margin-top:0.5rem;">' +
        '<div style="font-size:0.72rem; font-weight:800; color:var(--accent-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:0.3rem;">📋 Projects (' + memberProjects.length + ')</div>' +
        projectsHtml +
      '</div>' +
      '<div style="border-top:1px solid var(--border-color); padding-top:0.5rem;">' +
        '<div style="font-size:0.72rem; font-weight:800; color:#8b5cf6; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:0.3rem;">🔔 Tasks (' + memberTasks.length + ')</div>' +
        tasksHtml +
      '</div>' +
      '<div style="border-top:1px solid var(--border-color); padding-top:0.5rem;">' +
        '<div style="font-size:0.72rem; font-weight:800; color:#fbd38d; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:0.3rem;">📡 Field Ops (' + memberDeployments.length + ')</div>' +
        deploymentsHtml +
      '</div>';

    container.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 22: USER MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════ */

function generateUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (registeredUsersDB.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--text-muted);">No users loaded.</td></tr>';
    return;
  }
  registeredUsersDB.forEach(user => {
    const isSelf = currentUser && currentUser.name === user.name;
    const canDelete = isAdmin() && !isSelf;
    let actionCell = '<span style="color:var(--text-muted);font-size:0.72rem;">—</span>';
    if (isSelf) {
      actionCell = '<span style="color:var(--text-muted);font-size:0.72rem;">(You)</span>';
    } else if (canDelete) {
      actionCell = '<button class="user-row-delete-btn" data-uid="' + esc(user.id) + '" data-uname="' + esc(user.name) + '" type="button">🗑 Delete</button>';
    }
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    tr.innerHTML =
      '<td style="padding:0.9rem 1.25rem;font-weight:800;">' + esc(user.code || '—') + '</td>' +
      '<td style="padding:0.9rem 1.25rem;font-weight:600;">' + esc(user.name) + '</td>' +
      '<td style="padding:0.9rem 1.25rem;">' + esc(user.role) + '</td>' +
      '<td style="padding:0.9rem 1.25rem;color:var(--text-muted);">' + esc(user.created || '—') + '</td>' +
      '<td style="padding:0.9rem 1.25rem;text-align:right;">' + actionCell + '</td>';
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-uid]').forEach(btn =>
    btn.addEventListener('click', () => deleteUserFromAdmin(parseInt(btn.dataset.uid, 10), btn.dataset.uname)));
}

async function createNewUser() {
  if (!isAdmin()) { triggerNotificationToast('Only Administrators can create accounts.'); return; }
  const name = document.getElementById('newUserName').value.trim();
  const pass = document.getElementById('newUserPass').value.trim();
  const role = document.getElementById('newUserRole').value;
  if (name.length < 2 || pass.length < 4) { triggerNotificationToast('Name too short or password < 4 chars.'); return; }
  const parts = name.split(' ');
  const code = parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.substring(0, 2).toUpperCase();
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient.rpc('create_user', {
      p_token: Session.getToken(),
      p_name: name, p_pass: pass, p_role: role, p_code: code
    });
    if (error) {
      triggerNotificationToast(error.message.toLowerCase().includes('duplicate') ? 'Username already exists.' : 'Error: ' + error.message);
      return;
    }
  } catch (err) { triggerNotificationToast('Failed to reach backend.'); return; }
  await refreshUsersFromBackend();
  await logAudit('create_user', 'user', '', name, 'Role: ' + role);
  generateUsersTable();
  generateStaffDirectory();
  evaluateClearancePermissions();
  document.getElementById('addUserModal').classList.remove('active');
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPass').value = '';
  triggerNotificationToast('Account "' + name + '" created.');
}

async function deleteUserFromAdmin(userId, userName) {
  if (!isAdmin()) { triggerNotificationToast('Only Administrators can delete accounts.'); return; }
  if (currentUser && currentUser.name === userName) { triggerNotificationToast('Cannot delete yourself.'); return; }
  if (!confirm('Permanently delete "' + userName + '"?')) return;
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient.rpc('delete_user', { p_token: Session.getToken(), p_id: userId });
    if (error) throw error;
  } catch (err) { triggerNotificationToast('Delete failed: ' + err.message); return; }
  registeredUsersDB = registeredUsersDB.filter(u => u.id !== userId);
  await logAudit('delete_user', 'user', userId, userName, 'Account removed');
  generateUsersTable();
  generateStaffDirectory();
  evaluateClearancePermissions();
  triggerNotificationToast('User "' + userName + '" deleted.');
}

async function refreshUsersFromBackend() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.rpc('list_users', { p_token: Session.getToken() });
    if (error) throw error;
    registeredUsersDB = (data || []).map(u => ({
      id: u.id, name: u.name, role: u.role, code: u.code,
      created: u.created_at ? Utils.fmtDate(u.created_at, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
    }));
  } catch (err) { console.error('Refresh users failed:', err); }
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 23: ACTIVITY LOG VIEW
   ═══════════════════════════════════════════════════════════════════════ */

function renderAuditLogTable() {
  const tbody = document.getElementById('auditLogTableBody');
  const badge = document.getElementById('auditCountBadge');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (badge) badge.innerText = auditLog.length + ' entries';
  const q = auditSearchQuery.toLowerCase();
  const subset = auditLog.filter(e =>
    (e.actor || '').toLowerCase().includes(q) ||
    (e.action || '').toLowerCase().includes(q) ||
    (e.target_name || '').toLowerCase().includes(q) ||
    (e.details || '').toLowerCase().includes(q)
  );
  if (subset.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:3rem;text-align:center;color:var(--text-muted);">No activity entries.</td></tr>';
    return;
  }
  subset.slice(0, 200).forEach(e => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    const actionColors = {
      delete: '#fc8181', archive: '#fbd38d', create: '#9ae6b4',
      submit: '#90cdf4', approve: '#81e6d9', update: '#cbd5e1',
      notify: '#a78bfa', ping: '#a78bfa', clear: '#f43f5e', deny: '#f43f5e',
      reject: '#f43f5e', request: '#fbd38d', restore: '#9ae6b4'
    };
    const key = Object.keys(actionColors).find(k => (e.action || '').toLowerCase().includes(k));
    const color = actionColors[key] || '#cbd5e1';
    tr.innerHTML =
      '<td style="padding:0.75rem 1.25rem;font-size:0.78rem;color:var(--text-muted);white-space:nowrap;">' +
        esc(e.created_at ? new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—') +
      '</td>' +
      '<td style="padding:0.75rem 1rem;font-weight:600;">' + esc(e.actor || '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;font-weight:700;color:' + color + ';font-size:0.75rem;text-transform:uppercase;letter-spacing:0.5px;">' + esc((e.action || '').replace(/_/g, ' ')) + '</td>' +
      '<td style="padding:0.75rem 1rem;font-size:0.82rem;">' + (e.target_type ? '<span style="color:var(--text-muted);">' + esc(e.target_type) + ':</span> ' : '') + esc(e.target_name || '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;font-size:0.78rem;color:var(--text-muted);">' + esc(e.details || '—') + '</td>';
    tbody.appendChild(tr);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 24: CSV EXPORT
   ═══════════════════════════════════════════════════════════════════════ */

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
  if (visible.length === 0) { triggerNotificationToast('No projects to export.'); return; }
  const rows = [['ID','Title','Category','Deadline','Status','Priority','Progress','Reporter','Tags','Notes']];
  visible.forEach(p => rows.push([p.id, p.title, p.category, p.deadline, p.status, p.priority, (p.progress || 0) + '%', p.reporter || '', p.tags || '', p.notes || '']));
  downloadCSV('jcompass-projects-' + Utils.todayLocalISO() + '.csv', rows);
  triggerNotificationToast('Exported ' + visible.length + ' projects.');
}

function exportAttendanceCSV() {
  if (attendanceLogs.length === 0) { triggerNotificationToast('No attendance data.'); return; }
  const rows = [['Reporter','Role','Date','CheckIn','CheckOut','Latitude','Longitude','Accuracy','Location','LinkedTo','Note']];
  attendanceLogs.forEach(l => rows.push([
    l.reporter, l.role, l.date, l.time, l.check_out_time || '',
    l.lat, l.lon, l.accuracy, l.location, l.task_ref || '', l.note || ''
  ]));
  downloadCSV('jcompass-attendance-' + Utils.todayLocalISO() + '.csv', rows);
  triggerNotificationToast('Exported ' + attendanceLogs.length + ' records.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 25: NOTIFICATION BAR
   ═══════════════════════════════════════════════════════════════════════ */

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
  const dayKey = Utils.todayLocalISO();

  dismissedNoticeIds = dismissedNoticeIds.filter(id => id.startsWith(dayKey));
  cacheSave(CACHE_KEYS.dismissedNotices, dismissedNoticeIds);

  const active = projects.filter(p => !p.archived);
  const overdue = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    return new Date(p.deadline) < today;
  });

  const notices = [];
  if (overdue.length > 0) notices.push({ id: dayKey + ':overdue-' + overdue.length, type: 'danger', icon: '⚠', text: overdue.length + ' project(s) overdue.' });

  if (isPrivileged()) {
    const pendingReqs = archiveRequests.filter(r => r.status === 'PENDING').length;
    if (pendingReqs > 0) notices.push({ id: dayKey + ':archive-reqs-' + pendingReqs, type: 'warning', icon: '📥', text: pendingReqs + ' archive request(s) awaiting review.' });
    const pendingSubmissions = assignments.filter(a => a.status === 'SUBMITTED' && !a.archived).length;
    if (pendingSubmissions > 0) notices.push({ id: dayKey + ':submissions-' + pendingSubmissions, type: 'info', icon: '📤', text: pendingSubmissions + ' task submission(s) awaiting review.' });
  }

  const myAssignments = assignments.filter(a =>
    !a.archived && a.status === 'PENDING' &&
    currentUser.name.toLowerCase() === (a.assignee || '').toLowerCase()
  ).length;
  if (myAssignments > 0) notices.push({ id: dayKey + ':my-assignments-' + myAssignments, type: 'info', icon: '🔔', text: myAssignments + ' task(s) assigned to you.' });

  const visible = notices.filter(n => !dismissedNoticeIds.includes(n.id));
  container.innerHTML = visible.map(n =>
    '<div class="notice-bar notice-' + n.type + '">' +
      '<span class="notice-icon">' + n.icon + '</span>' +
      '<span class="notice-text">' + esc(n.text) + '</span>' +
      '<button class="notice-dismiss-btn" type="button">✕</button>' +
    '</div>'
  ).join('');
  container.querySelectorAll('.notice-dismiss-btn').forEach((btn, i) => {
    btn.addEventListener('click', () => dismissNotice(visible[i].id));
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 26: INJECT ADMIN BUTTONS
   ═══════════════════════════════════════════════════════════════════════ */

function injectAdminClearButtons() {
  if (!isPrivileged()) return;

  const tryInject = (badgeId, count, btnId, label, handler) => {
    const badge = document.getElementById(badgeId);
    const existing = document.getElementById(btnId);
    if (count > 0 && badge && !existing) {
      const btn = document.createElement('button');
      btn.id = btnId;
      btn.className = 'btn btn-ghost';
      btn.type = 'button';
      btn.style.cssText = 'font-size:0.75rem;color:var(--danger);border-color:rgba(229,62,62,0.3);white-space:nowrap;margin-right:0.5rem;';
      btn.textContent = label;
      btn.addEventListener('click', handler);
      badge.parentNode.insertBefore(btn, badge);
    } else if (count === 0 && existing) {
      existing.remove();
    }
  };

  tryInject('archiveCountBadge', projects.filter(p => p.archived).length,
    'clearArchivedProjectsBtn', '🗑 Clear Archive', clearAllArchivedProjects);

  tryInject('archiveReportsCountBadge', archivedReports.length,
    'clearArchiveReportsBtn', '🗑 Clear Reports', clearArchivedReports);

  tryInject('activitySummaryCountBadge', activitySummaries.length,
    'clearActivitySummariesBtn', '🗑 Clear Summaries', clearActivitySummaries);
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 27: CONTROL TRAY
   ═══════════════════════════════════════════════════════════════════════ */

function wireControlTray() {
  const openTray = () => {
    document.getElementById('controlTray')?.classList.add('active');
    document.getElementById('controlTrayOverlay')?.classList.add('active');
  };
  const closeTray = () => {
    document.getElementById('controlTray')?.classList.remove('active');
    document.getElementById('controlTrayOverlay')?.classList.remove('active');
  };
  document.getElementById('settingsGearBtn')?.addEventListener('click', openTray);
  document.getElementById('settingsSidebarBtn')?.addEventListener('click', openTray);
  document.getElementById('userAvatarBtn')?.addEventListener('click', openTray);
  document.getElementById('controlTrayCloseBtn')?.addEventListener('click', closeTray);
  document.getElementById('controlTrayOverlay')?.addEventListener('click', closeTray);
}

function initTheme() {
  const savedTheme = localStorage.getItem('jcompass_theme') || 'forest';
  document.body.setAttribute('data-theme-profile', savedTheme);
  document.querySelectorAll('.theme-chip-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.theme === savedTheme));

  document.querySelectorAll('.theme-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-chip-btn').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const theme = btn.getAttribute('data-theme');
      document.body.setAttribute('data-theme-profile', theme);
      localStorage.setItem('jcompass_theme', theme);
    });
  });

  const savedMode = localStorage.getItem('jcompass_mode') || 'dark';
  document.body.setAttribute('data-mode', savedMode);
  document.querySelectorAll('.mode-chip-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === savedMode));

  document.querySelectorAll('.mode-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-chip-btn').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.body.setAttribute('data-mode', btn.dataset.mode);
      localStorage.setItem('jcompass_mode', btn.dataset.mode);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 28: ONESIGNAL + PUSH
   ═══════════════════════════════════════════════════════════════════════ */

async function sendPushNotification(title, message, targetUserName = null) {
  try {
    const res = await fetch(CONFIG.PUSH_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message, targetUserName })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) console.warn('Push failed:', json);
    return json;
  } catch (err) { console.error('Push failed:', err); }
}

async function setOneSignalUser(userName) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async (OneSignal) => {
    try { await OneSignal.login(userName); } catch {}
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 29: INITIALIZATION
   ═══════════════════════════════════════════════════════════════════════ */

function initSupabaseClient() {
  if (typeof window.supabase === 'undefined') {
    console.error('JCompass: Supabase library not loaded.');
    return;
  }
  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  console.log('JCompass: Supabase client initialized.');
}

function initializeApp() {
  wipeLegacyCache();
  initSupabaseClient();
  initTheme();
  wireControlTray();

  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
      const OneSignal = window.Capacitor.Plugins?.OneSignal || window.plugins?.OneSignal;
      if (OneSignal) {
        OneSignal.initialize(CONFIG.ONESIGNAL_APP_ID);
        OneSignal.Notifications.requestPermission(true).then(accepted =>
          console.log('OneSignal permission:', accepted));
      }
    } catch (e) { console.warn('OneSignal init skipped:', e); }
  }

  enforceSessionGuard();

  document.querySelectorAll('.nav-item').forEach(nav => {
    nav.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      nav.classList.add('active');
      const target = nav.getAttribute('data-page');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + target)?.classList.add('active');
      const bc = document.getElementById('breadcrumbCurrent');
      if (bc && nav.querySelector('.nav-label')) bc.innerText = nav.querySelector('.nav-label').innerText;
      if (target === 'attend') initAttendancePage();
      if (target === 'calendar') generateDeadlineCalendarGrid();
      if (target === 'archive') renderArchiveRequestsPanel();
      if (target === 'audit') renderAuditLogTable();
    });
  });

  const sidebarEl = document.getElementById('sidebar');
  document.getElementById('menuToggle')?.addEventListener('click', () => sidebarEl?.classList.toggle('active'));
  document.getElementById('sidebarCloseBtn')?.addEventListener('click', () => sidebarEl?.classList.remove('active'));
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

  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    Session.logout();
    Utils.store.del('jcompass_user');
    window.location.replace(CONFIG.LOGIN_PAGE);
  });

  document.getElementById('submitAnnouncementBtn')?.addEventListener('click', () => {
    const input = document.getElementById('announceTextInput');
    const target = document.getElementById('announcePingTarget');
    if (!input || !input.value.trim() || !currentUser) return;
    dispatchPing(currentUser.name, target.value, input.value.trim());
    input.value = '';
  });

  document.getElementById('checkInBtn')?.addEventListener('click', processCheckIn);
  document.getElementById('checkOutBtn')?.addEventListener('click', processCheckOut);
  document.getElementById('clearAttendanceBtn')?.addEventListener('click', clearAttendanceLog);
  document.getElementById('exportAttendanceBtn')?.addEventListener('click', exportAttendanceCSV);
  document.getElementById('quickExportCSVBtn')?.addEventListener('click', exportProjectsCSV);

  document.getElementById('createProjectBtn')?.addEventListener('click', async () => {
    const title = document.getElementById('newTitle').value.trim();
    const category = document.getElementById('newCategory').value;
    const deadline = document.getElementById('newDeadline').value || Utils.todayLocalISO();
    if (!title) return;
    const payload = {
      title, category, deadline, status: 'ACTIVE', priority: 'MEDIUM',
      progress: 0, reporter: currentUser.name, notes: '', tags: '', archived: false,
      created_by: currentUser.name
    };
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('projects').insert(payload).select().single();
        if (error) throw error;
        if (data) payload.id = data.id;
      } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
    } else { payload.id = Date.now(); }
    projects.push({ ...payload, created_at: new Date().toISOString() });
    await logAudit('create_project', 'project', payload.id, title, 'Category: ' + category + ', Due: ' + deadline);
    flushCachedCollections();
    rebuildApplicationDOMViews();
    document.getElementById('newProjectModal').classList.remove('active');
    document.getElementById('newTitle').value = '';
    triggerNotificationToast('Project created.');
  });

  document.getElementById('saveUserBtn')?.addEventListener('click', createNewUser);

  refreshNotificationPermissionUI();
  document.getElementById('enableNotificationsBtn')?.addEventListener('click', requestNotificationPermission);

  document.getElementById('calPrevMonth')?.addEventListener('click', () => {
    calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    generateDeadlineCalendarGrid();
  });
  document.getElementById('calNextMonth')?.addEventListener('click', () => {
    calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    generateDeadlineCalendarGrid();
  });

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter || 'ALL';
      generateProjectDashboard();
    });
  });

  document.getElementById('dashboardSearchInput')?.addEventListener('input', (e) => {
    searchQuery = e.target.value; generateProjectDashboard();
  });
  document.getElementById('sourceSearchInput')?.addEventListener('input', (e) => {
    sourceSearchQuery = e.target.value; generateSourcesGrid();
  });
  document.getElementById('attendanceSearchInput')?.addEventListener('input', (e) => {
    attendanceSearchQuery = e.target.value; renderAttendanceTable();
  });
  document.getElementById('auditSearchInput')?.addEventListener('input', (e) => {
    auditSearchQuery = e.target.value; renderAuditLogTable();
  });

  document.getElementById('profileSaveBtn')?.addEventListener('click', saveProjectProfile);
    /* Progress slider — live sync with the fill bar + % label */
  document.getElementById('profileProgressInput')?.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10) || 0;
    const bar = document.getElementById('profileProgressBar');
    const label = document.getElementById('profileProgressLabel');
    if (bar) bar.style.width = v + '%';
    if (label) label.innerText = v + '%';
  });

  const projectModal = document.getElementById('projectProfileModal');
  if (projectModal) {
    projectModal.addEventListener('click', async (e) => {
      const priorityBtn = e.target.closest('.priority-select-btn');
      if (priorityBtn && !priorityBtn.disabled) {
        e.preventDefault(); e.stopPropagation();
        document.querySelectorAll('.priority-select-btn').forEach(b => b.classList.remove('active'));
        priorityBtn.classList.add('active');
        return;
      }
      const archiveBtn = e.target.closest('#profileArchiveBtn');
      const deleteBtn  = e.target.closest('#profileDeleteBtn');
      const requestBtn = e.target.closest('#profileRequestArchiveBtn');
      if (archiveBtn) { e.preventDefault(); e.stopPropagation(); if (activeProfileId != null) await archiveProject(activeProfileId); }
      if (deleteBtn)  { e.preventDefault(); e.stopPropagation(); if (activeProfileId != null) await deleteProject(activeProfileId); }
      if (requestBtn) { e.preventDefault(); e.stopPropagation(); if (activeProfileId != null) await submitArchiveRequest(activeProfileId); }
    });
  }

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = document.getElementById(btn.getAttribute('data-close'));
      if (m) m.classList.remove('active');
    });
  });

  document.getElementById('addBeatBtn')?.addEventListener('click', openDeploymentModal);
  document.getElementById('addAssignmentBtn')?.addEventListener('click', openAssignmentModal);

  const modalOpeners = [
    ['fabBtn', 'newProjectModal'],
    ['addCalendarProjectBtn', 'newProjectModal'],
    ['addEventBtn', 'addEventModal'],
    ['addUserBtn', 'addUserModal'],
    ['quickAddProjectBtn', 'newProjectModal']
  ];
  modalOpeners.forEach(([btnId, modalId]) => {
    document.getElementById(btnId)?.addEventListener('click', () => {
      document.getElementById(modalId)?.classList.add('active');
    });
  });

  document.getElementById('saveBeatBtn')?.addEventListener('click', async () => {
    const title = document.getElementById('beatName').value.trim();
    const priority = document.getElementById('beatPriority').value;
    const location = document.getElementById('beatLocation').value.trim();
    const description = document.getElementById('beatDescription').value.trim();
    const selected = Array.from(document.querySelectorAll('#reporterCheckboxList input[type="checkbox"]:checked')).map(cb => cb.value);
    if (!title) { triggerNotificationToast('Operation title is required.'); return; }
    if (selected.length === 0) { triggerNotificationToast('Select at least one member.'); return; }

    const reporterString = selected.join(', ');
    const payload = {
      title, description, location, reporter: reporterString, priority,
      status: 'ACTIVE', image_data: '', created_by: currentUser.name, archived: false
    };
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('deployments').insert(payload).select().single();
        if (error) throw error;
        payload.id = data ? data.id : Date.now();
      } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
    } else { payload.id = Date.now(); }
    deployments.push({
      id: payload.id, title, description, location, reporter: reporterString,
      priority, status: 'ACTIVE', imageData: '', createdBy: currentUser.name,
      archived: false, created_at: new Date().toISOString()
    });
    await logAudit('create_deployment', 'deployment', payload.id, title, 'Deployed ' + selected.length + ' member(s): ' + reporterString);
    for (const reporter of selected) {
      await dispatchPing(currentUser.name, reporter, '📡 You have been deployed: "' + title + '" at ' + (location || 'Location TBD'));
    }
    flushCachedCollections();
    generateDeploymentsGrid();
    populateAttendanceTaskRefs();
    document.getElementById('addBeatModal').classList.remove('active');
    document.getElementById('beatName').value = '';
    document.getElementById('beatLocation').value = '';
    document.getElementById('beatDescription').value = '';
    triggerNotificationToast('✓ Deployed. Notified ' + selected.length + ' member(s).');
  });

  document.getElementById('saveAssignmentBtn')?.addEventListener('click', async () => {
    const title = document.getElementById('asgTitle').value.trim();
    const selectedRadio = document.querySelector('#assigneeRadioList input[name="assignee"]:checked');
    const assignee = selectedRadio ? selectedRadio.value : null;
    if (!title) { triggerNotificationToast('Task description is required.'); return; }
    if (!assignee) { triggerNotificationToast('Please select an assignee.'); return; }

    const payload = {
      title, assignee, description: '', priority: 'MEDIUM', due_date: null,
      created_by: currentUser.name, status: 'PENDING', archived: false
    };
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('assignments').insert(payload).select().single();
        if (error) throw error;
        payload.id = data ? data.id : Date.now();
      } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
    } else { payload.id = Date.now(); }

    assignments.unshift({
      id: payload.id, ...payload,
      submission_text: '', submission_file: '', submitted_by: '', submitted_at: null,
      reviewed_by: '', reviewed_at: null, review_notes: '',
      created_at: new Date().toISOString()
    });
    await logAudit('create_assignment', 'assignment', payload.id, title, 'Assigned to ' + assignee);
    await dispatchPing(currentUser.name, assignee, '🔔 New task assigned to you: "' + title + '"');
    flushCachedCollections();
    generateAssignmentsGrid();
    document.getElementById('addAssignmentModal').classList.remove('active');
    document.getElementById('asgTitle').value = '';
    triggerNotificationToast('✓ Task created for ' + assignee + '.');
  });

  document.getElementById('saveEventBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('evtName').value.trim();
    const date = document.getElementById('evtDate').value || Utils.todayLocalISO();
    if (!name) return;
    const payload = { name, date, completed: false };
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('events').insert(payload).select().single();
        if (error) throw error;
        payload.id = data ? data.id : Date.now();
      } catch (err) { triggerNotificationToast('Backend error: ' + err.message); return; }
    } else { payload.id = Date.now(); }
    events.push(payload);
    await logAudit('create_event', 'event', payload.id, name, 'Date: ' + date);
    flushCachedCollections();
    generateEventsTrackerChecklist();
    generateDeadlineCalendarGrid();
    document.getElementById('addEventModal').classList.remove('active');
    document.getElementById('evtName').value = '';
    triggerNotificationToast('Event added.');
  });

  document.getElementById('generateActivitySummaryBtn')?.addEventListener('click', generateActivitySummaryReport);

  console.log('✅ JCompass initialized (v6.3)');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 30: BOOTSTRAP
   ═══════════════════════════════════════════════════════════════════════ */

(async function bootstrap() {
  try {
    const auth = await (window.JCOMPASS_AUTH_READY || Promise.resolve(null));
    if (!auth || !auth.user) return;
    currentUser = auth.user;
  } catch (e) {
    console.error('JCompass bootstrap:', e);
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }
})();

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !currentUser) return;
  try {
    await syncAllDataFromSupabase();
    rebuildApplicationDOMViews();
  } catch (e) { console.warn('Catch-up sync failed:', e); }
});

window.generateDashboardStats = generateDashboardStats;
window.generateProjectDashboard = generateProjectDashboard;
window.generateAnnouncementsStream = generateAnnouncementsStream;
window.rebuildApplicationDOMViews = rebuildApplicationDOMViews;