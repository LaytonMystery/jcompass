/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SENTINEL JOURNALIST'S COMPASS v7.3                                  ║
 * ║  · Overdue projects modal (extend / archive)                         ║
 * ║  · Multi-assignee tasks + search pickers                             ║
 * ║  · Editor in Chief role                                              ║
 * ║  · Event deletion (Admin/EIC)                                        ║
 * ║  · Activity summary export/delete                                    ║
 * ║  · Attendance 15-min check-in cooldown + session duration            ║
 * ║  · Geofence venue enforcement + spot-checks while checked in         ║
 * ║  · Create New Project modal uses 2-column assignee picker            ║
 * ║  · Project Profile "Assigned To" is a select (no free text)          ║
 * ║  · FCM push (native via Capacitor / web via Firebase)                ║
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
const isAssignable = (role) => role !== 'ADMIN';

const reporterSelection = new Set();
const assigneeSelection = new Set();
let newProjectAssignee = '';

function parseAssignees(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}
function isUserAssigned(assigneeField, userName) {
  if (!userName) return false;
  const list = parseAssignees(assigneeField).map(n => n.toLowerCase());
  return list.includes(userName.toLowerCase());
}
function renderAssigneeChips(assigneeField) {
  const list = parseAssignees(assigneeField);
  if (list.length === 0) return '<span style="color:var(--text-muted);">—</span>';
  return list.map(n => '<span class="assignee-chip">' + esc(n) + '</span>').join('');
}

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
      venue_name: d.venue_name || '', venue_lat: d.venue_lat ?? null,
      venue_lon: d.venue_lon ?? null, venue_radius: d.venue_radius ?? 150,
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
      task_ref: row.task_ref || '', task_ref_id: row.task_ref_id || '',
      check_type: row.check_type || 'CHECK_IN',
      session_ref: row.session_ref || null
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
      if (isUserAssigned(row.assignee, currentUser.name) && row.created_by !== currentUser.name && window.JC.showAssignPopup) {
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
        task_ref: row.task_ref || '', task_ref_id: row.task_ref_id || '',
        check_type: row.check_type || 'CHECK_IN',
        session_ref: row.session_ref || null
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

function triggerNotificationToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.classList.add('active');
  setTimeout(() => t.classList.remove('active'), 3000);
}

function notifyIncomingPing(ann) {
  if (!currentUser) return;
  const isPingedToMe = ann.target === currentUser.name;
  const isBroadcastAll = ann.target === 'ALL';
  if (!isPingedToMe && !isBroadcastAll) return;
  if (ann.sender === currentUser.name) return;

  const title = isBroadcastAll ? 'Sentinel JCompass — Announcement' : 'Sentinel JCompass — Direct Message';
  const body = ann.sender + ': ' + ann.text;

  if (('Notification' in window) && Notification.permission === 'granted' && document.hidden) {
    const n = new Notification(title, { body, icon: 'favicon.ico' });
    n.onclick = () => { window.focus(); n.close(); };
  } else {
    triggerNotificationToast(body);
  }
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
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  const staffCard = document.getElementById('statStaffCountParent');
  if (staffCard) staffCard.style.display = showAdminNav ? '' : 'none';

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
  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr && (l.check_type || 'CHECK_IN') === 'CHECK_IN').length;

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
  populateProfileReporterSelect(p.reporter || '');
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
   SECTION 10b: OVERDUE PROJECTS
   ═══════════════════════════════════════════════════════════════════════ */

function ensureOverdueModal() {
  if (document.getElementById('overdueProjectsModal')) return;
  const html = `
    <div class="modal-overlay" id="overdueProjectsModal">
      <div class="modal" style="max-width:720px; width:95vw;">
        <div class="modal-header">
          <div style="display:flex;flex-direction:column;gap:0.25rem;">
            <div class="card-category" style="color:#fc8181;">⚠️ OVERDUE PROJECTS</div>
            <h2 class="modal-title">Needs Attention</h2>
          </div>
          <button class="modal-close" data-close="overdueProjectsModal" type="button">✕</button>
        </div>
        <div class="modal-body" id="overdueProjectsBody" style="gap:0.85rem;"></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close="overdueProjectsModal" type="button">Close</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  document.querySelectorAll('[data-close="overdueProjectsModal"]').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById('overdueProjectsModal').classList.remove('active'));
  });
}

function getOverdueProjects() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return projects.filter(p => {
    if (p.archived) return false;
    if (!p.deadline) return false;
    if (p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    return new Date(p.deadline) < today;
  });
}

function openOverdueProjectsModal() {
  ensureOverdueModal();
  const body = document.getElementById('overdueProjectsBody');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdue = getOverdueProjects();

  if (overdue.length === 0) {
    body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem;">No overdue projects. 🎉</div>';
    document.getElementById('overdueProjectsModal').classList.add('active');
    return;
  }

  const tomorrow = new Date(today.getTime() + 86400000);
  const defaultDate = tomorrow.toISOString().split('T')[0];

  body.innerHTML = overdue.map(p => {
    const days = Math.ceil((today - new Date(p.deadline)) / 86400000);
    return `
      <div class="overdue-row">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.95rem;">${esc(p.title)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.2rem;">
            📅 Deadline: <b>${esc(p.deadline)}</b> · <span style="color:#fc8181;font-weight:700;">${days} day${days === 1 ? '' : 's'} overdue</span>
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.15rem;">
            ${esc(p.category || '—')} · Assigned: ${esc(p.reporter || '—')}
          </div>
        </div>
        <div class="overdue-actions">
          <input type="date" class="overdue-date-input" data-date-for="${esc(p.id)}" value="${esc(defaultDate)}">
          <button class="btn btn-primary overdue-extend-btn" data-extend-id="${esc(p.id)}" type="button" title="Extend deadline">📅 Extend</button>
          <button class="btn btn-ghost overdue-archive-btn" data-archive-id="${esc(p.id)}" type="button" style="color:var(--warning);border-color:rgba(221,107,32,0.4);" title="Archive project">🗄 Archive</button>
          <button class="btn btn-ghost overdue-open-btn" data-open-id="${esc(p.id)}" type="button" title="Open details">📋 Open</button>
        </div>
      </div>
    `;
  }).join('');

  body.querySelectorAll('[data-extend-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.extendId, 10);
      const dateInput = body.querySelector(`[data-date-for="${id}"]`);
      const newDate = dateInput?.value;
      if (!newDate) { triggerNotificationToast('Pick a new deadline date first.'); return; }
      await extendProjectDeadline(id, newDate);
      openOverdueProjectsModal();
    });
  });
  body.querySelectorAll('[data-archive-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.archiveId, 10);
      await archiveProjectFromOverdue(id);
      openOverdueProjectsModal();
    });
  });
  body.querySelectorAll('[data-open-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.openId, 10);
      document.getElementById('overdueProjectsModal').classList.remove('active');
      openProjectProfile(id);
    });
  });

  document.getElementById('overdueProjectsModal').classList.add('active');
}

async function extendProjectDeadline(projectId, newDate) {
  if (!isPrivileged()) { triggerNotificationToast('Admin access required.'); return; }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('projects').update({ deadline: newDate }).eq('id', projectId);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Update failed: ' + err.message); return; }
  }
  const oldDate = p.deadline;
  p.deadline = newDate;
  await logAudit('extend_project_deadline', 'project', p.id, p.title, `${oldDate} → ${newDate}`);
  flushCachedCollections();
  generateNotificationBar();
  generateProjectDashboard();
  generateDeadlineCalendarGrid();
  triggerNotificationToast(`✓ "${p.title}" extended to ${newDate}`);
}

async function archiveProjectFromOverdue(projectId) {
  if (!isPrivileged()) { triggerNotificationToast('Admin access required.'); return; }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (!confirm('Archive "' + p.title + '"?')) return;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('projects').update({ archived: true }).eq('id', projectId);
      if (error) throw error;
    } catch (err) { triggerNotificationToast('Archive failed: ' + err.message); return; }
  }
  p.archived = true;
  await logAudit('archive_project', 'project', p.id, p.title, 'Archived from overdue list');
  flushCachedCollections();
  generateNotificationBar();
  generateProjectDashboard();
  generateArchiveGrid();
  generateDashboardStats();
  triggerNotificationToast('✓ Project archived.');
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
  const searchInput = document.getElementById('reporterSearchInput');
  if (!container) return;

  const q = (searchInput?.value || '').trim().toLowerCase();
  const staffUsers = registeredUsersDB
    .filter(u => isAssignable(u.role))
    .filter(u => !q || u.name.toLowerCase().includes(q));

  if (staffUsers.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">' +
      (q ? 'No members match "' + esc(q) + '".' : 'No staff members available.') + '</div>';
    return;
  }

  container.innerHTML = staffUsers.map(u => {
    const checked = reporterSelection.has(u.name) ? ' checked' : '';
    return '<label style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem; border-radius:6px; cursor:pointer;">' +
      '<input type="checkbox" value="' + esc(u.name) + '" data-reporter-checkbox' + checked + ' style="width:18px; height:18px; accent-color:var(--accent-light); cursor:pointer;">' +
      '<div style="display:flex; align-items:center; gap:0.5rem; flex:1;">' +
        '<div class="staff-avatar-mini">' + esc(u.code || '??') + '</div>' +
        '<span style="font-weight:600; font-size:0.9rem;">' + esc(u.name) + '</span>' +
        '<span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">' + esc(u.role) + '</span>' +
      '</div>' +
    '</label>';
  }).join('');

  container.querySelectorAll('input[data-reporter-checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) reporterSelection.add(cb.value);
      else reporterSelection.delete(cb.value);
    });
  });
}

function openDeploymentModal() {
  reporterSelection.clear();
  const s = document.getElementById('reporterSearchInput');
  if (s) s.value = '';
  populateReporterCheckboxes();
  document.getElementById('addBeatModal').classList.add('active');
  setTimeout(() => s?.focus(), 100);
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
    (d.venue_name || (d.venue_lat && d.venue_lon)
      ? '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">📍 Venue Geofence</span>' +
        '<div style="margin-top:0.25rem; font-size:0.9rem;">' +
          esc(d.venue_name || 'Unnamed venue') +
          (d.venue_lat && d.venue_lon
            ? ' · <span style="color:var(--text-muted);">' + esc(d.venue_lat) + ', ' + esc(d.venue_lon) + ' · ' + esc(d.venue_radius || 150) + ' m radius</span>'
            : '') +
        '</div></div>'
      : '') +
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

    const assignees = parseAssignees(a.assignee);
    const isAssignee = isUserAssigned(a.assignee, currentUser.name);
    const canView = isAssignee || canManage;
    const isGroup = assignees.length > 1;

    const groupTag = isGroup
      ? '<span class="group-tag" title="Group task">👥 Group · ' + assignees.length + '</span> '
      : '';

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
      '<div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;flex-wrap:wrap;">' +
        '<div class="card-title" style="font-size:1.05rem;flex:1;min-width:0;">' + esc(a.title) + '</div>' +
        '<div style="display:flex;gap:0.35rem;align-items:center;flex-shrink:0;">' + groupTag + statusBadge + '</div>' +
      '</div>' +
      (a.description ? '<div style="font-size:0.82rem;color:var(--text-muted); white-space:pre-line; line-height:1.5;">' + esc(a.description) + '</div>' : '') +
      '<div class="card-assignee-row">' +
        '<span style="font-size:0.82rem;color:var(--text-muted);">👤 Assigned to:</span> ' +
        renderAssigneeChips(a.assignee) +
      '</div>' +
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

function populateAssigneeCheckboxes() {
  const container = document.getElementById('assigneeRadioList');
  const searchInput = document.getElementById('assigneeSearchInput');
  if (!container) return;

  const q = (searchInput?.value || '').trim().toLowerCase();
  const staffUsers = registeredUsersDB
    .filter(u => isAssignable(u.role))
    .filter(u => !q || u.name.toLowerCase().includes(q));

  if (staffUsers.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">' +
      (q ? 'No members match "' + esc(q) + '".' : 'No staff members available. Create staff accounts first.') + '</div>';
    return;
  }

  container.innerHTML = staffUsers.map(u => {
    const checked = assigneeSelection.has(u.name) ? ' checked' : '';
    return '<label style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem; border-radius:6px; cursor:pointer;">' +
      '<input type="checkbox" value="' + esc(u.name) + '" data-assignee-checkbox' + checked + ' style="width:18px; height:18px; accent-color:var(--accent-light); cursor:pointer;">' +
      '<div style="display:flex; align-items:center; gap:0.5rem; flex:1;">' +
        '<div class="staff-avatar-mini">' + esc(u.code || '??') + '</div>' +
        '<span style="font-weight:600; font-size:0.9rem;">' + esc(u.name) + '</span>' +
        '<span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">' + esc(u.role) + '</span>' +
      '</div>' +
    '</label>';
  }).join('');

  container.querySelectorAll('input[data-assignee-checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) assigneeSelection.add(cb.value);
      else assigneeSelection.delete(cb.value);
    });
  });
}

function openAssignmentModal() {
  assigneeSelection.clear();
  const s = document.getElementById('assigneeSearchInput');
  if (s) s.value = '';
  populateAssigneeCheckboxes();
  document.getElementById('addAssignmentModal').classList.add('active');
  setTimeout(() => s?.focus(), 100);
}

function openSubmissionModal(assignmentId) {
  const a = assignments.find(x => x.id === assignmentId);
  if (!a) return;
  activeSubmissionId = assignmentId;

  const isAssignee = isUserAssigned(a.assignee, currentUser.name);
  const canManage = isPrivileged();
  const canSubmit = isAssignee && a.status === 'PENDING';
  const canReview = canManage && a.status === 'SUBMITTED';
  const isReadOnlyForAdmin = canManage && !isAssignee;
  const assignees = parseAssignees(a.assignee);
  const isGroup = assignees.length > 1;

  document.getElementById('submissionModalCategory').innerText =
    'TASK · ' + (a.priority || 'MEDIUM') + (isGroup ? ' · GROUP (' + assignees.length + ')' : '');
  document.getElementById('submissionModalTitle').innerText = a.title;

  const body = document.getElementById('submissionModalBody');
  const footer = document.getElementById('submissionModalFooter');

  if (canSubmit) {
    body.innerHTML =
      (a.description ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Description</span><div style="margin-top:0.25rem;font-size:0.9rem;white-space:pre-line;line-height:1.5;">' + esc(a.description) + '</div></div>' : '') +
      (isGroup
        ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Team Members Assigned</span><div style="margin-top:0.4rem;display:flex;flex-wrap:wrap;gap:0.35rem;">' +
          assignees.map(n => '<span class="assignee-chip">' + esc(n) + '</span>').join('') + '</div>' +
          '<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.5rem;">Any one of you can submit. The task will close for everyone once submitted.</div></div>'
        : '') +
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
        '<span style="font-size:1.2rem;">🔒</span><span>Only the assigned member(s) can submit output for this task. You are viewing in read-only mode.</span></div>'
      : '';

    body.innerHTML =
      readOnlyBanner +
      '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Assigned To' + (isGroup ? ' (' + assignees.length + ')' : '') + '</span>' +
        '<div style="margin-top:0.4rem;display:flex;flex-wrap:wrap;gap:0.35rem;">' + renderAssigneeChips(a.assignee) + '</div></div>' +
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
  if (!isUserAssigned(a.assignee, currentUser.name)) {
    triggerNotificationToast('Only the assigned member(s) can submit this task.'); return;
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

  const notifyList = new Set(parseAssignees(a.assignee));
  if (a.created_by) notifyList.add(a.created_by);
  for (const person of notifyList) {
    if (person.toLowerCase() === currentUser.name.toLowerCase()) continue;
    await dispatchPing(currentUser.name, person, '📤 ' + currentUser.name + ' submitted: "' + a.title + '"');
  }

  await logAudit('submit_task', 'assignment', a.id, a.title, 'Submitted by ' + currentUser.name);
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

  for (const person of parseAssignees(a.assignee)) {
    if (person.toLowerCase() === currentUser.name.toLowerCase()) continue;
    await dispatchPing(currentUser.name, person, approved
      ? '✅ Task "' + a.title + '" was approved.'
      : '↩ Task "' + a.title + '" needs revision.');
  }

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
  const canManage = isPrivileged();
  events.forEach(evt => {
    const div = document.createElement('div');
    div.className = 'event-row' + (evt.completed ? ' done' : '');
    div.innerHTML =
      '<div><div style="font-weight:600;">' + esc(evt.name) + '</div>' +
      '<div style="font-size:0.75rem;color:var(--text-muted);">' + esc(evt.date || '') + '</div></div>' +
      (canManage
        ? '<button class="event-delete-btn" data-evt-del="' + esc(evt.id) + '" type="button" title="Delete event">✕</button>'
        : '');
    container.appendChild(div);
  });
  container.querySelectorAll('[data-evt-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteEvent(btn.dataset.evtDel));
  });
}

async function deleteEvent(eventId) {
  if (!isPrivileged()) {
    triggerNotificationToast('Only Admin / Editor in Chief can delete events.');
    return;
  }
  const idIsNum = !isNaN(parseInt(eventId, 10));
  const id = idIsNum ? parseInt(eventId, 10) : eventId;
  const evt = events.find(e => e.id === id || String(e.id) === String(eventId));
  if (!evt) return;
  if (!confirm('Delete event "' + evt.name + '"?')) return;

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('events').delete().eq('id', evt.id);
      if (error) throw error;
    } catch (err) {
      triggerNotificationToast('Delete failed: ' + err.message);
      return;
    }
  }
  events = events.filter(e => e.id !== evt.id);
  await logAudit('delete_event', 'event', evt.id, evt.name, 'Deleted');
  flushCachedCollections();
  generateEventsTrackerChecklist();
  generateDeadlineCalendarGrid();
  triggerNotificationToast('✓ Event deleted.');
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

  const todayIso = Utils.todayLocalISO();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell cal-cell-empty';
    empty.style.opacity = '0.3';
    container.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell';

    const dateStr = calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const dayProjects = projects.filter(p => p.deadline === dateStr && !p.archived);
    const dayTasks    = assignments.filter(a => a.due_date === dateStr && !a.archived);
    const dayEvents   = events.filter(e => e.date === dateStr && !e.archived);

    const hasP = dayProjects.length > 0;
    const hasT = dayTasks.length > 0;
    const hasE = dayEvents.length > 0;
    const hasAny = hasP || hasT || hasE;

    if (dateStr === todayIso) cell.classList.add('cal-today');
    if (hasAny) {
      cell.classList.add('has-items');
      if (hasP) cell.classList.add('has-projects');
      if (hasT) cell.classList.add('has-tasks');
      if (hasE) cell.classList.add('has-events');
    }

    const numEl = document.createElement('div');
    numEl.className = 'cal-num';
    numEl.textContent = day;
    cell.appendChild(numEl);

    if (hasAny) {
      const dots = document.createElement('div');
      dots.className = 'cal-dots';
      if (hasP) dots.appendChild(Utils.el('span', { class: 'cal-dot dot-project', title: dayProjects.length + ' project(s)' }));
      if (hasT) dots.appendChild(Utils.el('span', { class: 'cal-dot dot-task', title: dayTasks.length + ' task(s)' }));
      if (hasE) dots.appendChild(Utils.el('span', { class: 'cal-dot dot-event', title: dayEvents.length + ' event(s)' }));
      cell.appendChild(dots);
    }

    dayProjects.forEach(p => {
      const entry = document.createElement('div');
      entry.className = 'cal-entry cal-entry-project';
      entry.innerText = '📋 ' + p.title;
      cell.appendChild(entry);
    });
    dayTasks.forEach(t => {
      const entry = document.createElement('div');
      entry.className = 'cal-entry cal-entry-task';
      entry.style.background = 'rgba(139, 92, 246, 0.4)';
      entry.innerText = '🔔 ' + t.title;
      cell.appendChild(entry);
    });
    dayEvents.forEach(e => {
      const entry = document.createElement('div');
      entry.className = 'cal-entry cal-entry-event';
      entry.style.background = 'rgba(251, 211, 141, 0.3)';
      entry.innerText = '📌 ' + e.name;
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

  const canManageEvents = isPrivileged();
  dayEvents.forEach(e => {
    html +=
      '<div class="cal-day-item" style="border-left-color:#fbd38d; position:relative; padding-right:2.5rem;">' +
        '<div class="cal-item-title">📌 ' + esc(e.name) + '</div>' +
        '<div class="cal-item-meta"><span>Event' + (e.completed ? ' • ✅ Completed' : '') + '</span></div>' +
        (canManageEvents
          ? '<button class="cal-event-del-btn" data-cal-evt-del="' + esc(e.id) + '" type="button" title="Delete event">✕</button>'
          : '') +
      '</div>';
  });

  body.innerHTML = html;

  body.querySelectorAll('[data-cal-evt-del]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const evtId = btn.dataset.calEvtDel;
      await deleteEvent(evtId);
      openCalendarDayModal(dateStr);
    });
  });

  document.getElementById('calendarDayModal').classList.add('active');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 17: ATTENDANCE
   · 15-min check-in cooldown
   · Geofence enforcement on check-in / check-out
   · Random spot-checks while a session is open (check_type = SPOT_CHECK)
   ═══════════════════════════════════════════════════════════════════════ */

const CHECKIN_COOLDOWN_MS      = 15 * 60 * 1000;
const SPOT_CHECK_MIN_MS        = 20 * 60 * 1000;
const SPOT_CHECK_MAX_MS        = 40 * 60 * 1000;
const SPOT_CHECK_RESPONSE_MS   = 90 * 1000;
const SPOT_CHECK_STATE_KEY     = 'jcompass_spot_state_v1';

let attendanceTickerId = null;
let spotCheckTickerId  = null;
let spotCheckOverlayEl = null;
let spotCheckCountdownInterval = null;

const getTodayStr = () => Utils.todayLocalISO();

/* ── Generic helpers ─────────────────────────────────────────────── */
function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ── Session helpers ─────────────────────────────────────────────── */
function isCheckInRow(log) {
  return (log.check_type || 'CHECK_IN') === 'CHECK_IN';
}
function isSpotCheckRow(log) {
  return log.check_type === 'SPOT_CHECK';
}

function hasAnyCheckInToday() {
  if (!currentUser) return false;
  const today = getTodayStr();
  return attendanceLogs.some(log =>
    log.reporter === currentUser.name &&
    log.date === today &&
    isCheckInRow(log)
  );
}

function getActiveAttendanceSession() {
  if (!currentUser) return null;
  const today = getTodayStr();
  const todays = attendanceLogs
    .filter(l => l.reporter === currentUser.name && l.date === today && isCheckInRow(l))
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return todays.find(l => !l.check_out_time) || null;
}

function getLastCheckInForToday() {
  if (!currentUser) return null;
  const today = getTodayStr();
  const todays = attendanceLogs
    .filter(l => l.reporter === currentUser.name && l.date === today && isCheckInRow(l))
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return todays[0] || null;
}

function getCheckInCooldownRemaining() {
  if (!currentUser) return 0;
  if (getActiveAttendanceSession()) return 0;
  const last = getLastCheckInForToday();
  if (!last || !last.timestamp) return 0;
  const elapsed = Date.now() - new Date(last.timestamp).getTime();
  const remaining = CHECKIN_COOLDOWN_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}

function getSpotChecksForSession(sessionId) {
  if (sessionId == null) return [];
  const key = String(sessionId);
  return attendanceLogs
    .filter(l => isSpotCheckRow(l) && String(l.session_ref) === key)
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
}

/* ── Find the deployment (and thus venue) linked to a session ────── */
function getSessionDeployment(session) {
  if (!session || !session.task_ref_id) return null;
  return deployments.find(d => String(d.id) === String(session.task_ref_id)) || null;
}

function getVenueForSession(session) {
  const dep = getSessionDeployment(session);
  if (!dep) return null;
  const lat = parseFloat(dep.venue_lat ?? dep.venueLat);
  const lon = parseFloat(dep.venue_lon ?? dep.venueLon);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const radius = parseInt(dep.venue_radius ?? dep.venueRadius, 10) || 150;
  const name = dep.venue_name || dep.venueName || dep.title;
  return { lat, lon, radius, name };
}

function geofenceCheck(venue, lat, lon) {
  if (!venue) return { ok: true };
  const dist = distanceMeters(venue.lat, venue.lon, lat, lon);
  if (dist <= venue.radius) return { ok: true, dist };
  return { ok: false, dist };
}

/* ── Persisted spot-check scheduling state ───────────────────────── */
function loadSpotState() {
  try {
    const raw = localStorage.getItem(SPOT_CHECK_STATE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (!s || typeof s !== 'object') throw 0;
    return s;
  } catch { return null; }
}
function saveSpotState(s) {
  try {
    if (s == null) localStorage.removeItem(SPOT_CHECK_STATE_KEY);
    else localStorage.setItem(SPOT_CHECK_STATE_KEY, JSON.stringify(s));
  } catch {}
}

function ensureSpotScheduleForSession(session) {
  if (!session) { saveSpotState(null); return null; }
  let s = loadSpotState();
  if (!s || String(s.sessionId) !== String(session.id)) {
    const nextDelay = SPOT_CHECK_MIN_MS +
      Math.floor(Math.random() * (SPOT_CHECK_MAX_MS - SPOT_CHECK_MIN_MS));
    s = {
      sessionId: String(session.id),
      startedAt: Date.now(),
      nextAt: Date.now() + nextDelay,
      lastAt: Date.now()
    };
    saveSpotState(s);
  }
  return s;
}

/* ── Spot-check overlay ──────────────────────────────────────────── */
function ensureSpotCheckOverlay() {
  if (spotCheckOverlayEl && document.body.contains(spotCheckOverlayEl)) return spotCheckOverlayEl;
  const el = document.createElement('div');
  el.className = 'spot-check-overlay';
  el.id = 'spotCheckOverlay';
  el.style.display = 'none';
  el.innerHTML =
    '<div class="spot-check-box">' +
      '<div class="spot-check-icon">📍</div>' +
      '<h2>Still at the venue?</h2>' +
      '<p>Tap below to confirm your location. This keeps your session verified.</p>' +
      '<div class="spot-check-timer" id="spotCheckTimer">90</div>' +
      '<button class="btn btn-primary" id="spotCheckConfirmBtn" type="button">✓ I\'m here</button>' +
    '</div>';
  document.body.appendChild(el);
  el.querySelector('#spotCheckConfirmBtn').addEventListener('click', handleSpotCheckConfirm);
  spotCheckOverlayEl = el;
  return el;
}

function showSpotCheckPrompt() {
  const session = getActiveAttendanceSession();
  if (!session) return false;
  const el = ensureSpotCheckOverlay();
  el.style.display = 'flex';

  let remaining = Math.ceil(SPOT_CHECK_RESPONSE_MS / 1000);
  const timerEl = el.querySelector('#spotCheckTimer');
  timerEl.textContent = remaining;
  timerEl.classList.remove('danger');

  clearInterval(spotCheckCountdownInterval);
  spotCheckCountdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 30) timerEl.classList.add('danger');
    timerEl.textContent = remaining > 0 ? remaining : 0;
    if (remaining <= 0) {
      clearInterval(spotCheckCountdownInterval);
      spotCheckCountdownInterval = null;
      if (document.visibilityState === 'visible') {
        recordSpotCheck(session, null, 'MISSED');
      }
      hideSpotCheckPrompt();
      scheduleNextSpotCheck(session, true);
    }
  }, 1000);

  if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch {} }
  return true;
}

function hideSpotCheckPrompt() {
  if (spotCheckOverlayEl) spotCheckOverlayEl.style.display = 'none';
  clearInterval(spotCheckCountdownInterval);
  spotCheckCountdownInterval = null;
}

async function handleSpotCheckConfirm() {
  const session = getActiveAttendanceSession();
  if (!session) { hideSpotCheckPrompt(); return; }
  if (!navigator.geolocation) {
    triggerNotificationToast('Geolocation not supported.');
    return;
  }
  const btn = spotCheckOverlayEl?.querySelector('#spotCheckConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Locating…'; }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = Math.round(pos.coords.accuracy);
    const label = await reverseGeocodeLabel(lat, lon);

    const venue = getVenueForSession(session);
    const fence = geofenceCheck(venue, lat, lon);
    const note = fence.ok ? '' : 'OUTSIDE_VENUE';

    await recordSpotCheck(session, {
      lat: lat.toFixed(6), lon: lon.toFixed(6),
      accuracy, location: label, note
    });

    hideSpotCheckPrompt();
    if (btn) { btn.disabled = false; btn.textContent = '✓ I\'m here'; }

    if (fence.ok) {
      triggerNotificationToast('✓ Location verified.');
    } else {
      triggerNotificationToast('⚠ Recorded — you appear ' + Math.round(fence.dist) + ' m from the venue.');
    }

    scheduleNextSpotCheck(session, true);
  }, () => {
    if (btn) { btn.disabled = false; btn.textContent = '✓ I\'m here'; }
    triggerNotificationToast('Location access denied. Spot-check marked missed.');
    recordSpotCheck(session, null, 'MISSED').then(() => {
      hideSpotCheckPrompt();
      scheduleNextSpotCheck(session, true);
    });
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}

async function recordSpotCheck(session, geo, forceNote) {
  if (!currentUser || !session) return null;
  const now = new Date();
  const entry = {
    id: 'pending-' + now.getTime(),
    reporter: currentUser.name,
    role: currentUser.role,
    date: getTodayStr(),
    time: Utils.fmtTime(now),
    lat: geo ? geo.lat : '',
    lon: geo ? geo.lon : '',
    accuracy: geo ? geo.accuracy : '',
    location: geo ? geo.location : 'Location unavailable',
    note: forceNote || (geo && geo.note) || '',
    timestamp: now.toISOString(),
    check_out_time: '', check_out_lat: '', check_out_lon: '', check_out_timestamp: '',
    task_ref: session.task_ref || '',
    task_ref_id: session.task_ref_id || '',
    check_type: 'SPOT_CHECK',
    session_ref: String(session.id)
  };

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('attendance').insert({
        reporter: entry.reporter,
        role: entry.role,
        date: entry.date,
        time: entry.time,
        lat: entry.lat ? parseFloat(entry.lat) : null,
        lon: entry.lon ? parseFloat(entry.lon) : null,
        accuracy: entry.accuracy || null,
        location: entry.location,
        note: entry.note,
        timestamp_iso: entry.timestamp,
        task_ref: entry.task_ref,
        task_ref_id: entry.task_ref_id,
        check_type: 'SPOT_CHECK',
        session_ref: entry.session_ref
      }).select().single();
      if (error) throw error;
      if (data && data.id) entry.id = 'remote-' + data.id;
    } catch (err) {
      console.warn('Spot-check write failed:', err);
    }
  }
  attendanceLogs.push(entry);
  flushCachedCollections();
  renderAttendanceTable();
  return entry;
}

function scheduleNextSpotCheck(session, fromNow) {
  if (!session) { saveSpotState(null); return; }
  const delay = SPOT_CHECK_MIN_MS +
    Math.floor(Math.random() * (SPOT_CHECK_MAX_MS - SPOT_CHECK_MIN_MS));
  const state = {
    sessionId: String(session.id),
    startedAt: (loadSpotState()?.startedAt) || Date.now(),
    lastAt: Date.now(),
    nextAt: Date.now() + (fromNow ? delay : 0)
  };
  saveSpotState(state);
}

function startSpotCheckScheduler() {
  if (spotCheckTickerId) return;
  spotCheckTickerId = setInterval(() => {
    const session = getActiveAttendanceSession();
    if (!session) { saveSpotState(null); return; }
    if (spotCheckOverlayEl && spotCheckOverlayEl.style.display === 'flex') return;
    if (document.visibilityState !== 'visible') return;
    const s = ensureSpotScheduleForSession(session);
    if (!s) return;
    if (Date.now() >= s.nextAt) {
      const shown = showSpotCheckPrompt();
      if (!shown) scheduleNextSpotCheck(session, true);
    }
  }, 30 * 1000);
}

function stopSpotCheckScheduler() {
  if (spotCheckTickerId) {
    clearInterval(spotCheckTickerId);
    spotCheckTickerId = null;
  }
  hideSpotCheckPrompt();
  saveSpotState(null);
}

/* ── Attendance UI ───────────────────────────────────────────────── */
function stopAttendanceTicker() {
  if (attendanceTickerId) {
    clearInterval(attendanceTickerId);
    attendanceTickerId = null;
  }
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
    const hasVenue = !!getVenueForDeployment(d);
    opt.textContent = (hasVenue ? '📍 ' : '📡 ') + d.title + (d.location ? ' — ' + d.location : '');
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

function getVenueForDeployment(d) {
  if (!d) return null;
  const lat = parseFloat(d.venue_lat ?? d.venueLat);
  const lon = parseFloat(d.venue_lon ?? d.venueLon);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const radius = parseInt(d.venue_radius ?? d.venueRadius, 10) || 150;
  const name = d.venue_name || d.venueName || d.title;
  return { lat, lon, radius, name };
}

function updateAttendanceButtons() {
  const btnIn = document.getElementById('checkInBtn');
  const btnOut = document.getElementById('checkOutBtn');
  const statusEl = document.getElementById('attendanceTodayStatus');
  if (!btnIn || !btnOut || !statusEl) return;

  stopAttendanceTicker();
  btnIn.classList.remove('cooldown-active', 'checked-in-active');

  const activeSession = getActiveAttendanceSession();

  if (activeSession) {
    btnIn.disabled = true;
    btnIn.textContent = '✓ Checked In';
    btnIn.style.background = 'var(--success)';
    btnIn.classList.add('checked-in-active');

    btnOut.disabled = false;
    btnOut.style.background = '';

    const venue = getVenueForSession(activeSession);

    const paintDuration = () => {
      const live = getActiveAttendanceSession();
      if (!live) { stopAttendanceTicker(); updateAttendanceButtons(); return; }
      const since = live.timestamp ? new Date(live.timestamp).getTime() : Date.now();
      const dur = formatDuration(Date.now() - since);

      const spotCount = getSpotChecksForSession(live.id);
      const confirmed = spotCount.filter(s => s.note !== 'MISSED' && s.note !== 'OUTSIDE_VENUE').length;
      const missed    = spotCount.filter(s => s.note === 'MISSED').length;
      const outside   = spotCount.filter(s => s.note === 'OUTSIDE_VENUE').length;

      let spotLine = '';
      if (spotCount.length === 0) {
        spotLine = '<br>Spot-checks: <b>none yet</b> — random verification is active.';
      } else {
        spotLine = '<br>Spot-checks: <b>' + confirmed + ' verified</b>' +
          (missed ? ' · <span style="color:#fc8181;">' + missed + ' missed</span>' : '') +
          (outside ? ' · <span style="color:#fbd38d;">' + outside + ' outside venue</span>' : '');
      }

      const venueLine = venue
        ? '<br>📍 Venue: <b>' + esc(venue.name) + '</b> (' + venue.radius + ' m radius)'
        : '';

      statusEl.innerHTML =
        '✓ Checked in at <b>' + esc(live.time) + '</b>' +
        (live.location ? ' · ' + esc(live.location) : '') +
        ' · Duration: <b>' + dur + '</b>' + venueLine + spotLine;
    };
    paintDuration();
    attendanceTickerId = setInterval(paintDuration, 1000);

    if (!spotCheckTickerId) startSpotCheckScheduler();
    return;
  }

  const cooldown = getCheckInCooldownRemaining();
  if (cooldown > 0) {
    btnIn.disabled = true;
    btnOut.disabled = true;
    btnOut.style.background = '';
    btnIn.style.background = '';
    btnIn.classList.add('cooldown-active');

    const tickCooldown = () => {
      const remaining = getCheckInCooldownRemaining();
      if (!remaining || remaining <= 0) {
        stopAttendanceTicker();
        updateAttendanceButtons();
        return;
      }
      const sec = Math.ceil(remaining / 1000);
      const m = Math.floor(sec / 60);
      const s = String(sec % 60).padStart(2, '0');
      btnIn.textContent = '⏳ ' + m + ':' + s;
      statusEl.innerHTML = '✓ You already checked in today. Next check-in available in <b>' + m + ':' + s + '</b>.';
    };
    tickCooldown();
    attendanceTickerId = setInterval(tickCooldown, 1000);
    return;
  }

  btnIn.disabled = false;
  btnIn.textContent = '📍 Check In';
  btnIn.style.background = '';
  btnOut.disabled = true;
  btnOut.style.background = '';

  if (hasAnyCheckInToday()) {
    statusEl.innerHTML = '✓ You have already checked in today. You can check in again now.';
  } else {
    statusEl.innerHTML = 'You have not checked in today.';
  }
}

function renderAttendanceTable() {
  const tbody = document.getElementById('attendanceTableBody');
  const emptyRow = document.getElementById('attendanceEmptyRow');
  if (!tbody) return;

  Array.from(tbody.querySelectorAll('tr:not(#attendanceEmptyRow)')).forEach(r => r.remove());

  const q = attendanceSearchQuery.toLowerCase();
  const visible = attendanceLogs.filter(log => !isSpotCheckRow(log));
  const subset = visible.filter(log =>
    (log.reporter || '').toLowerCase().includes(q) ||
    (log.date || '').includes(attendanceSearchQuery) ||
    (log.location && log.location.toLowerCase().includes(q)) ||
    (log.task_ref && log.task_ref.toLowerCase().includes(q))
  );

  if (subset.length === 0) {
    if (emptyRow) emptyRow.style.display = '';
    return;
  }
  if (emptyRow) emptyRow.style.display = 'none';

  const groups = new Map();
  subset.slice(0, 200).forEach(log => {
    const key = log.date || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(log);
  });

  const sortedDates = Array.from(groups.keys()).sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return b.localeCompare(a);
  });

  const todayIso = Utils.todayLocalISO();
  const yesterdayIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();

  let globalIdx = 0;
  sortedDates.forEach(dateKey => {
    const rows = groups.get(dateKey);

    const separator = document.createElement('tr');
    separator.className = 'attendance-day-separator';
    let dayLabel;
    if (dateKey === todayIso) dayLabel = '📅 Today';
    else if (dateKey === yesterdayIso) dayLabel = '📅 Yesterday';
    else if (dateKey === 'unknown') dayLabel = '📅 Unknown date';
    else {
      const d = new Date(dateKey + 'T00:00:00');
      dayLabel = '📅 ' + d.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
    }
    const totalCheckins = rows.length;
    const stillOpen = rows.filter(r => !r.check_out_time).length;
    const openTag = stillOpen > 0
      ? ' · <span style="color:#9ae6b4;">' + stillOpen + ' open</span>'
      : '';

    separator.innerHTML =
      '<td colspan="13" class="attendance-day-separator-cell">' +
        '<span class="attendance-day-label">' + esc(dayLabel) + '</span>' +
        '<span class="attendance-day-count">' + totalCheckins + ' record' + (totalCheckins === 1 ? '' : 's') + openTag + '</span>' +
      '</td>';
    tbody.appendChild(separator);

    rows.forEach(log => {
      globalIdx++;

      let durationCell = '—';
      if (log.timestamp && log.check_out_timestamp) {
        durationCell = formatDuration(new Date(log.check_out_timestamp) - new Date(log.timestamp));
      } else if (log.timestamp) {
        durationCell = '<span style="color:#9ae6b4;font-weight:600;">' +
          formatDuration(Date.now() - new Date(log.timestamp).getTime()) +
          '</span> <span style="font-size:0.68rem;color:var(--text-muted);">live</span>';
      }

      const checks = getSpotChecksForSession(log.id);
      let checksCell = '<span style="color:var(--text-muted);font-size:0.78rem;">—</span>';
      if (checks.length > 0) {
        const okCount = checks.filter(s => s.note !== 'MISSED' && s.note !== 'OUTSIDE_VENUE').length;
        const missCount = checks.filter(s => s.note === 'MISSED').length;
        const outCount = checks.filter(s => s.note === 'OUTSIDE_VENUE').length;
        checksCell =
          '<button class="spot-summary-btn" data-spot-open="' + esc(log.id) + '" type="button">' +
            '<span class="ok">' + okCount + ' ✓</span>' +
            (missCount ? '<span class="missed">· ' + missCount + ' missed</span>' : '') +
            (outCount ? '<span style="color:#fbd38d;">· ' + outCount + ' out</span>' : '') +
          '</button>';
      } else if (!log.check_out_time) {
        checksCell = '<span style="color:var(--text-muted);font-size:0.72rem;">tracking…</span>';
      }

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
      tr.innerHTML =
        '<td style="padding:0.75rem 1.25rem;">' + globalIdx + '</td>' +
        '<td style="padding:0.75rem 1rem;font-weight:600;">' + esc(log.reporter) + '</td>' +
        '<td style="padding:0.75rem 1rem;">' + esc(log.date) + '</td>' +
        '<td style="padding:0.75rem 1rem;color:#9ae6b4;">' + esc(log.time) + '</td>' +
        '<td style="padding:0.75rem 1rem;color:' + (log.check_out_time ? '#fc8181' : 'var(--text-muted)') + ';">' + esc(log.check_out_time || '—') + '</td>' +
        '<td style="padding:0.75rem 1rem;font-size:0.8rem;">' + durationCell + '</td>' +
        '<td style="padding:0.75rem 1rem;font-size:0.8rem;">' + checksCell + '</td>' +
        '<td style="padding:0.75rem 1rem;font-size:0.75rem;">' + esc((log.lat || '—') + ', ' + (log.lon || '—')) + '</td>' +
        '<td style="padding:0.75rem 1rem;">' + esc(log.location || '—') + '</td>' +
        '<td style="padding:0.75rem 1rem;font-size:0.78rem;">' + (log.task_ref ? '📡 ' + esc(log.task_ref) : '—') + '</td>' +
        '<td style="padding:0.75rem 1rem;">' + esc(log.note || '—') + '</td>' +
        '<td style="padding:0.75rem 1rem;">' + esc(log.role) + '</td>' +
        '<td style="padding:0.75rem 1rem;"><button class="card-action-btn" data-map-idx="' + subset.indexOf(log) + '" style="padding:0.25rem 0.5rem; font-size:0.85rem;" type="button">🗺️</button></td>';
      tbody.appendChild(tr);
    });
  });

  tbody.querySelectorAll('[data-map-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.mapIdx, 10);
      const log = subset[idx];
      if (log) openGeoMap(log);
    });
  });
  tbody.querySelectorAll('[data-spot-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = btn.dataset.spotOpen;
      const log = attendanceLogs.find(l => String(l.id) === String(sessionId));
      if (log) openGeoMap(log);
    });
  });
}

function openGeoMap(log) {
  if (!log) return;
  const info = document.getElementById('geoMapReporterInfo');

  let durationStr = '—';
  if (log.timestamp && log.check_out_timestamp) {
    durationStr = formatDuration(new Date(log.check_out_timestamp) - new Date(log.timestamp));
  } else if (log.timestamp) {
    durationStr = formatDuration(Date.now() - new Date(log.timestamp).getTime()) + ' (live)';
  }

  const venue = getVenueForSession(log);
  const checks = getSpotChecksForSession(log.id);
  const okCount   = checks.filter(s => s.note !== 'MISSED' && s.note !== 'OUTSIDE_VENUE').length;
  const missCount = checks.filter(s => s.note === 'MISSED').length;
  const outCount  = checks.filter(s => s.note === 'OUTSIDE_VENUE').length;

  const timelineHtml = checks.length === 0
    ? '<div class="spot-timeline-empty">No spot-checks recorded for this session.</div>'
    : checks.map(s => {
        const cls = s.note === 'MISSED' ? 'missed' :
                    s.note === 'OUTSIDE_VENUE' ? 'missed' : 'ok';
        const tag = s.note === 'MISSED' ? '✕ MISSED' :
                    s.note === 'OUTSIDE_VENUE' ? '⚠ OUTSIDE VENUE' : '✓ VERIFIED';
        return '<div class="spot-timeline-row ' + cls + '">' +
          '<span class="st-time">' + esc(s.time || '—') + '</span>' +
          '<span class="st-tag">' + tag + '</span>' +
          '<span class="st-loc">' + esc(s.location || '') + '</span>' +
        '</div>';
      }).join('');

  info.innerHTML =
    '<div style="display:flex; flex-wrap:wrap; gap:1rem; align-items:center;">' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">NAME</span><div style="font-weight:700;">' + esc(log.reporter) + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">DATE</span><div style="font-weight:600;">' + esc(log.date) + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">IN</span><div style="font-weight:600; color:#9ae6b4;">' + esc(log.time) + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">OUT</span><div style="font-weight:600; color:' + (log.check_out_time ? '#fc8181' : 'var(--text-muted)') + ';">' + esc(log.check_out_time || '—') + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">DURATION</span><div style="font-weight:600;">' + durationStr + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">LOCATION</span><div style="font-weight:600;">' + esc(log.location || '—') + '</div></div>' +
      (log.task_ref ? '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">LINKED TO</span><div style="font-weight:600;">📡 ' + esc(log.task_ref) + '</div></div>' : '') +
    '</div>' +
    (venue
      ? '<div style="margin-top:0.6rem; font-size:0.8rem; color:var(--text-muted);">📍 Venue: <b>' + esc(venue.name) + '</b> · ' + venue.radius + ' m radius</div>'
      : '') +
    (log.note ? '<div style="margin-top:0.5rem; font-size:0.82rem; color:var(--text-muted);">📝 ' + esc(log.note) + '</div>' : '') +
    '<div class="spot-timeline">' +
      '<div class="spot-timeline-title">Spot-check timeline · ' + okCount + ' verified, ' + missCount + ' missed' + (outCount ? ', ' + outCount + ' outside venue' : '') + '</div>' +
      timelineHtml +
    '</div>';

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
  const todayCount = attendanceLogs.filter(l => l.date === today && !isSpotCheckRow(l)).length;
  const statToday = document.getElementById('statTodayCount');
  const statTotal = document.getElementById('statTotalCount');
  if (statToday) statToday.innerText = todayCount;
  if (statTotal) statTotal.innerText = attendanceLogs.filter(l => !isSpotCheckRow(l)).length;
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
  const cooldown = getCheckInCooldownRemaining();
  if (cooldown > 0) {
    const m = Math.floor(Math.ceil(cooldown / 1000) / 60);
    const s = String(Math.ceil(cooldown / 1000) % 60).padStart(2, '0');
    triggerNotificationToast('Please wait ' + m + ':' + s + ' before checking in again.');
    return;
  }

  btn.disabled = true;
  btn.innerText = '⏳ Locating...';

  if (!navigator.geolocation) {
    triggerNotificationToast('Geolocation not supported.');
    updateAttendanceButtons();
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;
    const now = new Date();

    const taskRefSelect = document.getElementById('attendanceTaskRef');
    const taskRefVal = taskRefSelect ? taskRefSelect.value : '';
    let taskRefTitle = '', taskRefId = '';
    if (taskRefVal) {
      const parts = taskRefVal.split('|');
      taskRefId = parts[0] || '';
      taskRefTitle = parts[1] || '';
    }
    const linkedDep = taskRefId ? deployments.find(d => String(d.id) === String(taskRefId)) : null;
    const venue = linkedDep ? getVenueForDeployment(linkedDep) : null;
    if (venue) {
      const fence = geofenceCheck(venue, lat, lon);
      if (!fence.ok) {
        triggerNotificationToast('❌ You are ' + Math.round(fence.dist) + ' m from "' + venue.name + '". Must be within ' + venue.radius + ' m.');
        updateAttendanceButtons();
        return;
      }
    }

    const locationLabel = await reverseGeocodeLabel(lat, lon);
    const noteInput = document.getElementById('attendanceLocationNote');
    const note = noteInput ? noteInput.value.trim() : '';

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
      task_ref_id: taskRefId,
      check_type: 'CHECK_IN',
      session_ref: null
    };

    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('attendance').insert({
          reporter: entry.reporter, role: entry.role, date: entry.date, time: entry.time,
          lat: parseFloat(entry.lat), lon: parseFloat(entry.lon), accuracy: entry.accuracy,
          location: entry.location, note: entry.note, timestamp_iso: entry.timestamp,
          task_ref: entry.task_ref, task_ref_id: entry.task_ref_id,
          check_type: 'CHECK_IN'
        }).select().single();
        if (error) throw error;
        if (data && data.id) entry.id = 'remote-' + data.id;
      } catch (err) {
        triggerNotificationToast('Backend error: ' + err.message);
        updateAttendanceButtons();
        return;
      }
    }

    attendanceLogs.unshift(entry);
    flushCachedCollections();
    renderAttendanceTable();
    updateAttendanceStats();
    updateAttendanceButtons();
    if (noteInput) noteInput.value = '';

    ensureSpotScheduleForSession(entry);
    startSpotCheckScheduler();

    triggerNotificationToast('✓ Checked in at ' + entry.time);
  }, () => {
    updateAttendanceButtons();
    triggerNotificationToast('Location access denied.');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
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
    updateAttendanceButtons();
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const now = new Date();

    const venue = getVenueForSession(activeSession);
    if (venue) {
      const fence = geofenceCheck(venue, lat, lon);
      if (!fence.ok) {
        triggerNotificationToast('❌ You are ' + Math.round(fence.dist) + ' m from "' + venue.name + '". Must check out within ' + venue.radius + ' m.');
        updateAttendanceButtons();
        return;
      }
    }

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
          updateAttendanceButtons();
          return;
        }
      }
    }

    Object.assign(activeSession, updates);
    stopSpotCheckScheduler();
    flushCachedCollections();
    renderAttendanceTable();
    updateAttendanceStats();
    updateAttendanceButtons();

    const since = activeSession.timestamp ? new Date(activeSession.timestamp).getTime() : null;
    const durMsg = since ? ' — session ' + formatDuration(Date.now() - since) : '';
    triggerNotificationToast('✓ Checked out at ' + updates.check_out_time + durMsg);
  }, () => {
    updateAttendanceButtons();
    triggerNotificationToast('Location access denied.');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}

function initAttendancePage() {
  startLiveClock();
  populateAttendanceTaskRefs();
  renderAttendanceTable();
  updateAttendanceStats();
  updateAttendanceButtons();

  const session = getActiveAttendanceSession();
  if (session) {
    ensureSpotScheduleForSession(session);
    startSpotCheckScheduler();
  }
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
  stopSpotCheckScheduler();
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
  const canManage = isPrivileged();
  activitySummaries.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-title">' + esc(r.title || 'Summary') + '</div>' +
      '<div style="font-size:0.82rem;color:var(--text-muted);white-space:pre-line;line-height:1.6;">' + esc(r.summary || '') + '</div>' +
      '<div class="card-action-row">' +
        '<button class="card-action-btn" data-sum-export="' + esc(r.id) + '" type="button">⬇ Export</button>' +
        (canManage ? '<button class="card-action-btn delete-btn" data-sum-delete="' + esc(r.id) + '" type="button">🗑 Delete</button>' : '') +
      '</div>';
    container.appendChild(card);
  });
  container.querySelectorAll('[data-sum-export]').forEach(btn =>
    btn.addEventListener('click', () => exportActivitySummary(btn.dataset.sumExport)));
  container.querySelectorAll('[data-sum-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteActivitySummary(btn.dataset.sumDelete)));
}

function exportActivitySummary(summaryId) {
  const idIsNum = !isNaN(parseInt(summaryId, 10));
  const id = idIsNum ? parseInt(summaryId, 10) : summaryId;
  const s = activitySummaries.find(x => x.id === id || String(x.id) === String(summaryId));
  if (!s) { triggerNotificationToast('Summary not found.'); return; }

  const rows = [
    ['Title', s.title || ''],
    ['Generated By', s.generatedBy || ''],
    ['Timestamp', s.timestamp || ''],
    ['']
  ];
  String(s.summary || '').split('\n').forEach(line => rows.push([line]));

  downloadCSV('jcompass-summary-' + Utils.todayLocalISO() + '.csv', rows);
  triggerNotificationToast('✓ Summary exported.');
}

async function deleteActivitySummary(summaryId) {
  if (!isPrivileged()) { triggerNotificationToast('Admin access required.'); return; }
  const idIsNum = !isNaN(parseInt(summaryId, 10));
  const id = idIsNum ? parseInt(summaryId, 10) : summaryId;
  const idx = activitySummaries.findIndex(x => x.id === id || String(x.id) === String(summaryId));
  if (idx < 0) return;
  if (!confirm('Delete this summary?')) return;
  const [removed] = activitySummaries.splice(idx, 1);
  await logAudit('delete_summary', 'summary', removed.id, removed.title || 'Summary', 'Deleted');
  generateActivitySummaryGrid();
  injectAdminClearButtons();
  triggerNotificationToast('✓ Summary deleted.');
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
  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr && !isSpotCheckRow(l));
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
  injectAdminClearButtons();
  triggerNotificationToast('✓ Summary generated.');
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 21: WORK ASSIGNED
   ═══════════════════════════════════════════════════════════════════════ */

function generateSourcesGrid() {
  const container = document.getElementById('sourcesGrid');
  if (!container) return;
  container.innerHTML = '';

  const allMembers = registeredUsersDB.filter(u =>
    u.role === 'STAFF' || u.role === 'ADMIN' || u.role === 'EDITOR'
  );

  const visibleMembers = isPrivileged()
    ? allMembers
    : allMembers.filter(u => currentUser && u.name === currentUser.name);

  const q = sourceSearchQuery.toLowerCase();
  const filtered = visibleMembers.filter(u => !q || u.name.toLowerCase().includes(q));

  if (filtered.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No team members found.</div>';
    return;
  }

  filtered.forEach(member => {
    const memberProjects = projects.filter(p => !p.archived && (p.reporter || '').split(',').map(s => s.trim()).includes(member.name));
    const memberTasks = assignments.filter(a => !a.archived && isUserAssigned(a.assignee, member.name));
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

  const groups = new Map();
  subset.slice(0, 200).forEach(e => {
    let dayKey = 'unknown';
    if (e.created_at) {
      try {
        const d = new Date(e.created_at);
        const p = n => String(n).padStart(2, '0');
        dayKey = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      } catch {}
    }
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    groups.get(dayKey).push(e);
  });

  const sortedDates = Array.from(groups.keys()).sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return b.localeCompare(a);
  });

  const todayIso = Utils.todayLocalISO();
  const yesterdayIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();

  const actionColors = {
    delete: '#fc8181', archive: '#fbd38d', create: '#9ae6b4',
    submit: '#90cdf4', approve: '#81e6d9', update: '#cbd5e1',
    notify: '#a78bfa', ping: '#a78bfa', clear: '#f43f5e', deny: '#f43f5e',
    reject: '#f43f5e', request: '#fbd38d', restore: '#9ae6b4',
    extend: '#fbd38d'
  };

  sortedDates.forEach(dateKey => {
    const rows = groups.get(dateKey);

    const separator = document.createElement('tr');
    separator.className = 'activity-day-separator';
    let dayLabel;
    if (dateKey === todayIso) dayLabel = '📅 Today';
    else if (dateKey === yesterdayIso) dayLabel = '📅 Yesterday';
    else if (dateKey === 'unknown') dayLabel = '📅 Unknown date';
    else {
      const d = new Date(dateKey + 'T00:00:00');
      dayLabel = '📅 ' + d.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
    }
    const total = rows.length;
    separator.innerHTML =
      '<td colspan="5" class="activity-day-separator-cell">' +
        '<span class="activity-day-label">' + esc(dayLabel) + '</span>' +
        '<span class="activity-day-count">' + total + ' event' + (total === 1 ? '' : 's') + '</span>' +
      '</td>';
    tbody.appendChild(separator);

    rows.forEach(e => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
      const key = Object.keys(actionColors).find(k => (e.action || '').toLowerCase().includes(k));
      const color = actionColors[key] || '#cbd5e1';
      tr.innerHTML =
        '<td style="padding:0.75rem 1.25rem;font-size:0.78rem;color:var(--text-muted);white-space:nowrap;">' +
          esc(e.created_at ? new Date(e.created_at).toLocaleString('en-US', {
            hour: '2-digit', minute: '2-digit'
          }) : '—') +
        '</td>' +
        '<td style="padding:0.75rem 1rem;font-weight:600;">' + esc(e.actor || '—') + '</td>' +
        '<td style="padding:0.75rem 1rem;font-weight:700;color:' + color + ';font-size:0.75rem;text-transform:uppercase;letter-spacing:0.5px;">' + esc((e.action || '').replace(/_/g, ' ')) + '</td>' +
        '<td style="padding:0.75rem 1rem;font-size:0.82rem;">' + (e.target_type ? '<span style="color:var(--text-muted);">' + esc(e.target_type) + ':</span> ' : '') + esc(e.target_name || '—') + '</td>' +
        '<td style="padding:0.75rem 1rem;font-size:0.78rem;color:var(--text-muted);">' + esc(e.details || '—') + '</td>';
      tbody.appendChild(tr);
    });
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
  const rowsIn = attendanceLogs.filter(l => !isSpotCheckRow(l));
  if (rowsIn.length === 0) { triggerNotificationToast('No attendance data.'); return; }
  const rows = [['Reporter','Role','Date','CheckIn','CheckOut','Duration','Verified Checks','Missed','Outside Venue','Latitude','Longitude','Accuracy','Location','LinkedTo','Note']];
  rowsIn.forEach(l => {
    let dur = '';
    if (l.timestamp && l.check_out_timestamp) {
      dur = formatDuration(new Date(l.check_out_timestamp) - new Date(l.timestamp));
    } else if (l.timestamp) {
      dur = formatDuration(Date.now() - new Date(l.timestamp).getTime()) + ' (live)';
    }
    const checks = getSpotChecksForSession(l.id);
    const ok    = checks.filter(s => s.note !== 'MISSED' && s.note !== 'OUTSIDE_VENUE').length;
    const miss  = checks.filter(s => s.note === 'MISSED').length;
    const out   = checks.filter(s => s.note === 'OUTSIDE_VENUE').length;
    rows.push([
      l.reporter, l.role, l.date, l.time, l.check_out_time || '',
      dur, ok, miss, out,
      l.lat, l.lon, l.accuracy, l.location, l.task_ref || '', l.note || ''
    ]);
  });
  downloadCSV('jcompass-attendance-' + Utils.todayLocalISO() + '.csv', rows);
  triggerNotificationToast('Exported ' + rowsIn.length + ' records.');
}

function exportAllReportsCSV() {
  const rows = [];
  const push = (...r) => rows.push(r);
  const section = (name) => { rows.push([]); rows.push(['=== ' + name + ' ===']); };

  const activeProjects = projects.filter(p => !p.archived);
  if (activeProjects.length) {
    section('PROJECTS (' + activeProjects.length + ')');
    push('ID','Title','Category','Deadline','Status','Priority','Progress','Reporter','Tags','Notes');
    activeProjects.forEach(p => push(
      p.id, p.title, p.category, p.deadline, p.status, p.priority,
      (p.progress || 0) + '%', p.reporter || '', p.tags || '', p.notes || ''
    ));
  }

  const asgs = assignments.filter(a => !a.archived);
  if (asgs.length) {
    section('ASSIGNMENTS (' + asgs.length + ')');
    push('ID','Title','Assignee(s)','Status','Priority','Due Date','Submitted By','Submitted At','Review Notes');
    asgs.forEach(a => push(
      a.id, a.title, a.assignee || '', a.status || '', a.priority || '',
      a.due_date || '', a.submitted_by || '', a.submitted_at || '', a.review_notes || ''
    ));
  }

  const deps = deployments.filter(d => !d.archived);
  if (deps.length) {
    section('FIELD OPERATIONS (' + deps.length + ')');
    push('ID','Title','Location','Assignee(s)','Priority','Status','Venue','Venue Radius (m)','Created By');
    deps.forEach(d => push(
      d.id, d.title, d.location || '', d.reporter || '',
      d.priority || '', d.status || '',
      d.venue_name || '', d.venue_radius || '', d.createdBy || ''
    ));
  }

  if (events.length) {
    section('EVENTS (' + events.length + ')');
    push('ID','Name','Date','Completed');
    events.forEach(e => push(e.id, e.name, e.date || '', e.completed ? 'Yes' : 'No'));
  }

  const attendRows = attendanceLogs.filter(l => !isSpotCheckRow(l));
  if (attendRows.length) {
    section('ATTENDANCE (' + attendRows.length + ')');
    push('Reporter','Role','Date','Check-In','Check-Out','Duration','Verified Checks','Missed','Outside Venue','Latitude','Longitude','Location','Linked To','Note');
    attendRows.forEach(l => {
      let dur = '';
      if (l.timestamp && l.check_out_timestamp) {
        dur = formatDuration(new Date(l.check_out_timestamp) - new Date(l.timestamp));
      } else if (l.timestamp) {
        dur = formatDuration(Date.now() - new Date(l.timestamp).getTime()) + ' (live)';
      }
      const checks = getSpotChecksForSession(l.id);
      const ok    = checks.filter(s => s.note !== 'MISSED' && s.note !== 'OUTSIDE_VENUE').length;
      const miss  = checks.filter(s => s.note === 'MISSED').length;
      const out   = checks.filter(s => s.note === 'OUTSIDE_VENUE').length;
      push(
        l.reporter, l.role, l.date, l.time, l.check_out_time || '', dur,
        ok, miss, out,
        l.lat, l.lon, l.location || '', l.task_ref || '', l.note || ''
      );
    });
  }

  const spotRows = attendanceLogs.filter(l => isSpotCheckRow(l));
  if (spotRows.length) {
    section('SPOT CHECKS (' + spotRows.length + ')');
    push('Reporter','Date','Time','Status','Location','Session Ref');
    spotRows.forEach(s => push(
      s.reporter, s.date, s.time,
      s.note === 'MISSED' ? 'MISSED' : s.note === 'OUTSIDE_VENUE' ? 'OUTSIDE VENUE' : 'VERIFIED',
      s.location || '', s.session_ref || ''
    ));
  }

  if (archiveRequests.length) {
    section('ARCHIVE REQUESTS (' + archiveRequests.length + ')');
    push('ID','Project','Requester','Date','Status');
    archiveRequests.forEach(r => push(
      r.id, r.project_title || '', r.requester || '',
      r.request_timestamp || '', r.status || ''
    ));
  }

  if (rows.length === 0) { triggerNotificationToast('Nothing to export.'); return; }
  downloadCSV('jcompass-all-reports-' + Utils.todayLocalISO() + '.csv', rows);
  triggerNotificationToast('✓ All reports exported.');
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

  const overdue = getOverdueProjects();

  const notices = [];
  if (overdue.length > 0) {
    notices.push({
      id: dayKey + ':overdue-' + overdue.length,
      type: 'danger',
      icon: '⚠',
      text: overdue.length + ' project(s) overdue.',
      action: isPrivileged() ? { label: 'Review & Extend', handler: openOverdueProjectsModal } : null
    });
  }

  if (isPrivileged()) {
    const pendingReqs = archiveRequests.filter(r => r.status === 'PENDING').length;
    if (pendingReqs > 0) notices.push({ id: dayKey + ':archive-reqs-' + pendingReqs, type: 'warning', icon: '📥', text: pendingReqs + ' archive request(s) awaiting review.' });
    const pendingSubmissions = assignments.filter(a => a.status === 'SUBMITTED' && !a.archived).length;
    if (pendingSubmissions > 0) notices.push({ id: dayKey + ':submissions-' + pendingSubmissions, type: 'info', icon: '📤', text: pendingSubmissions + ' task submission(s) awaiting review.' });
  }

  const myAssignments = assignments.filter(a =>
    !a.archived && a.status === 'PENDING' && isUserAssigned(a.assignee, currentUser.name)
  ).length;
  if (myAssignments > 0) notices.push({ id: dayKey + ':my-assignments-' + myAssignments, type: 'info', icon: '🔔', text: myAssignments + ' task(s) assigned to you.' });

  const visible = notices.filter(n => !dismissedNoticeIds.includes(n.id));
  container.innerHTML = visible.map((n, i) =>
    '<div class="notice-bar notice-' + n.type + '">' +
      '<span class="notice-icon">' + n.icon + '</span>' +
      '<span class="notice-text">' + esc(n.text) + '</span>' +
      (n.action ? '<button class="notice-action-btn" data-notice-action="' + i + '" type="button">' + esc(n.action.label) + '</button>' : '') +
      '<button class="notice-dismiss-btn" type="button" data-notice-dismiss="' + i + '">✕</button>' +
    '</div>'
  ).join('');

  container.querySelectorAll('[data-notice-dismiss]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.noticeDismiss, 10);
      dismissNotice(visible[i].id);
    });
  });
  container.querySelectorAll('[data-notice-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.noticeAction, 10);
      const action = visible[i]?.action;
      if (action && typeof action.handler === 'function') action.handler();
    });
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
   SECTION 27: CONTROL TRAY + THEME
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
   SECTION 28: PUSH
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

/* ── Populate the single-select assignee picker on the Create New Project modal ── */
function populateNewProjectAssigneePicker() {
  const container = document.getElementById('newProjectAssigneeList');
  const searchInput = document.getElementById('newProjectAssigneeSearch');
  if (!container) return;

  const q = (searchInput?.value || '').trim().toLowerCase();
  const staffUsers = registeredUsersDB
    .filter(u => isAssignable(u.role))
    .filter(u => !q || u.name.toLowerCase().includes(q));

  if (staffUsers.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;grid-column:1/-1;">' +
      (q ? 'No members match "' + esc(q) + '".' : 'No members available.') + '</div>';
    return;
  }

  container.innerHTML = staffUsers.map(u => {
    const checked = newProjectAssignee === u.name ? ' checked' : '';
    return '<label style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem; border-radius:6px; cursor:pointer;">' +
      '<input type="radio" name="newProjectAssigneeRadio" value="' + esc(u.name) + '" data-new-project-assignee' + checked +
        ' style="width:18px; height:18px; accent-color:var(--accent-light); cursor:pointer;">' +
      '<div style="display:flex; align-items:center; gap:0.5rem; flex:1;">' +
        '<div class="staff-avatar-mini">' + esc(u.code || '??') + '</div>' +
        '<span style="font-weight:600; font-size:0.9rem;">' + esc(u.name) + '</span>' +
        '<span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">' + esc(u.role) + '</span>' +
      '</div>' +
    '</label>';
  }).join('');

  container.querySelectorAll('input[data-new-project-assignee]').forEach(rb => {
    rb.addEventListener('change', () => {
      if (rb.checked) newProjectAssignee = rb.value;
    });
  });
}

/* ── Populate the "Assigned To" select inside the Project Profile modal ── */
function populateProfileReporterSelect(currentReporter) {
  const sel = document.getElementById('profileAssignedReporter');
  if (!sel) return;

  const assignable = registeredUsersDB
    .filter(u => u.role === 'STAFF' || u.role === 'EDITOR' || u.role === 'ADMIN')
    .sort((a, b) => a.name.localeCompare(b.name));

  sel.innerHTML = '<option value="">— Unassigned —</option>';

  let found = false;
  assignable.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.name;
    opt.textContent = u.name + ' · ' + u.role;
    if (u.name === currentReporter) { opt.selected = true; found = true; }
    sel.appendChild(opt);
  });

  if (currentReporter && !found) {
    const opt = document.createElement('option');
    opt.value = currentReporter;
    opt.textContent = currentReporter + ' · (removed account)';
    opt.selected = true;
    sel.appendChild(opt);
  }
}

function initializeApp() {
  try {
    wipeLegacyCache();
    initSupabaseClient();
    initTheme();
    wireControlTray();

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
    document.getElementById('quickExportAllBtn')?.addEventListener('click', exportAllReportsCSV);

    /* ── Create New Project ────────────────────────────────────── */
    document.getElementById('createProjectBtn')?.addEventListener('click', async () => {
      const title = document.getElementById('newTitle').value.trim();
      const category = document.getElementById('newCategory').value;
      const deadline = document.getElementById('newDeadline').value || Utils.todayLocalISO();

      const reporter = newProjectAssignee || currentUser.name;

      if (!title) return;
      const payload = {
        title, category, deadline, status: 'ACTIVE', priority: 'MEDIUM',
        progress: 0, reporter, notes: '', tags: '', archived: false,
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
      newProjectAssignee = '';
      triggerNotificationToast('Project created.');
    });

    document.getElementById('saveUserBtn')?.addEventListener('click', createNewUser);

    document.addEventListener('click', (e) => {
      const beatBtn = e.target.closest('#addBeatBtn');
      if (beatBtn) { e.preventDefault(); e.stopPropagation(); openDeploymentModal(); return; }
      const asgBtn = e.target.closest('#addAssignmentBtn');
      if (asgBtn) { e.preventDefault(); e.stopPropagation(); openAssignmentModal(); return; }
    });

    document.addEventListener('input', (e) => {
      if (!e.target) return;
      if (e.target.id === 'reporterSearchInput') populateReporterCheckboxes();
      if (e.target.id === 'assigneeSearchInput') populateAssigneeCheckboxes();
      if (e.target.id === 'newProjectAssigneeSearch') populateNewProjectAssigneePicker();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target) return;
      if (e.target.id === 'reporterSearchInput') { e.preventDefault(); populateReporterCheckboxes(); }
      if (e.target.id === 'assigneeSearchInput') { e.preventDefault(); populateAssigneeCheckboxes(); }
      if (e.target.id === 'newProjectAssigneeSearch') { e.preventDefault(); populateNewProjectAssigneePicker(); }
    });
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-search-trigger]');
      if (!btn) return;
      const which = btn.dataset.searchTrigger;
      if (which === 'reporter') populateReporterCheckboxes();
      if (which === 'assignee') populateAssigneeCheckboxes();
      if (which === 'newProjectAssignee') populateNewProjectAssigneePicker();
    });

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

    const modalOpeners = [
      ['fabBtn', 'newProjectModal'],
      ['addCalendarProjectBtn', 'newProjectModal'],
      ['addEventBtn', 'addEventModal'],
      ['addUserBtn', 'addUserModal'],
      ['quickAddProjectBtn', 'newProjectModal']
    ];
    modalOpeners.forEach(([btnId, modalId]) => {
      document.getElementById(btnId)?.addEventListener('click', () => {
        if (modalId === 'newProjectModal') {
          newProjectAssignee = currentUser ? currentUser.name : '';
          const s = document.getElementById('newProjectAssigneeSearch');
          if (s) s.value = '';
          populateNewProjectAssigneePicker();
        }
        document.getElementById(modalId)?.classList.add('active');
      });
    });

    /* ── New Field Operation ──────────────────────────────────── */
    document.getElementById('saveBeatBtn')?.addEventListener('click', async () => {
      const title = document.getElementById('beatName').value.trim();
      const priority = document.getElementById('beatPriority').value;
      const location = document.getElementById('beatLocation').value.trim();
      const description = document.getElementById('beatDescription').value.trim();
      const selected = Array.from(document.querySelectorAll('#reporterCheckboxList input[type="checkbox"]:checked')).map(cb => cb.value);
      if (!title) { triggerNotificationToast('Operation title is required.'); return; }
      if (selected.length === 0) { triggerNotificationToast('Select at least one member.'); return; }

      const reporterString = selected.join(', ');

      const venueName   = document.getElementById('beatVenueName')?.value.trim() || '';
      const venueLatRaw = document.getElementById('beatVenueLat')?.value.trim() || '';
      const venueLonRaw = document.getElementById('beatVenueLon')?.value.trim() || '';
      const venueR      = parseInt(document.getElementById('beatVenueRadius')?.value, 10) || 150;
      const venueLat    = venueLatRaw ? parseFloat(venueLatRaw) : null;
      const venueLon    = venueLonRaw ? parseFloat(venueLonRaw) : null;
      const hasVenue    = isFinite(venueLat) && isFinite(venueLon);

      const payload = {
        title, description, location, reporter: reporterString, priority,
        status: 'ACTIVE', image_data: '', created_by: currentUser.name, archived: false,
        venue_name: hasVenue ? (venueName || title) : null,
        venue_lat: hasVenue ? venueLat : null,
        venue_lon: hasVenue ? venueLon : null,
        venue_radius: hasVenue ? venueR : 150
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
        venue_name: payload.venue_name, venue_lat: payload.venue_lat,
        venue_lon: payload.venue_lon, venue_radius: payload.venue_radius,
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
      reporterSelection.clear();
      const rSearch = document.getElementById('reporterSearchInput');
      if (rSearch) rSearch.value = '';
      ['beatVenueName','beatVenueLat','beatVenueLon'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      const rEl = document.getElementById('beatVenueRadius'); if (rEl) rEl.value = '150';
      triggerNotificationToast('✓ Deployed. Notified ' + selected.length + ' member(s).');
    });

    /* ── Use my location → capture venue ──────────────────────── */
    document.getElementById('captureVenueBtn')?.addEventListener('click', () => {
      if (!navigator.geolocation) { triggerNotificationToast('Geolocation not supported.'); return; }
      const btn = document.getElementById('captureVenueBtn');
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = '⏳ Locating…';
      navigator.geolocation.getCurrentPosition((pos) => {
        document.getElementById('beatVenueLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('beatVenueLon').value = pos.coords.longitude.toFixed(6);
        if (!document.getElementById('beatVenueName').value.trim()) {
          reverseGeocodeLabel(pos.coords.latitude, pos.coords.longitude)
            .then(label => {
              const el = document.getElementById('beatVenueName');
              if (el && !el.value.trim()) el.value = label;
            });
        }
        btn.disabled = false; btn.textContent = orig;
        triggerNotificationToast('✓ Venue location captured.');
      }, () => {
        btn.disabled = false; btn.textContent = orig;
        triggerNotificationToast('Location access denied.');
      }, { enableHighAccuracy: true, timeout: 12000 });
    });

    document.getElementById('saveAssignmentBtn')?.addEventListener('click', async () => {
      const title = document.getElementById('asgTitle').value.trim();
      const selectedBoxes = Array.from(document.querySelectorAll('#assigneeRadioList input[type="checkbox"]:checked')).map(cb => cb.value);
      if (!title) { triggerNotificationToast('Task description is required.'); return; }
      if (selectedBoxes.length === 0) { triggerNotificationToast('Please select at least one assignee.'); return; }

      const assigneeString = selectedBoxes.join(', ');
      const payload = {
        title, assignee: assigneeString, description: '', priority: 'MEDIUM', due_date: null,
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
      await logAudit('create_assignment', 'assignment', payload.id, title,
        'Assigned to ' + selectedBoxes.length + ' member(s): ' + assigneeString);
      for (const person of selectedBoxes) {
        await dispatchPing(currentUser.name, person, '🔔 New task assigned to you: "' + title + '"');
      }
      flushCachedCollections();
      generateAssignmentsGrid();
      document.getElementById('addAssignmentModal').classList.remove('active');
      document.getElementById('asgTitle').value = '';
      assigneeSelection.clear();
      const aSearch = document.getElementById('assigneeSearchInput');
      if (aSearch) aSearch.value = '';
      triggerNotificationToast('✓ Task created for ' + selectedBoxes.length + ' member(s).');
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

    console.log('✅ Sentinel JCompass initialized (v7.3)');
  } catch (err) {
    console.error('❌ JCompass initializeApp error:', err);
    console.error(err && err.stack);
  }
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
    const sess = getActiveAttendanceSession();
    if (sess) { ensureSpotScheduleForSession(sess); startSpotCheckScheduler(); }
  } catch (e) { console.warn('Catch-up sync failed:', e); }
});

window.generateDashboardStats = generateDashboardStats;
window.generateProjectDashboard = generateProjectDashboard;
window.generateAnnouncementsStream = generateAnnouncementsStream;
window.rebuildApplicationDOMViews = rebuildApplicationDOMViews;

window.JC = window.JC || {};
window.JC.getAnnouncements = () => announcements.slice();