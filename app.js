/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  JOURNALIST'S COMPASS v5.0                                          ║
 * ║  Calendar Popup · Work Assigned · Project Submissions · Radio Lists ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 1: CONFIG
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://odqfqaywzwvxkvqptzxo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6CWGOKOIj4aXmRpidG6dVA_nYvcctoP';
const SESSION_KEY = 'jcompass_session';

const CACHE_VERSION = 'v5';
const CACHE_PREFIX  = 'jcompass_' + CACHE_VERSION + '_';

let supabaseClient = null;
let realtimePingsChannel = null;
let realtimeAttendanceChannel = null;
let realtimeArchiveChannel = null;
let realtimeAssignmentsChannel = null;

function initSupabaseClient() {
  if (typeof window.supabase === 'undefined') {
    console.error('JCompass: Supabase library not loaded.');
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('JCompass: Supabase client initialized.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 2: CACHE
// ═══════════════════════════════════════════════════════════════════════

function wipeLegacyCache() {
  const keep = ['jcompass_session', 'jcompass_theme'];
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('jcompass_')) continue;
    if (keep.includes(key) || key.startsWith(CACHE_PREFIX)) continue;
    toRemove.push(key);
  }
  toRemove.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
}

const CACHE_KEYS = {
  projects:         CACHE_PREFIX + 'projects',
  assignments:      CACHE_PREFIX + 'assignments',
  deployments:      CACHE_PREFIX + 'deployments',
  events:           CACHE_PREFIX + 'events',
  announcements:    CACHE_PREFIX + 'announcements',
  attendance:       CACHE_PREFIX + 'attendance',
  sources:          CACHE_PREFIX + 'sources',
  archiveRequests:  CACHE_PREFIX + 'archive_requests',
  auditLog:         CACHE_PREFIX + 'audit_log',
  dismissedNotices: 'jcompass_dismissed_notices'
};

function cacheLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const p = JSON.parse(raw);
    return (p === null || p === undefined) ? fallback : p;
  } catch (err) {
    try { localStorage.removeItem(key); } catch (e) {}
    return fallback;
  }
}

function cacheSave(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (err) { console.warn('Cache write failed for "' + key + '".', err); }
}

function cacheClearAll() {
  Object.values(CACHE_KEYS).forEach(k => {
    if (k === 'jcompass_dismissed_notices') return;
    try { localStorage.removeItem(k); } catch (e) {}
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 3: STATE
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
let auditSearchQuery = '';
let activeProfileId = null;
let activeDeploymentId = null;
let activeSubmissionId = null;

let projects          = [];
let assignments       = [];
let deployments       = [];
let events            = [];
let announcements     = [];
let attendanceLogs    = [];
let sources           = [];
let archiveRequests   = [];
let registeredUsersDB = [];
let archivedReports   = [];
let activitySummaries = [];
let auditLog          = [];
let dismissedNoticeIds = cacheLoad(CACHE_KEYS.dismissedNotices, []);

function flushCachedCollections() {
  cacheSave(CACHE_KEYS.projects, projects);
  cacheSave(CACHE_KEYS.assignments, assignments);
  cacheSave(CACHE_KEYS.deployments, deployments);
  cacheSave(CACHE_KEYS.events, events);
  cacheSave(CACHE_KEYS.announcements, announcements);
  cacheSave(CACHE_KEYS.attendance, attendanceLogs);
  cacheSave(CACHE_KEYS.sources, sources);
  cacheSave(CACHE_KEYS.archiveRequests, archiveRequests);
  cacheSave(CACHE_KEYS.auditLog, auditLog);
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 4: AUDIT LOG HELPER
// ═══════════════════════════════════════════════════════════════════════

async function logAudit(action, targetType, targetId, targetName, details) {
  if (!currentUser) return;
  const entry = {
    actor: currentUser.name,
    action: action,
    target_type: targetType,
    target_id: String(targetId || ''),
    target_name: targetName || '',
    details: details || ''
  };

  if (supabaseClient) {
    try { await supabaseClient.from('audit_log').insert(entry); }
    catch (err) { console.warn('Audit log write failed:', err); }
  }

  auditLog.unshift({
    id: 'local-' + Date.now(),
    actor: entry.actor,
    action: entry.action,
    target_type: entry.target_type,
    target_id: entry.target_id,
    target_name: entry.target_name,
    details: entry.details,
    created_at: new Date().toISOString()
  });

  cacheSave(CACHE_KEYS.auditLog, auditLog);
  renderAuditLogTable();
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 5: SUPABASE SYNC
// ═══════════════════════════════════════════════════════════════════════

async function syncAllDataFromSupabase() {
  if (!supabaseClient) {
    console.error('JCompass: cannot sync.');
    return;
  }
  console.log('🔄 Syncing...');

  // Projects (with submission fields)
  try {
    const { data, error } = await supabaseClient.from('projects').select('*').order('id', { ascending: true });
    if (error) throw error;
    projects = (data || []).map(p => ({
      id: p.id, title: p.title, category: p.category, deadline: p.deadline,
      status: p.status, priority: p.priority, progress: p.progress,
      reporter: p.reporter || '', notes: p.notes || '', tags: p.tags || '',
      archived: p.archived || false, created_at: p.created_at,
      submission_text: p.submission_text || '',
      submission_file: p.submission_file || '',
      submitted_by: p.submitted_by || '',
      submitted_at: p.submitted_at || null
    }));
    console.log('   ✓ Projects:', projects.length);
  } catch (err) { console.error('Sync projects failed:', err); }

  // Deployments
  try {
    const { data, error } = await supabaseClient.from('deployments').select('*').order('id', { ascending: true });
    if (error) throw error;
    deployments = (data || []).map(d => ({
      id: d.id, title: d.title, description: d.description || '',
      location: d.location || '', reporter: d.reporter || '',
      priority: d.priority || 'MEDIUM', status: d.status || 'ACTIVE',
      imageData: d.image_data || '', createdBy: d.created_by || '',
      archived: d.archived || false, created_at: d.created_at
    }));
    console.log('   ✓ Deployments:', deployments.length);
  } catch (err) { console.error('Sync deployments failed:', err); }

  // Assignments
  try {
    const { data, error } = await supabaseClient.from('assignments').select('*').order('id', { ascending: false });
    if (error) throw error;
    assignments = (data || []).map(a => ({
      id: a.id, title: a.title, assignee: a.assignee || '',
      description: a.description || '', priority: a.priority || 'MEDIUM',
      due_date: a.due_date || '', created_by: a.created_by || '',
      status: a.status || 'PENDING',
      submission_text: a.submission_text || '',
      submission_file: a.submission_file || '',
      submitted_by: a.submitted_by || '',
      submitted_at: a.submitted_at || null,
      reviewed_by: a.reviewed_by || '',
      reviewed_at: a.reviewed_at || null,
      review_notes: a.review_notes || '',
      archived: a.archived || false, created_at: a.created_at
    }));
    console.log('   ✓ Tasks:', assignments.length);
  } catch (err) { console.error('Sync assignments failed:', err); }

  // Events
  try {
    const { data, error } = await supabaseClient.from('events').select('*').order('id', { ascending: true });
    if (error) throw error;
    events = (data || []).map(e => ({
      id: e.id, name: e.name, date: e.date,
      completed: e.completed || false, archived: e.archived || false
    }));
    console.log('   ✓ Events:', events.length);
  } catch (err) { console.error('Sync events failed:', err); }

  // Contacts
  try {
    const { data, error } = await supabaseClient.from('sources').select('*').order('id', { ascending: true });
    if (error) throw error;
    sources = (data || []).map(s => ({
      id: s.id, name: s.name, beat: s.beat || '', contact: s.contact || '',
      reliability: s.reliability || 'MEDIUM', notes: s.notes || '',
      createdBy: s.created_by || 'Unknown'
    }));
    console.log('   ✓ Contacts:', sources.length);
  } catch (err) { console.error('Sync sources failed:', err); }

  // Archive requests
  try {
    const { data, error } = await supabaseClient.from('archive_requests').select('*').order('id', { ascending: true });
    if (error) throw error;
    archiveRequests = (data || []).map(r => ({
      id: r.id, project_id: r.project_id, project_title: r.project_title || '',
      requester: r.requester, request_timestamp: r.request_timestamp || '',
      status: r.status || 'PENDING'
    }));
    console.log('   ✓ Archive Requests:', archiveRequests.length);
  } catch (err) { console.error('Sync archive_requests failed:', err); }

  // Audit log
  try {
    const { data, error } = await supabaseClient.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    auditLog = (data || []).map(a => ({
      id: a.id, actor: a.actor, action: a.action,
      target_type: a.target_type || '', target_id: a.target_id || '',
      target_name: a.target_name || '', details: a.details || '',
      created_at: a.created_at
    }));
    console.log('   ✓ Activity Log:', auditLog.length);
  } catch (err) { console.error('Sync audit_log failed:', err); }

  // Users
  try {
    const { data, error } = await supabaseClient.rpc('list_users');
    if (error) throw error;
    registeredUsersDB = (data || []).map(u => ({
      id: u.id, name: u.name, role: u.role, code: u.code,
      created: u.created_at
        ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—'
    }));
    console.log('   ✓ Users:', registeredUsersDB.length);
  } catch (err) { console.error('Sync users failed:', err); registeredUsersDB = []; }

  // Attendance
  try {
    const { data, error } = await supabaseClient.from('attendance').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    attendanceLogs = (data || []).map(row => ({
      id: 'remote-' + row.id, reporter: row.reporter, role: row.role,
      date: row.date, time: row.time, lat: row.lat, lon: row.lon,
      accuracy: row.accuracy, location: row.location, note: row.note || '',
      timestamp: row.timestamp_iso
    }));
    console.log('   ✓ Attendance:', attendanceLogs.length);
  } catch (err) { console.error('Sync attendance failed:', err); }

  // Pings
  try {
    const { data, error } = await supabaseClient.from('pings').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    announcements = (data || []).map(row => ({
      id: 'remote-' + row.id, sender: row.sender, target: row.target,
      text: row.message,
      timestamp: new Date(row.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      })
    }));
    console.log('   ✓ Messages:', announcements.length);
  } catch (err) { console.error('Sync pings failed:', err); }

  flushCachedCollections();
  console.log('✅ Sync complete.');
}

async function subscribeRealtime() {
  if (!supabaseClient) return;

  if (realtimePingsChannel) supabaseClient.removeChannel(realtimePingsChannel);
  realtimePingsChannel = supabaseClient.channel('pings-rt')
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
  realtimeAttendanceChannel = supabaseClient.channel('attendance-rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, (payload) => {
      const row = payload.new;
      const id = 'remote-' + row.id;
      if (attendanceLogs.some(a => a.id === id)) return;
      attendanceLogs.unshift({
        id, reporter: row.reporter, role: row.role,
        date: row.date, time: row.time, lat: row.lat, lon: row.lon,
        accuracy: row.accuracy, location: row.location, note: row.note || '',
        timestamp: row.timestamp_iso
      });
      flushCachedCollections();
      renderAttendanceTable();
      updateAttendanceStats();
    })
    .subscribe();

  if (realtimeArchiveChannel) supabaseClient.removeChannel(realtimeArchiveChannel);
  realtimeArchiveChannel = supabaseClient.channel('archive-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'archive_requests' }, async () => {
      try {
        const { data } = await supabaseClient.from('archive_requests').select('*').order('id', { ascending: true });
        archiveRequests = (data || []).map(r => ({
          id: r.id, project_id: r.project_id,
          project_title: r.project_title || '', requester: r.requester,
          request_timestamp: r.request_timestamp || '', status: r.status || 'PENDING'
        }));
        flushCachedCollections();
        renderArchiveRequestsPanel();
      } catch (e) {}
    })
    .subscribe();

  if (realtimeAssignmentsChannel) supabaseClient.removeChannel(realtimeAssignmentsChannel);
  realtimeAssignmentsChannel = supabaseClient.channel('assignments-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, async () => {
      try {
        const { data } = await supabaseClient.from('assignments').select('*').order('id', { ascending: false });
        assignments = (data || []).map(a => ({
          id: a.id, title: a.title, assignee: a.assignee || '',
          description: a.description || '', priority: a.priority || 'MEDIUM',
          due_date: a.due_date || '', created_by: a.created_by || '',
          status: a.status || 'PENDING',
          submission_text: a.submission_text || '',
          submission_file: a.submission_file || '',
          submitted_by: a.submitted_by || '',
          submitted_at: a.submitted_at || null,
          reviewed_by: a.reviewed_by || '',
          reviewed_at: a.reviewed_at || null,
          review_notes: a.review_notes || '',
          archived: a.archived || false, created_at: a.created_at
        }));
        flushCachedCollections();
        generateAssignmentsGrid();
      } catch (e) {}
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
    label.textContent = 'You will get device popups for new messages.';
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

  const title = isBroadcastAll ? 'JCompass — Announcement' : 'JCompass — Direct Message';
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
    triggerNotificationToast('Failed: ' + err.message);
    return;
  }

  if (typeof sendPushNotification === 'function') {
    if (target === 'ALL') {
      sendPushNotification('📰 Announcement', sender + ': ' + text);
    } else {
      sendPushNotification('📌 Message from ' + sender, text, target);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 7: SESSION
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
    pingSelect.innerHTML = '<option value="ALL">Send to All</option>';
    registeredUsersDB.forEach(u => {
      if (u.role === 'STAFF') {
        pingSelect.innerHTML += '<option value="' + u.name + '">Message: ' + u.name + '</option>';
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

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 9: DASHBOARD STATS + PROJECTS
// ═══════════════════════════════════════════════════════════════════════

function generateDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const active = projects.filter(p => !p.archived);
  const overdue = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    return new Date(p.deadline) < today;
  });
  const dueSoon = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    const d = new Date(p.deadline);
    const diff = Math.ceil((d - today) / 86400000);
    return diff >= 0 && diff <= 3;
  });
  const staffCount = registeredUsersDB.filter(u => u.role === 'STAFF').length;
  const todayStr = today.toLocaleDateString('en-CA');
  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr).length;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };
  set('statActiveProjects', active.length);
  set('statOverdue', overdue.length);
  set('statDueSoon', dueSoon.length);
  set('statStaffCount', staffCount);
  set('statTodayCheckins', todayCheckins);
}

function formatCreatedBy(item) {
  if (!item) return '';
  const name = item.creator || item.createdBy || item.created_by || '';
  if (!name) return '';
  const date = item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return '<div class="card-creator-footer">👤 Created by <b>' + name + '</b>' + (date ? ' • ' + date : '') + '</div>';
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
      '<div class="card-actions"><button class="card-action-btn profile-btn" data-id="' + p.id + '">📋 View Details</button></div>' +
      formatCreatedBy({ creator: p.reporter, created_at: p.created_at });
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

  document.querySelectorAll('.priority-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === (p.priority || 'MEDIUM'));
  });

  // Output submission section
  const subInfo = document.getElementById('profileSubmissionInfo');
  const subBtn = document.getElementById('profileSubmitOutputBtn');
  if (subInfo && subBtn) {
    if (p.submitted_by) {
      subInfo.innerHTML =
        '<div style="color:#9ae6b4; font-weight:600;">✓ Submitted by ' + p.submitted_by + '</div>' +
        '<div style="font-size:0.78rem; color:var(--text-muted); margin-top:0.25rem;">' + (p.submitted_at ? new Date(p.submitted_at).toLocaleString('en-US') : '—') + '</div>' +
        (p.submission_text ? '<div style="margin-top:0.5rem; background:rgba(0,0,0,0.2); padding:0.6rem; border-radius:6px; white-space:pre-line; font-size:0.82rem;">' + p.submission_text + '</div>' : '') +
        (p.submission_file ? '<div style="margin-top:0.5rem;"><a href="' + p.submission_file + '" download="output" class="btn btn-ghost" style="font-size:0.78rem; text-decoration:none;">⬇ Download Attachment</a></div>' : '');
      subBtn.innerText = '🔄 Update Output';
    } else {
      subInfo.textContent = 'No output submitted yet.';
      subBtn.innerText = '📤 Submit Output';
    }

    const isAssigned = p.reporter && p.reporter.toLowerCase() === currentUser.name.toLowerCase();
    const isAdmin = currentUser.role === 'ADMIN';
    if (isAssigned || isAdmin) {
      subBtn.style.display = '';
      subBtn.onclick = () => openProjectSubmissionModal(p.id);
    } else {
      subBtn.style.display = 'none';
    }
  }

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
    triggerNotificationToast('Admin access required.');
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
        .from('projects').update(updates).eq('id', p.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) {
      console.error('Update project failed:', err);
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  Object.assign(p, updates);
  await logAudit('update_project', 'project', p.id, p.title,
    'Progress: ' + updates.progress + '%, Status: ' + updates.status);

  flushCachedCollections();
  rebuildApplicationDOMViews();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('✓ Project saved.');
}

async function archiveProject(projectId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin access required.');
    return;
  }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;

  if (!confirm('Archive "' + p.title + '"?')) return;

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('projects').update({ archived: true }).eq('id', projectId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) {
      triggerNotificationToast('Archive failed: ' + err.message);
      return;
    }
  }

  p.archived = true;
  await logAudit('archive_project', 'project', p.id, p.title, 'Moved to archive');
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Project archived.');
}

async function deleteProject(projectId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin access required.');
    return;
  }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;

  if (!confirm('Permanently delete "' + p.title + '"?')) return;

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('projects').delete().eq('id', projectId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Delete blocked.');
    } catch (err) {
      triggerNotificationToast('Delete failed: ' + err.message);
      return;
    }
  }

  projects = projects.filter(x => x.id !== projectId);
  await logAudit('delete_project', 'project', projectId, p.title, 'Permanently deleted');
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Project deleted.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 10: PROJECT OUTPUT SUBMISSION
// ═══════════════════════════════════════════════════════════════════════

function openProjectSubmissionModal(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  activeProfileId = projectId;

  document.getElementById('projectSubModalCategory').innerText = 'PROJECT OUTPUT · ' + (p.category || '');
  document.getElementById('projectSubModalTitle').innerText = p.title;

  const body = document.getElementById('projectSubModalBody');
  const footer = document.getElementById('projectSubModalFooter');

  body.innerHTML =
    '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Project</span><div style="margin-top:0.25rem;font-size:0.95rem;">' + p.title + '</div></div>' +
    '<div><label class="form-label">Your Output / Report</label><textarea class="form-input" id="projectSubText" rows="6" placeholder="Describe the output of your work on this project..." style="font-family:var(--font-body); resize:vertical;">' + (p.submission_text || '') + '</textarea></div>' +
    '<div><label class="form-label">Attach File (optional)</label><input type="file" id="projectSubFile" class="form-input" style="padding:0.5rem;" accept=".pdf,.doc,.docx,.txt,.jpg,.png,.zip"></div>' +
    '<div style="font-size:0.75rem;color:var(--text-muted);">Submitting as <b>' + currentUser.name + '</b></div>';

  footer.innerHTML =
    '<button class="btn btn-ghost" data-close="projectSubmissionModal">Cancel</button>' +
    '<button class="btn btn-primary" id="projectSubConfirmBtn">📤 Submit Output</button>';

  document.getElementById('projectSubConfirmBtn').onclick = () => submitProjectOutput(projectId);

  document.getElementById('projectSubmissionModal').classList.add('active');
}

async function submitProjectOutput(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;

  const text = document.getElementById('projectSubText').value.trim();
  const fileInput = document.getElementById('projectSubFile');

  if (!text && (!fileInput || !fileInput.files[0])) {
    triggerNotificationToast('Please provide output or attach a file.');
    return;
  }

  let fileData = null;
  if (fileInput && fileInput.files[0]) {
    const file = fileInput.files[0];
    if (file.size > 5 * 1024 * 1024) { triggerNotificationToast('File too large (max 5 MB).'); return; }
    fileData = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  const updates = {
    submission_text: text,
    submission_file: fileData || p.submission_file || null,
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

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 11: ARCHIVE REQUESTS
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
  await logAudit('request_archive', 'project', projectId, p.title, 'Archive requested');
  flushCachedCollections();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('✓ Archive request submitted.');
}

async function approveArchiveRequest(requestId) {
  if (currentUser.role !== 'ADMIN') return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  if (!confirm('Approve this request?')) return;

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
  await logAudit('approve_archive', 'project', req.project_id, req.project_title,
    'Requested by ' + req.requester);

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

  panel.querySelectorAll('[data-req-approve]').forEach(btn =>
    btn.addEventListener('click', () => approveArchiveRequest(parseInt(btn.dataset.reqApprove))));
  panel.querySelectorAll('[data-req-deny]').forEach(btn =>
    btn.addEventListener('click', () => denyArchiveRequest(parseInt(btn.dataset.reqDeny))));
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 12: ANNOUNCEMENTS
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
      '<div class="announcement-meta"><span class="announcement-badge-alert">' + (isBroadcastAll ? 'ANNOUNCEMENT' : 'DIRECT MESSAGE') + '</span><span>From <b>' + ann.sender + '</b></span><span>•</span><span>' + ann.timestamp + '</span></div>' +
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
  if (!confirm('Delete this message?')) return;

  if (String(annId).startsWith('remote-') && supabaseClient) {
    const remoteId = parseInt(String(annId).replace('remote-', ''), 10);
    try {
      const { error } = await supabaseClient.from('pings').delete().eq('id', remoteId);
      if (error) throw error;
    } catch (err) {
      triggerNotificationToast('Failed to delete.');
      return;
    }
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
      '<div class="staff-info-block"><div class="staff-avatar-mini">' + user.code + '</div><div class="staff-details"><span class="staff-row-name">' + user.name + '</span><span class="staff-row-role">' + user.role + '</span></div></div>';
    container.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 13: FIELD OPERATIONS
// ═══════════════════════════════════════════════════════════════════════

function generateDeploymentsGrid() {
  const container = document.getElementById('beatsGrid');
  if (!container) return;
  container.innerHTML = '';

  const visible = deployments.filter(d => !d.archived);
  const isAdmin = currentUser && currentUser.role === 'ADMIN';

  if (visible.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text-muted);">No field operations yet. Click "+ New Field Operation" to send someone out.</div>';
    return;
  }

  visible.forEach(d => {
    const reporters = (d.reporter || '').split(',').map(r => r.trim()).filter(r => r);
    const card = document.createElement('div');
    card.className = 'card card-interactive';
    card.innerHTML =
      '<span class="priority-flag priority-' + d.priority + '">' + d.priority + '</span>' +
      '<div class="card-category">FIELD OPERATION</div>' +
      '<div class="card-title">' + d.title + '</div>' +
      (d.location ? '<div style="font-size:0.82rem;color:var(--text-muted);">📍 ' + d.location + '</div>' : '') +
      '<div style="font-size:0.85rem;color:var(--text-muted);">👥 ' + reporters.length + ' member(s): <b>' + reporters.join(', ') + '</b></div>' +
      (d.description ? '<div style="font-size:0.8rem;color:var(--text-muted); white-space:pre-line; line-height:1.5;">' + d.description.substring(0, 120) + (d.description.length > 120 ? '…' : '') + '</div>' : '') +
      '<div class="card-actions"><button class="card-action-btn deployment-view-btn" data-deployment-id="' + d.id + '">📡 View Details</button></div>' +
      (isAdmin ? '<div class="card-action-row"><button class="card-action-btn archive-btn" data-deployment-archive="' + d.id + '">🗄 Archive</button></div>' : '') +
      formatCreatedBy({ creator: d.createdBy, created_at: d.created_at });
    container.appendChild(card);
  });

  container.querySelectorAll('[data-deployment-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeploymentProfile(parseInt(btn.dataset.deploymentId));
    });
  });

  container.querySelectorAll('[data-deployment-archive]').forEach(btn => {
    btn.addEventListener('click', () => archiveDeployment(parseInt(btn.dataset.deploymentArchive)));
  });
}

function populateReporterCheckboxes() {
  const container = document.getElementById('reporterCheckboxList');
  if (!container) return;

  const staffUsers = registeredUsersDB.filter(u => u.role === 'STAFF' || u.role === 'ADMIN');

  if (staffUsers.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No members available. Create accounts first.</div>';
    return;
  }

  container.innerHTML = staffUsers.map(u =>
    '<label style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem; border-radius:6px; cursor:pointer;">' +
      '<input type="checkbox" value="' + u.name + '" style="width:18px; height:18px; accent-color:var(--accent-light); cursor:pointer;">' +
      '<div style="display:flex; align-items:center; gap:0.5rem; flex:1;">' +
        '<div class="staff-avatar-mini">' + (u.code || '??') + '</div>' +
        '<span style="font-weight:600; font-size:0.9rem;">' + u.name + '</span>' +
        '<span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">' + u.role + '</span>' +
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
  const isAdmin = currentUser.role === 'ADMIN';
  const reporters = (d.reporter || '').split(',').map(r => r.trim()).filter(r => r);

  document.getElementById('deploymentModalCategory').innerText = 'FIELD OPERATION · ' + d.priority;
  document.getElementById('deploymentModalTitle').innerText = d.title;

  const body = document.getElementById('deploymentModalBody');
  body.innerHTML =
    (d.location ? '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">📍 Location</span><div style="margin-top:0.25rem; font-size:0.95rem;">' + d.location + '</div></div>' : '') +
    '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">👥 Assigned Members (' + reporters.length + ')</span>' +
      '<div style="margin-top:0.5rem; display:flex; flex-wrap:wrap; gap:0.5rem;">' +
        reporters.map(r => '<span style="background:rgba(76,110,73,0.25); border:1px solid rgba(76,110,73,0.5); color:#9ae6b4; padding:0.35rem 0.75rem; border-radius:20px; font-size:0.82rem; font-weight:600;">' + r + '</span>').join('') +
      '</div>' +
    '</div>' +
    '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">📅 Created</span><div style="margin-top:0.25rem; font-size:0.9rem;">' + (d.created_at ? new Date(d.created_at).toLocaleString('en-US') : '—') + '</div></div>' +
    (d.description ? '<div><span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">📝 Instructions</span><div style="margin-top:0.4rem; font-size:0.9rem; white-space:pre-line; line-height:1.6; background:rgba(0,0,0,0.2); padding:0.75rem; border-radius:6px;">' + d.description + '</div></div>' : '') +
    '<div style="font-size:0.75rem; color:var(--text-muted);">Created by <b>' + (d.createdBy || 'Admin') + '</b></div>';

  const actions = document.getElementById('deploymentModalActions');
  actions.innerHTML =
    (isAdmin ? '<button class="btn btn-ghost" id="pingDeployBtn" style="color:var(--accent-light);">🔔 Notify All</button>' : '') +
    (isAdmin ? '<button class="btn btn-ghost" id="archiveDeployBtn" style="color:var(--warning);">🗄 Archive</button>' : '');

  if (isAdmin) {
    const pingBtn = document.getElementById('pingDeployBtn');
    if (pingBtn) pingBtn.addEventListener('click', async () => {
      if (reporters.length === 0) { triggerNotificationToast('No members assigned.'); return; }
      for (const r of reporters) {
        await dispatchPing(currentUser.name, r,
          '📡 Update on "' + d.title + '" — ' + (d.location || 'Location TBD'));
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
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin access required.');
    return;
  }
  const d = deployments.find(x => x.id === deploymentId);
  if (!d) { triggerNotificationToast('Operation not found.'); return; }

  if (!confirm('Archive this operation?')) return;

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('deployments').update({ archived: true }).eq('id', deploymentId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) {
      triggerNotificationToast('Archive failed: ' + err.message);
      return;
    }
  }

  d.archived = true;
  await logAudit('archive_deployment', 'deployment', d.id, d.title,
    'Assigned members: ' + (d.reporter || '—'));
  flushCachedCollections();
  document.getElementById('deploymentProfileModal').classList.remove('active');
  generateDeploymentsGrid();
  triggerNotificationToast('✓ Operation archived.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 14: ASSIGNED TASKS
// ═══════════════════════════════════════════════════════════════════════

function generateAssignmentsGrid() {
  const container = document.getElementById('assignmentsGrid');
  if (!container) return;
  container.innerHTML = '';

  const visible = assignments.filter(a => !a.archived);
  const isAdmin = currentUser && currentUser.role === 'ADMIN';

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
    const canSubmit = isAssignee || isAdmin;

    let actionBtn = '';
    if (canSubmit) {
      if (a.status === 'PENDING') {
        actionBtn = '<button class="card-action-btn" data-submit-id="' + a.id + '" style="background:rgba(76,110,73,0.3); color:#9ae6b4; border-color:rgba(76,110,73,0.6);">📤 Submit Work</button>';
      } else {
        actionBtn = '<button class="card-action-btn" data-submit-id="' + a.id + '">👁 View Submission</button>';
      }
    }

    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">' +
        '<div class="card-title" style="font-size:1.05rem;flex:1;">' + a.title + '</div>' +
        statusBadge +
      '</div>' +
      (a.description ? '<div style="font-size:0.82rem;color:var(--text-muted); white-space:pre-line; line-height:1.5;">' + a.description + '</div>' : '') +
      '<div style="font-size:0.85rem;color:var(--text-muted);">👤 Assigned to: <b>' + (a.assignee || '—') + '</b></div>' +
      (a.due_date ? '<div style="font-size:0.8rem;color:var(--text-muted);">📅 Due: ' + a.due_date + '</div>' : '') +
      (a.submitted_by ? '<div style="font-size:0.78rem; color:#9ae6b4;">📎 Submitted by ' + a.submitted_by + ' on ' + (a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '—') + '</div>' : '') +
      (actionBtn ? '<div class="card-action-row">' + actionBtn + '</div>' : '') +
      (isAdmin && a.status !== 'ARCHIVED' ? '<div class="card-action-row"><button class="card-action-btn archive-btn" data-asg-archive="' + a.id + '">🗄 Archive</button></div>' : '') +
      formatCreatedBy({ creator: a.created_by, created_at: a.created_at });
    container.appendChild(card);
  });

  container.querySelectorAll('[data-submit-id]').forEach(btn => {
    btn.addEventListener('click', () => openSubmissionModal(parseInt(btn.dataset.submitId)));
  });

  container.querySelectorAll('[data-asg-archive]').forEach(btn => {
    btn.addEventListener('click', () => archiveAssignment(parseInt(btn.dataset.asgArchive)));
  });
}

function populateAssigneeRadios() {
  const container = document.getElementById('assigneeRadioList');
  if (!container) return;

  const staffUsers = registeredUsersDB.filter(u => u.role === 'STAFF' || u.role === 'ADMIN');

  if (staffUsers.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No members available. Create accounts first.</div>';
    return;
  }

  container.innerHTML = staffUsers.map((u, idx) =>
    '<label style="display:flex; align-items:center; gap:0.75rem; padding:0.5rem; border-radius:6px; cursor:pointer;">' +
      '<input type="radio" name="assignee" value="' + u.name + '" ' + (idx === 0 ? 'checked' : '') + ' style="width:18px; height:18px; accent-color:var(--accent-light); cursor:pointer;">' +
      '<div style="display:flex; align-items:center; gap:0.5rem; flex:1;">' +
        '<div class="staff-avatar-mini">' + (u.code || '??') + '</div>' +
        '<span style="font-weight:600; font-size:0.9rem;">' + u.name + '</span>' +
        '<span style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">' + u.role + '</span>' +
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
  const isAdmin = currentUser.role === 'ADMIN';
  const canSubmit = (isAssignee || isAdmin) && a.status === 'PENDING';
  const canReview = isAdmin && a.status === 'SUBMITTED';

  document.getElementById('submissionModalCategory').innerText = 'TASK · ' + (a.priority || 'MEDIUM');
  document.getElementById('submissionModalTitle').innerText = a.title;

  const body = document.getElementById('submissionModalBody');
  const footer = document.getElementById('submissionModalFooter');

  if (canSubmit) {
    body.innerHTML =
      (a.description ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Description</span><div style="margin-top:0.25rem;font-size:0.9rem;white-space:pre-line;line-height:1.5;">' + a.description + '</div></div>' : '') +
      '<div><label class="form-label">Your Work / Report</label><textarea class="form-input" id="submissionText" rows="6" placeholder="Describe your progress, findings, or next steps..." style="font-family:var(--font-body); resize:vertical;"></textarea></div>' +
      '<div><label class="form-label">Attach File (optional)</label><input type="file" id="submissionFile" class="form-input" style="padding:0.5rem;" accept=".pdf,.doc,.docx,.txt,.jpg,.png,.zip"></div>' +
      '<div style="font-size:0.75rem;color:var(--text-muted);">Submitting as <b>' + currentUser.name + '</b></div>';
    footer.innerHTML =
      '<button class="btn btn-ghost" data-close="assignmentSubmissionModal">Cancel</button>' +
      '<button class="btn btn-primary" id="confirmSubmitBtn">📤 Submit Task</button>';

    document.getElementById('confirmSubmitBtn').addEventListener('click', submitAssignment);
  } else {
    body.innerHTML =
      '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Submitted By</span><div style="margin-top:0.25rem;font-size:0.95rem;">' + (a.submitted_by || '—') + '</div></div>' +
      '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Submitted At</span><div style="margin-top:0.25rem;font-size:0.9rem;">' + (a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—') + '</div></div>' +
      '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Work Submitted</span><div style="margin-top:0.4rem;font-size:0.9rem;white-space:pre-line;line-height:1.6;background:rgba(0,0,0,0.2);padding:0.75rem;border-radius:6px;">' + (a.submission_text || 'No text submitted.') + '</div></div>' +
      (a.submission_file ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Attached File</span><div style="margin-top:0.4rem;"><a href="' + a.submission_file + '" download="submission" class="btn btn-ghost" style="font-size:0.8rem;text-decoration:none;">⬇ Download Attachment</a></div></div>' : '') +
      (a.review_notes ? '<div><span style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Admin Review</span><div style="margin-top:0.4rem;font-size:0.85rem;">' + a.review_notes + '</div></div>' : '');

    let footerHtml = '<button class="btn btn-ghost" data-close="assignmentSubmissionModal">Close</button>';
    if (canReview) {
      footerHtml = '<button class="btn btn-ghost" id="rejectSubmissionBtn" style="color:var(--warning);">↩ Send Back</button>' +
                   '<button class="btn btn-primary" id="approveSubmissionBtn">✓ Approve</button>';
    }
    footer.innerHTML = footerHtml;

    if (canReview) {
      document.getElementById('approveSubmissionBtn').addEventListener('click', () => reviewSubmission(true));
      document.getElementById('rejectSubmissionBtn').addEventListener('click', () => reviewSubmission(false));
    }
  }

  document.getElementById('assignmentSubmissionModal').classList.add('active');
}

async function submitAssignment() {
  const a = assignments.find(x => x.id === activeSubmissionId);
  if (!a) return;

  const text = document.getElementById('submissionText').value.trim();
  const fileInput = document.getElementById('submissionFile');

  if (!text && (!fileInput || !fileInput.files[0])) {
    triggerNotificationToast('Please provide work or attach a file.');
    return;
  }

  let fileData = '';
  if (fileInput && fileInput.files[0]) {
    const file = fileInput.files[0];
    if (file.size > 5 * 1024 * 1024) {
      triggerNotificationToast('File too large (max 5 MB).');
      return;
    }
    fileData = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  const updates = {
    submission_text: text,
    submission_file: fileData || null,
    submitted_by: currentUser.name,
    submitted_at: new Date().toISOString(),
    status: 'SUBMITTED'
  };

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('assignments').update(updates).eq('id', a.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  Object.assign(a, updates);
  await logAudit('submit_task', 'assignment', a.id, a.title, 'Submitted by ' + currentUser.name);
  await dispatchPing(currentUser.name, a.created_by || 'ALL',
    '📤 ' + currentUser.name + ' submitted: "' + a.title + '"');

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
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  Object.assign(a, updates);
  await logAudit(approved ? 'approve_submission' : 'reject_submission',
    'assignment', a.id, a.title, approved ? 'Approved' : 'Returned');
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
      const { data, error } = await supabaseClient
        .from('assignments').update({ archived: true }).eq('id', asgId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Update blocked.');
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  a.archived = true;
  await logAudit('archive_assignment', 'assignment', a.id, a.title, 'Archived');
  flushCachedCollections();
  generateAssignmentsGrid();
  triggerNotificationToast('Task archived.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 15: EVENTS + CALENDAR
// ═══════════════════════════════════════════════════════════════════════

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

    const dayProjects = projects.filter(p => p.deadline === dateStr && !p.archived);
    const dayTasks = assignments.filter(a => a.due_date === dateStr && !a.archived);
    const dayEvents = events.filter(e => e.date === dateStr && !e.archived);
    const totalItems = dayProjects.length + dayTasks.length + dayEvents.length;

    if (totalItems > 0) cell.classList.add('has-tasks');

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

  let html = '';

  if (dayProjects.length === 0 && dayTasks.length === 0 && dayEvents.length === 0) {
    body.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:2rem;">No items scheduled on this date.</div>';
    document.getElementById('calendarDayModal').classList.add('active');
    return;
  }

  dayProjects.forEach(p => {
    html += '<div class="cal-day-item">' +
      '<div class="cal-item-title">📋 ' + p.title + '</div>' +
      '<div class="cal-item-meta">' +
        '<span>📁 Project</span>' +
        '<span>Status: <b>' + (p.status || 'ACTIVE') + '</b></span>' +
        '<span>Priority: <b>' + (p.priority || 'MEDIUM') + '</b></span>' +
      '</div>' +
      (p.reporter ? '<div class="cal-item-meta"><span>👤 Assigned to <b>' + p.reporter + '</b></span></div>' : '') +
      (p.notes ? '<div class="cal-item-notes">' + p.notes + '</div>' : '') +
    '</div>';
  });

  dayTasks.forEach(t => {
    html += '<div class="cal-day-item" style="border-left-color:#8b5cf6;">' +
      '<div class="cal-item-title">🔔 ' + t.title + '</div>' +
      '<div class="cal-item-meta">' +
        '<span>👤 Task</span>' +
        '<span>Assignee: <b>' + (t.assignee || '—') + '</b></span>' +
        '<span>Status: <b>' + (t.status || 'PENDING') + '</b></span>' +
      '</div>' +
      (t.description ? '<div class="cal-item-notes">' + t.description + '</div>' : '') +
    '</div>';
  });

  dayEvents.forEach(e => {
    html += '<div class="cal-day-item" style="border-left-color:#fbd38d;">' +
      '<div class="cal-item-title">📌 ' + e.name + '</div>' +
      '<div class="cal-item-meta"><span>Event' + (e.completed ? ' • ✅ Completed' : '') + '</span></div>' +
    '</div>';
  });

  body.innerHTML = html;
  document.getElementById('calendarDayModal').classList.add('active');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 16: ATTENDANCE + GEO MAP
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
      '<td style="padding:0.75rem 1rem;"><button class="card-action-btn" data-map-idx="' + idx + '" style="padding:0.25rem 0.5rem; font-size:0.85rem;">🗺️</button></td>';
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-map-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.mapIdx);
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
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">NAME</span><div style="font-weight:700;">' + log.reporter + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">DATE & TIME</span><div style="font-weight:600;">' + log.date + ' · ' + log.time + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">LOCATION</span><div style="font-weight:600;">' + (log.location || '—') + '</div></div>' +
      '<div><span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;">ACCURACY</span><div style="font-weight:600;">±' + log.accuracy + 'm</div></div>' +
    '</div>' +
    (log.note ? '<div style="margin-top:0.5rem; font-size:0.82rem; color:var(--text-muted);">📝 ' + log.note + '</div>' : '');

  const lat = parseFloat(log.lat);
  const lon = parseFloat(log.lon);
  const bbox = (lon - 0.008) + ',' + (lat - 0.008) + ',' + (lon + 0.008) + ',' + (lat + 0.008);
  const embedUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox +
                   '&layer=mapnik&marker=' + lat + ',' + lon;

  document.getElementById('geoMapIframe').src = embedUrl;

  const gmUrl = 'https://www.google.com/maps?q=' + lat + ',' + lon;
  document.getElementById('geoMapOpenBtn').href = gmUrl;

  document.getElementById('geoMapModal').classList.add('active');
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
    btn.innerText = '📍 Check In Now';
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
        btn.innerText = '📍 Check In Now';
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
    btn.innerText = '📍 Check In Now';
    triggerNotificationToast('Location access denied.');
  }, { enableHighAccuracy: true, timeout: 12000 });
}

function initAttendancePage() {
  startLiveClock();
  renderAttendanceTable();
  updateAttendanceStats();
  if (hasCheckedInToday()) {
    const btn = document.getElementById('markAttendanceBtn');
    if (btn) {
      btn.innerText = '✓ Checked In Today';
      btn.style.background = 'var(--success)';
    }
  }
}

async function clearAttendanceLog() {
  if (currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Admin access required.');
    return;
  }
  if (!confirm('Clear ALL attendance records?')) return;

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
  await logAudit('clear_attendance', 'attendance', '', 'All records', 'Wiped');
  flushCachedCollections();
  renderAttendanceTable();
  updateAttendanceStats();
  triggerNotificationToast('Attendance log cleared.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 17: ARCHIVE GRID
// ═══════════════════════════════════════════════════════════════════════

function generateArchiveGrid() {
  const container = document.getElementById('archiveGrid');
  const countBadge = document.getElementById('archiveCountBadge');
  if (!container) return;
  container.innerHTML = '';

  const archived = projects.filter(p => p.archived);
  if (countBadge) countBadge.innerText = archived.length + ' archived';

  const isAdmin = currentUser && currentUser.role === 'ADMIN';

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
      '<div class="card-meta"><span>📅 ' + (p.deadline || '—') + '</span><span>' + (p.status || '') + '</span></div>' +
      (isAdmin ? '<div class="card-action-row"><button class="card-action-btn restore-btn" data-archive-restore="' + p.id + '">↩ Restore</button><button class="card-action-btn delete-btn" data-archive-delete="' + p.id + '">🗑 Delete</button></div>' : '');
    container.appendChild(card);
  });

  container.querySelectorAll('[data-archive-restore]').forEach(btn =>
    btn.addEventListener('click', () => restoreArchivedProject(parseInt(btn.dataset.archiveRestore))));
  container.querySelectorAll('[data-archive-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteArchivedProject(parseInt(btn.dataset.archiveDelete))));
}

async function restoreArchivedProject(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  if (!confirm('Restore "' + p.title + '"?')) return;

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('projects').update({ archived: false }).eq('id', projectId);
      if (error) throw error;
    } catch (err) {
      triggerNotificationToast('Restore failed: ' + err.message);
      return;
    }
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
    } catch (err) {
      triggerNotificationToast('Delete failed: ' + err.message);
      return;
    }
  }

  projects = projects.filter(x => x.id !== projectId);
  await logAudit('delete_project', 'project', projectId, p.title, 'Deleted from archive');
  flushCachedCollections();
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Archived project deleted.');
}

async function clearAllArchivedProjects() {
  if (currentUser.role !== 'ADMIN') return;
  const archived = projects.filter(p => p.archived);
  if (archived.length === 0) { triggerNotificationToast('No archived projects.'); return; }
  if (!confirm('Delete ALL ' + archived.length + ' archived project(s)?')) return;
  if (!confirm('Absolutely sure?')) return;

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('projects').delete().eq('archived', true);
      if (error) throw error;
    } catch (err) {
      triggerNotificationToast('Backend error: ' + err.message);
      return;
    }
  }

  projects = projects.filter(p => !p.archived);
  await logAudit('clear_archive', 'project', '', 'All archived', archived.length + ' deleted');
  flushCachedCollections();
  rebuildApplicationDOMViews();
  triggerNotificationToast('✓ Archive cleared.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 18: ARCHIVED REPORTS
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
    card.innerHTML = '<div class="card-title">' + (r.title || 'Report') + '</div><div style="font-size:0.85rem;color:var(--text-muted);white-space:pre-line;line-height:1.5;">' + (r.summary || '') + '</div>';
    container.appendChild(card);
  });
}

async function clearArchivedReports() {
  if (currentUser.role !== 'ADMIN') return;
  if (archivedReports.length === 0) { triggerNotificationToast('No reports to clear.'); return; }
  if (!confirm('Clear all ' + archivedReports.length + ' reports?')) return;

  archivedReports = [];
  await logAudit('clear_reports', 'reports', '', 'All reports', 'Cleared');
  generateArchiveReportsGrid();
  triggerNotificationToast('✓ Reports cleared.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 19: ACTIVITY SUMMARY
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
    card.innerHTML = '<div class="card-title">' + (r.title || 'Summary') + '</div><div style="font-size:0.82rem;color:var(--text-muted);white-space:pre-line;line-height:1.6;">' + (r.summary || '') + '</div>';
    container.appendChild(card);
  });
}

async function clearActivitySummaries() {
  if (currentUser.role !== 'ADMIN') return;
  if (activitySummaries.length === 0) { triggerNotificationToast('No summaries.'); return; }
  if (!confirm('Clear all summaries?')) return;

  activitySummaries = [];
  await logAudit('clear_summaries', 'summaries', '', 'All activity summaries', 'Cleared');
  generateActivitySummaryGrid();
  triggerNotificationToast('✓ Summaries cleared.');
}

function generateActivitySummaryReport() {
  if (currentUser.role !== 'ADMIN') return;

  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = now.toLocaleDateString('en-CA');

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

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 20: WORK ASSIGNED (replaces "Sources")
// ═══════════════════════════════════════════════════════════════════════

function generateSourcesGrid() {
  const container = document.getElementById('sourcesGrid');
  if (!container) return;
  container.innerHTML = '';

  const teamMembers = registeredUsersDB.filter(u => u.role === 'STAFF' || u.role === 'ADMIN');

  const filtered = teamMembers.filter(u => {
    if (!sourceSearchQuery) return true;
    return u.name.toLowerCase().includes(sourceSearchQuery.toLowerCase());
  });

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
      ? memberProjects.map(p => '<div style="padding:0.4rem 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.82rem;">📋 <b>' + p.title + '</b> <span style="color:var(--text-muted);">(' + (p.status || 'ACTIVE') + ')</span></div>').join('')
      : '<div style="font-size:0.78rem; color:var(--text-muted);">— No projects</div>';

    const tasksHtml = memberTasks.length > 0
      ? memberTasks.map(t => '<div style="padding:0.4rem 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.82rem;">🔔 <b>' + t.title + '</b> <span style="color:var(--text-muted);">(' + (t.status || 'PENDING') + ')</span></div>').join('')
      : '<div style="font-size:0.78rem; color:var(--text-muted);">— No tasks</div>';

    const deploymentsHtml = memberDeployments.length > 0
      ? memberDeployments.map(d => '<div style="padding:0.4rem 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.82rem;">📡 <b>' + d.title + '</b> <span style="color:var(--text-muted);">(' + (d.location || 'Location TBD') + ')</span></div>').join('')
      : '<div style="font-size:0.78rem; color:var(--text-muted);">— No field ops</div>';

    const totalLoad = memberProjects.length + memberTasks.length + memberDeployments.length;

    card.innerHTML =
      '<div style="display:flex; align-items:center; gap:0.75rem;">' +
        '<div class="staff-avatar-mini" style="width:38px; height:38px; font-size:0.9rem;">' + (member.code || '??') + '</div>' +
        '<div style="flex:1;">' +
          '<div class="card-title" style="font-size:1.1rem; margin:0;">' + member.name + '</div>' +
          '<div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; font-weight:700;">' + member.role + ' • ' + totalLoad + ' active item(s)</div>' +
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

async function clearAllSources() {
  if (currentUser.role !== 'ADMIN') return;
  if (sources.length === 0) { triggerNotificationToast('No sources.'); return; }
  if (!confirm('Delete ALL ' + sources.length + ' contacts?')) return;
  if (!confirm('Absolutely sure?')) return;

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
  await logAudit('clear_sources', 'sources', '', 'Contact Vault', 'All cleared');
  flushCachedCollections();
  generateSourcesGrid();
  triggerNotificationToast('✓ Contact vault cleared.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 21: USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

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
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    tr.innerHTML =
      '<td style="padding:0.9rem 1.25rem;font-weight:800;">' + (user.code || '—') + '</td>' +
      '<td style="padding:0.9rem 1.25rem;font-weight:600;">' + user.name + '</td>' +
      '<td style="padding:0.9rem 1.25rem;">' + user.role + '</td>' +
      '<td style="padding:0.9rem 1.25rem;color:var(--text-muted);">' + (user.created || '—') + '</td>' +
      '<td style="padding:0.9rem 1.25rem;text-align:right;">' +
        (isSelf ? '<span style="color:var(--text-muted);font-size:0.72rem;">(You)</span>' : '<button class="user-row-delete-btn" data-uid="' + user.id + '" data-uname="' + user.name + '">🗑 Delete</button>') +
      '</td>';
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-uid]').forEach(btn =>
    btn.addEventListener('click', () => deleteUserFromAdmin(parseInt(btn.dataset.uid), btn.dataset.uname)));
}

async function createNewUser() {
  const name = document.getElementById('newUserName').value.trim();
  const pass = document.getElementById('newUserPass').value.trim();
  const role = document.getElementById('newUserRole').value;

  if (name.length < 2 || pass.length < 4) {
    triggerNotificationToast('Name too short or password < 4 chars.');
    return;
  }

  const parts = name.split(' ');
  const code = parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.substring(0, 2).toUpperCase();

  if (!supabaseClient) return;

  try {
    const { error } = await supabaseClient.rpc('create_user', {
      p_name: name, p_pass: pass, p_role: role, p_code: code
    });
    if (error) {
      triggerNotificationToast(error.message.toLowerCase().includes('duplicate')
        ? 'Username already exists.' : 'Error: ' + error.message);
      return;
    }
  } catch (err) {
    triggerNotificationToast('Failed to reach backend.');
    return;
  }

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
  if (currentUser && currentUser.name === userName) {
    triggerNotificationToast('Cannot delete yourself.');
    return;
  }
  if (!confirm('Permanently delete "' + userName + '"?')) return;
  if (!supabaseClient) return;

  try {
    const { error } = await supabaseClient.rpc('delete_user', { p_id: userId });
    if (error) throw error;
  } catch (err) {
    triggerNotificationToast('Delete failed: ' + err.message);
    return;
  }

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
//  SECTION 22: ACTIVITY LOG VIEW
// ═══════════════════════════════════════════════════════════════════════

function renderAuditLogTable() {
  const tbody = document.getElementById('auditLogTableBody');
  const badge = document.getElementById('auditCountBadge');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (badge) badge.innerText = auditLog.length + ' entries';

  const subset = auditLog.filter(e =>
    (e.actor || '').toLowerCase().includes(auditSearchQuery.toLowerCase()) ||
    (e.action || '').toLowerCase().includes(auditSearchQuery.toLowerCase()) ||
    (e.target_name || '').toLowerCase().includes(auditSearchQuery.toLowerCase()) ||
    (e.details || '').toLowerCase().includes(auditSearchQuery.toLowerCase())
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
        (e.created_at ? new Date(e.created_at).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '—') +
      '</td>' +
      '<td style="padding:0.75rem 1rem;font-weight:600;">' + (e.actor || '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;font-weight:700;color:' + color + ';font-size:0.75rem;text-transform:uppercase;letter-spacing:0.5px;">' +
        (e.action || '').replace(/_/g, ' ') +
      '</td>' +
      '<td style="padding:0.75rem 1rem;font-size:0.82rem;">' +
        (e.target_type ? '<span style="color:var(--text-muted);">' + e.target_type + ':</span> ' : '') +
        (e.target_name || '—') +
      '</td>' +
      '<td style="padding:0.75rem 1rem;font-size:0.78rem;color:var(--text-muted);">' + (e.details || '—') + '</td>';
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 23: CSV EXPORT
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
  if (visible.length === 0) { triggerNotificationToast('No projects to export.'); return; }

  const rows = [['ID','Title','Category','Deadline','Status','Priority','Progress','Reporter','Tags','Notes']];
  visible.forEach(p => rows.push([
    p.id, p.title, p.category, p.deadline, p.status, p.priority,
    (p.progress || 0) + '%', p.reporter || '', p.tags || '', p.notes || ''
  ]));

  downloadCSV('jcompass-projects-' + new Date().toISOString().split('T')[0] + '.csv', rows);
  triggerNotificationToast('Exported ' + visible.length + ' projects.');
}

function exportAttendanceCSV() {
  if (attendanceLogs.length === 0) { triggerNotificationToast('No attendance data.'); return; }

  const rows = [['Reporter','Role','Date','Time','Latitude','Longitude','Accuracy','Location','Note']];
  attendanceLogs.forEach(l => rows.push([
    l.reporter, l.role, l.date, l.time, l.lat, l.lon, l.accuracy, l.location, l.note || ''
  ]));

  downloadCSV('jcompass-attendance-' + new Date().toISOString().split('T')[0] + '.csv', rows);
  triggerNotificationToast('Exported ' + attendanceLogs.length + ' records.');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 24: NOTIFICATION BAR
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
      notices.push({ id: 'archive-reqs-' + pendingReqs, type: 'warning', icon: '📥', text: pendingReqs + ' archive request(s) awaiting review.' });
    }
    const pendingSubmissions = assignments.filter(a => a.status === 'SUBMITTED' && !a.archived).length;
    if (pendingSubmissions > 0) {
      notices.push({ id: 'submissions-' + pendingSubmissions, type: 'info', icon: '📤', text: pendingSubmissions + ' task submission(s) awaiting review.' });
    }
  }

  const myAssignments = assignments.filter(a =>
    !a.archived && a.status === 'PENDING' &&
    currentUser.name.toLowerCase() === (a.assignee || '').toLowerCase()
  ).length;
  if (myAssignments > 0) {
    notices.push({ id: 'my-assignments-' + myAssignments, type: 'info', icon: '🔔', text: myAssignments + ' task(s) assigned to you.' });
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
//  SECTION 25: INJECT ADMIN BUTTONS
// ═══════════════════════════════════════════════════════════════════════

function injectAdminClearButtons() {
  if (!currentUser || currentUser.role !== 'ADMIN') return;

  const arcBadge = document.getElementById('archiveCountBadge');
  if (arcBadge && !document.getElementById('clearArchivedProjectsBtn')) {
    const btn = document.createElement('button');
    btn.id = 'clearArchivedProjectsBtn';
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'font-size:0.75rem;color:var(--danger);border-color:rgba(229,62,62,0.3);white-space:nowrap;margin-right:0.5rem;';
    btn.textContent = '🗑 Clear Archive';
    btn.addEventListener('click', clearAllArchivedProjects);
    arcBadge.parentNode.insertBefore(btn, arcBadge);
  }

  const arcRepBadge = document.getElementById('archiveReportsCountBadge');
  if (arcRepBadge && !document.getElementById('clearArchiveReportsBtn')) {
    const btn = document.createElement('button');
    btn.id = 'clearArchiveReportsBtn';
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'font-size:0.75rem;color:var(--danger);border-color:rgba(229,62,62,0.3);white-space:nowrap;margin-right:0.5rem;';
    btn.textContent = '🗑 Clear Reports';
    btn.addEventListener('click', clearArchivedReports);
    arcRepBadge.parentNode.insertBefore(btn, arcRepBadge);
  }

  const actSumBadge = document.getElementById('activitySummaryCountBadge');
  if (actSumBadge && !document.getElementById('clearActivitySummariesBtn')) {
    const btn = document.createElement('button');
    btn.id = 'clearActivitySummariesBtn';
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'font-size:0.75rem;color:var(--danger);border-color:rgba(229,62,62,0.3);white-space:nowrap;margin-right:0.5rem;';
    btn.textContent = '🗑 Clear Summaries';
    btn.addEventListener('click', clearActivitySummaries);
    actSumBadge.parentNode.insertBefore(btn, actSumBadge);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 26: INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════

function initializeApp() {
  wipeLegacyCache();
  initSupabaseClient();

  // OneSignal native (Android only)
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
      const OneSignal = window.Capacitor.Plugins?.OneSignal || window.plugins?.OneSignal;
      if (OneSignal) {
        OneSignal.initialize("e76cbe01-1a76-4f3d-a45d-9d155a126093");
        OneSignal.Notifications.requestPermission(true)
          .then((accepted) => console.log('OneSignal permission granted:', accepted));
      }
    } catch (e) {
      console.warn('OneSignal init skipped:', e);
    }
  }

  const savedTheme = localStorage.getItem('jcompass_theme') || 'forest';
  document.body.setAttribute('data-theme-profile', savedTheme);

  enforceSessionGuard();

  // Navigation
  document.querySelectorAll('.nav-item').forEach(nav => {
    nav.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      nav.classList.add('active');
      const targetPage = nav.getAttribute('data-page');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const pageEl = document.getElementById('page-' + targetPage);
      if (pageEl) pageEl.classList.add('active');
      const breadcrumb = document.getElementById('breadcrumbCurrent');
      if (breadcrumb && nav.querySelector('.nav-label')) {
        breadcrumb.innerText = nav.querySelector('.nav-label').innerText;
      }
      if (targetPage === 'attend') initAttendancePage();
      if (targetPage === 'calendar') generateDeadlineCalendarGrid();
      if (targetPage === 'archive') renderArchiveRequestsPanel();
      if (targetPage === 'audit') renderAuditLogTable();
    });
  });

  // Sidebar
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

  // Sign out
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

  // Announcements
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

  // Attendance
  const attendanceBtn = document.getElementById('markAttendanceBtn');
  if (attendanceBtn) attendanceBtn.addEventListener('click', processFieldTelemetryMarking);

  const clearAttBtn = document.getElementById('clearAttendanceBtn');
  if (clearAttBtn) clearAttBtn.addEventListener('click', clearAttendanceLog);

  const exportAttBtn = document.getElementById('exportAttendanceBtn');
  if (exportAttBtn) exportAttBtn.addEventListener('click', exportAttendanceCSV);

  const exportProjBtn = document.getElementById('quickExportCSVBtn');
  if (exportProjBtn) exportProjBtn.addEventListener('click', exportProjectsCSV);

  // Create project
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
        reporter: currentUser.name,
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

      projects.push({ ...payload, created_at: new Date().toISOString() });
      await logAudit('create_project', 'project', payload.id, title,
        'Category: ' + category + ', Due: ' + deadline);

      flushCachedCollections();
      rebuildApplicationDOMViews();
      document.getElementById('newProjectModal').classList.remove('active');
      document.getElementById('newTitle').value = '';
      triggerNotificationToast('Project created.');
    });
  }

  // Save user
  const saveUserBtn = document.getElementById('saveUserBtn');
  if (saveUserBtn) saveUserBtn.addEventListener('click', createNewUser);

  // Notifications
  refreshNotificationPermissionUI();
  const notifyBtn = document.getElementById('enableNotificationsBtn');
  if (notifyBtn) notifyBtn.addEventListener('click', requestNotificationPermission);

  // Calendar nav
  const prevBtn = document.getElementById('calPrevMonth');
  const nextBtn = document.getElementById('calNextMonth');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    generateDeadlineCalendarGrid();
  });
  if (nextBtn) nextBtn.addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    generateDeadlineCalendarGrid();
  });

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter || 'ALL';
      generateProjectDashboard();
    });
  });

  // Search inputs
  const searchInput = document.getElementById('dashboardSearchInput');
  if (searchInput) searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    generateProjectDashboard();
  });

  const sourceSearch = document.getElementById('sourceSearchInput');
  if (sourceSearch) sourceSearch.addEventListener('input', (e) => {
    sourceSearchQuery = e.target.value;
    generateSourcesGrid();
  });

  const attSearch = document.getElementById('attendanceSearchInput');
  if (attSearch) attSearch.addEventListener('input', (e) => {
    attendanceSearchQuery = e.target.value;
    renderAttendanceTable();
  });

  const auditSearch = document.getElementById('auditSearchInput');
  if (auditSearch) auditSearch.addEventListener('input', (e) => {
    auditSearchQuery = e.target.value;
    renderAuditLogTable();
  });

  // Save profile
  const saveProfileBtn = document.getElementById('profileSaveBtn');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProjectProfile);

  // Project modal delegation
  const projectModal = document.getElementById('projectProfileModal');
  if (projectModal) {
    projectModal.addEventListener('click', async (e) => {
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

      if (archiveBtn) { e.preventDefault(); e.stopPropagation(); if (activeProfileId != null) await archiveProject(activeProfileId); }
      if (deleteBtn)  { e.preventDefault(); e.stopPropagation(); if (activeProfileId != null) await deleteProject(activeProfileId); }
      if (requestBtn) { e.preventDefault(); e.stopPropagation(); if (activeProfileId != null) await submitArchiveRequest(activeProfileId); }
    });
  }

  // Modal close
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = document.getElementById(btn.getAttribute('data-close'));
      if (m) m.classList.remove('active');
    });
  });

  // Special modal handlers
  const addBeatBtn = document.getElementById('addBeatBtn');
  if (addBeatBtn) addBeatBtn.addEventListener('click', openDeploymentModal);

  const addAssignmentBtn = document.getElementById('addAssignmentBtn');
  if (addAssignmentBtn) addAssignmentBtn.addEventListener('click', openAssignmentModal);

  const modalButtons = [
    { btnId: 'fabBtn', modalId: 'newProjectModal' },
    { btnId: 'addCalendarProjectBtn', modalId: 'newProjectModal' },
    { btnId: 'addEventBtn', modalId: 'addEventModal' },
    { btnId: 'addUserBtn', modalId: 'addUserModal' },
    { btnId: 'quickAddProjectBtn', modalId: 'newProjectModal' }
  ];

  modalButtons.forEach(({ btnId, modalId }) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.addEventListener('click', () => {
      const m = document.getElementById(modalId);
      if (m) m.classList.add('active');
    });
  });

  // Save deployment (multi-select)
  const saveBeatBtn = document.getElementById('saveBeatBtn');
  if (saveBeatBtn) {
    saveBeatBtn.addEventListener('click', async () => {
      const title = document.getElementById('beatName').value.trim();
      const priority = document.getElementById('beatPriority').value;
      const location = document.getElementById('beatLocation').value.trim();
      const description = document.getElementById('beatDescription').value.trim();

      const selected = Array.from(
        document.querySelectorAll('#reporterCheckboxList input[type="checkbox"]:checked')
      ).map(cb => cb.value);

      if (!title) {
        triggerNotificationToast('Operation title is required.');
        return;
      }
      if (selected.length === 0) {
        triggerNotificationToast('Select at least one member.');
        return;
      }

      const reporterString = selected.join(', ');

      const payload = {
        title, description, location,
        reporter: reporterString,
        priority, status: 'ACTIVE',
        image_data: '',
        created_by: currentUser.name,
        archived: false
      };

      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient.from('deployments').insert(payload).select().single();
          if (error) throw error;
          payload.id = data ? data.id : Date.now();
        } catch (err) {
          triggerNotificationToast('Backend error: ' + err.message);
          return;
        }
      } else { payload.id = Date.now(); }

      deployments.push({
        id: payload.id, title, description, location,
        reporter: reporterString, priority, status: 'ACTIVE',
        imageData: '', createdBy: currentUser.name,
        archived: false, created_at: new Date().toISOString()
      });

      await logAudit('create_deployment', 'deployment', payload.id, title,
        'Deployed ' + selected.length + ' member(s): ' + reporterString);

      for (const reporter of selected) {
        await dispatchPing(currentUser.name, reporter,
          '📡 You have been deployed: "' + title + '" at ' + (location || 'Location TBD'));
      }

      flushCachedCollections();
      generateDeploymentsGrid();

      document.getElementById('addBeatModal').classList.remove('active');
      document.getElementById('beatName').value = '';
      document.getElementById('beatLocation').value = '';
      document.getElementById('beatDescription').value = '';

      triggerNotificationToast('✓ Deployed. Notified ' + selected.length + ' member(s).');
    });
  }

  // Save assignment (radio-based assignee)
  const saveAssignmentBtn = document.getElementById('saveAssignmentBtn');
  if (saveAssignmentBtn) {
    saveAssignmentBtn.addEventListener('click', async () => {
      const title = document.getElementById('asgTitle').value.trim();

      // Read selected radio button
      const selectedRadio = document.querySelector('#assigneeRadioList input[name="assignee"]:checked');
      const assignee = selectedRadio ? selectedRadio.value : null;

      if (!title) {
        triggerNotificationToast('Task description is required.');
        return;
      }
      if (!assignee) {
        triggerNotificationToast('Please select an assignee.');
        return;
      }

      const payload = {
        title, assignee,
        description: '',
        priority: 'MEDIUM',
        due_date: null,
        created_by: currentUser.name,
        status: 'PENDING',
        archived: false
      };

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

      assignments.unshift({
        id: payload.id, ...payload,
        submission_text: '', submission_file: '',
        submitted_by: '', submitted_at: null,
        reviewed_by: '', reviewed_at: null, review_notes: '',
        created_at: new Date().toISOString()
      });

      await logAudit('create_assignment', 'assignment', payload.id, title,
        'Assigned to ' + assignee);

      if (assignee) {
        await dispatchPing(currentUser.name, assignee, '🔔 New task assigned to you: "' + title + '"');
      }

      flushCachedCollections();
      generateAssignmentsGrid();
      document.getElementById('addAssignmentModal').classList.remove('active');
      document.getElementById('asgTitle').value = '';
      triggerNotificationToast('✓ Task created for ' + assignee + '.');
    });
  }

  // Save event
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
      await logAudit('create_event', 'event', payload.id, name, 'Date: ' + date);
      flushCachedCollections();
      generateEventsTrackerChecklist();
      generateDeadlineCalendarGrid();
      document.getElementById('addEventModal').classList.remove('active');
      document.getElementById('evtName').value = '';
      triggerNotificationToast('Event added.');
    });
  }

  // Save name
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

  const genSummaryBtn = document.getElementById('generateActivitySummaryBtn');
  if (genSummaryBtn) genSummaryBtn.addEventListener('click', generateActivitySummaryReport);

  // Theme buttons
  document.querySelectorAll('.theme-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-chip-btn').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const theme = btn.getAttribute('data-theme');
      document.body.setAttribute('data-theme-profile', theme);
      localStorage.setItem('jcompass_theme', theme);
    });
  });

  console.log('✅ JCompass initialized (v5.0)');
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 27: CONTROL TRAY
// ═══════════════════════════════════════════════════════════════════════

(function wireControlTray() {
  function openTray() {
    const t = document.getElementById('controlTray');
    const o = document.getElementById('controlTrayOverlay');
    if (t) t.classList.add('active');
    if (o) o.classList.add('active');
  }
  function closeTray() {
    const t = document.getElementById('controlTray');
    const o = document.getElementById('controlTrayOverlay');
    if (t) t.classList.remove('active');
    if (o) o.classList.remove('active');
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
//  SECTION 28: ONESIGNAL
// ═══════════════════════════════════════════════════════════════════════

const ONESIGNAL_APP_ID = 'e76cbe01-1a76-4f3d-a45d-9d155a126093';
const ONESIGNAL_API_KEY = 'os_v2_app_45wl4ai2ozht3jc5tukvuetasocbd7a6dhwu2amqs23bpvmhaaeqpcgmitmhidymddsixetmj4uovgolydndk7lgmszycyc43sqhw4q';

async function sendPushNotification(title, message, targetUserName = null) {
  try {
    const data = {
      app_id: ONESIGNAL_APP_ID,
      contents: { en: message },
      headings: { en: title },
      priority: 10,
      data: { type: 'ping' }
    };
    if (targetUserName) {
      data.include_external_user_ids = [targetUserName];
    } else {
      data.included_segments = ['Subscribed Users'];
    }

    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Key ' + ONESIGNAL_API_KEY
      },
      body: JSON.stringify(data)
    });
    return await res.json();
  } catch (err) {
    console.error('Push failed:', err);
  }
}

async function setOneSignalUser(userName) {
  if (window.OneSignal) {
    try { await window.OneSignal.login(userName); } catch (err) {}
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 29: BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}