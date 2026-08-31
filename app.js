/**
 * Journalist's Compass v2.0 — Newsroom Operations Terminal
 * Full Supabase Integration for Pings & Attendance
 */

// ===================== SUPABASE CONFIGURATION =====================
const SUPABASE_URL = 'https://odqfqaywzwvxkvqptzxo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6CWGOKOIj4aXmRpidG6dVA_nYvcctoP';

let supabaseClient = null;
let realtimePingsChannel = null;
let realtimeAttendanceChannel = null;

function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY && typeof window.supabase !== 'undefined');
}

function initSupabaseClient() {
  if (!isSupabaseConfigured()) {
    console.info('JCompass: Supabase not configured — running in local-only mode.');
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('JCompass: Supabase client initialized.');
}

// ===================== SAFE STORAGE HELPERS =====================
function safeLoadJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed === null || parsed === undefined) ? fallback : parsed;
  } catch (err) {
    console.warn('JCompass: corrupted localStorage entry "' + key + '" — resetting to default.', err);
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    return fallback;
  }
}

function safeSaveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('JCompass: failed to save "' + key + '" to localStorage.', err);
    return false;
  }
}

// ===================== DATA STATE =====================
let currentUser = safeLoadJSON('jcompass_user', null);
let currentFilter = 'ALL';
let searchQuery = '';
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let sourceSearchQuery = '';
let attendanceSearchQuery = '';
let archiveSearchQuery = '';

let registeredUsersDB = safeLoadJSON('jcompass_accounts_db', [
  { name: 'Admin Account', pass: 'admin123', role: 'ADMIN', code: 'AA', created: 'Aug 11, 2026' },
  { name: 'Staff Reporter', pass: 'staff123', role: 'STAFF', code: 'SR', created: 'Aug 11, 2026' }
]);

let projects = safeLoadJSON('jcompass_projects', [
  { id: 101, title: 'Global Supply Route Friction Analytics', category: 'INVESTIGATIVE', deadline: '2026-08-12', status: 'ACTIVE', priority: 'HIGH', progress: 65, reporter: 'Staff Reporter', notes: 'Key source: Trade Ministry official. Follow up on embargo docs.', tags: 'exclusive,urgent', archived: false },
  { id: 102, title: 'Mayoral Campaign Expenditure Audits', category: 'BREAKING', deadline: '2026-08-20', status: 'IN REVIEW', priority: 'HIGH', progress: 80, reporter: 'Staff Reporter', notes: 'FEC filings cross-referenced. Awaiting legal review.', tags: 'follow-up', archived: false },
  { id: 103, title: 'Local Tech Ecosystem Multi-Tier Integration', category: 'FEATURES', deadline: '2026-08-28', status: 'FILED', priority: 'MEDIUM', progress: 100, reporter: '', notes: '', tags: '', archived: false }
]);

let assignments = safeLoadJSON('jcompass_assignments', [
  { id: 201, title: 'Interview Chief of Police regarding recent data breach anomalies', assignee: 'Staff Reporter' }
]);

let beats = safeLoadJSON('jcompass_beats', [
  { id: 301, name: 'City Hall Hallways Desk', reporter: 'Lead Editor', priority: 'HIGH', imgData: '' }
]);

let events = safeLoadJSON('jcompass_events', [
  { id: 401, name: 'Press Conference Security Briefing Room B', date: '2026-08-18', completed: false }
]);

let announcements = safeLoadJSON('jcompass_announcements', [
  { id: 501, sender: 'Admin Account', target: 'ALL', text: 'All field correspondents report telemetry logs before 1800 hours sync.', timestamp: 'Aug 11, 2026' }
]);

let archiveRequests = safeLoadJSON('jcompass_archive_requests', []);
let attendanceLogs = safeLoadJSON('jcompass_attendance', []);
let sources = safeLoadJSON('jcompass_sources', []);
let sourceRemovalRequests = safeLoadJSON('jcompass_source_removal_requests', []);
let archivedReports = safeLoadJSON('jcompass_archived_reports', []);
let activitySummaries = safeLoadJSON('jcompass_activity_summaries', []);
let dismissedNoticeIds = safeLoadJSON('jcompass_dismissed_notices', []);

// ===================== PERSISTENCE =====================
function flushStateToDisk() {
  safeSaveJSON('jcompass_accounts_db', registeredUsersDB);
  safeSaveJSON('jcompass_projects', projects);
  safeSaveJSON('jcompass_assignments', assignments);
  safeSaveJSON('jcompass_beats', beats);
  safeSaveJSON('jcompass_events', events);
  safeSaveJSON('jcompass_announcements', announcements);
  safeSaveJSON('jcompass_archive_requests', archiveRequests);
  safeSaveJSON('jcompass_attendance', attendanceLogs);
  safeSaveJSON('jcompass_sources', sources);
  safeSaveJSON('jcompass_archived_reports', archivedReports);
  safeSaveJSON('jcompass_activity_summaries', activitySummaries);
  safeSaveJSON('jcompass_source_removal_requests', sourceRemovalRequests);
}

// ===================== SUPABASE REALTIME PINGS =====================
async function syncRemotePings() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('pings')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    (data || []).forEach(row => mergeIncomingPing(row, false));
    rebuildApplicationDOMViews();
  } catch (err) {
    console.error('JCompass: failed to load pings from Supabase.', err);
  }

  if (realtimePingsChannel) {
    supabaseClient.removeChannel(realtimePingsChannel);
  }
  realtimePingsChannel = supabaseClient
    .channel('pings-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings' }, (payload) => {
      mergeIncomingPing(payload.new, true);
      flushStateToDisk();
      rebuildApplicationDOMViews();
    })
    .subscribe();
}

function mergeIncomingPing(row, isLive) {
  const localId = 'remote-' + row.id;
  if (announcements.some(a => a.id === localId)) return;
  const ann = {
    id: localId,
    sender: row.sender,
    target: row.target,
    text: row.message,
    timestamp: new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };
  announcements.push(ann);
  if (isLive) notifyIncomingPing(ann);
}

async function publishPingRemote(payload) {
  const { error } = await supabaseClient.from('pings').insert({
    sender: payload.sender,
    target: payload.target,
    message: payload.text
  });
  if (error) throw error;
}

// ===================== SUPABASE ATTENDANCE =====================
async function syncRemoteAttendance() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('attendance')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    (data || []).forEach(row => {
      const localId = 'remote-' + row.id;
      if (!attendanceLogs.some(a => a.id === localId)) {
        attendanceLogs.push({
          id: localId,
          reporter: row.reporter,
          role: row.role,
          date: row.date,
          time: row.time,
          lat: row.lat,
          lon: row.lon,
          accuracy: row.accuracy,
          location: row.location,
          note: row.note || '',
          timestamp: row.timestamp_iso
        });
      }
    });
    saveAttendanceLogs();
    renderAttendanceTable();
    updateAttendanceStats();
  } catch (err) {
    console.error('JCompass: failed to load attendance from Supabase.', err);
  }

  if (realtimeAttendanceChannel) {
    supabaseClient.removeChannel(realtimeAttendanceChannel);
  }
  realtimeAttendanceChannel = supabaseClient
    .channel('attendance-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, (payload) => {
      const row = payload.new;
      const localId = 'remote-' + row.id;
      if (!attendanceLogs.some(a => a.id === localId)) {
        attendanceLogs.unshift({
          id: localId,
          reporter: row.reporter,
          role: row.role,
          date: row.date,
          time: row.time,
          lat: row.lat,
          lon: row.lon,
          accuracy: row.accuracy,
          location: row.location,
          note: row.note || '',
          timestamp: row.timestamp_iso
        });
        saveAttendanceLogs();
        renderAttendanceTable();
        updateAttendanceStats();
      }
    })
    .subscribe();
}

async function publishAttendanceRemote(entry) {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient
      .from('attendance')
      .insert({
        reporter: entry.reporter,
        role: entry.role,
        date: entry.date,
        time: entry.time,
        lat: parseFloat(entry.lat),
        lon: parseFloat(entry.lon),
        accuracy: entry.accuracy,
        location: entry.location,
        note: entry.note || '',
        timestamp_iso: entry.timestamp
      });
    if (error) throw error;
  } catch (err) {
    console.error('JCompass: failed to publish attendance to Supabase.', err);
  }
}

// ===================== BROWSER NOTIFICATIONS =====================
function refreshNotificationPermissionUI() {
  const btn = document.getElementById('enableNotificationsBtn');
  const label = document.getElementById('notificationStatusLabel');
  if (!btn || !label || !('Notification' in window)) {
    if (label) label.textContent = 'Push alerts aren\u2019t supported in this browser.';
    if (btn) btn.style.display = 'none';
    return;
  }
  if (Notification.permission === 'granted') {
    btn.textContent = '🔔 Push Alerts Enabled';
    btn.disabled = true;
    label.textContent = 'You\u2019ll get a device popup for new pings while this tab is open in the background.';
  } else if (Notification.permission === 'denied') {
    btn.textContent = '🔕 Push Alerts Blocked';
    btn.disabled = true;
    label.textContent = 'Notifications are blocked in your browser/site settings. Re-enable them there to receive pings.';
  } else {
    btn.textContent = '🔔 Enable Push Alerts';
    btn.disabled = false;
    label.textContent = 'Not enabled yet — pings will only show inside the app.';
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
      body: body,
      icon: 'favicon.ico',
      tag: 'jcompass-ping-' + ann.id
    });
    n.onclick = () => { window.focus(); n.close(); };
  } else {
    triggerNotificationToast(body);
  }
}

// ===================== TASK-ASSIGNED / @MENTION PINGS =====================
function dispatchPing(sender, target, text) {
  const payload = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    sender: sender, target: target, text: text,
    timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };
  if (supabaseClient) {
    publishPingRemote(payload).catch(err => console.error('JCompass: failed to publish ping.', err));
  } else {
    announcements.push(payload);
    flushStateToDisk();
    generateAnnouncementsStream();
    notifyIncomingPing(payload);
  }
}

function scanAndNotifyMentions(text, contextLabel) {
  if (!text || !currentUser) return;
  const mentionRegex = /@([A-Za-z][\w'-]*(?:\s[A-Za-z][\w'-]*)?)/g;
  const alreadyNotified = new Set();
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const raw = match[1].trim().toLowerCase();
    const user = registeredUsersDB.find(u => u.name.toLowerCase() === raw || u.name.toLowerCase().startsWith(raw));
    if (user && user.name !== currentUser.name && !alreadyNotified.has(user.name)) {
      alreadyNotified.add(user.name);
      dispatchPing(currentUser.name, user.name, 'You were mentioned ' + contextLabel + ': "' + text.trim() + '"');
    }
  }
}

// ===================== AUTH & SESSION =====================
function enforceSessionGuard() {
  const gateOverlay = document.getElementById('authScreen');
  if (!gateOverlay) return;
  if (currentUser) {
    gateOverlay.style.display = 'none';
    document.body.setAttribute('data-user-clearance', currentUser.role);
    evaluateClearancePermissions();
    rebuildApplicationDOMViews();
    if (supabaseClient) {
      syncRemotePings();
      syncRemoteAttendance();
    }
  } else {
    gateOverlay.style.display = 'flex';
  }
}

function processCredentialsAuthentication() {
  const userBox = document.getElementById('username').value.trim();
  const passBox = document.getElementById('password').value.trim();
  const errorNode = document.getElementById('authError');
  const matchUser = registeredUsersDB.find(u => u.name.toLowerCase() === userBox.toLowerCase() && u.pass === passBox);
  if (matchUser) {
    currentUser = { name: matchUser.name, code: matchUser.code, role: matchUser.role };
    localStorage.setItem('jcompass_user', JSON.stringify(currentUser));
    if (errorNode) errorNode.style.display = 'none';
    enforceSessionGuard();
    triggerNotificationToast('Session authenticated: Welcome ' + currentUser.name);
  } else {
    if (errorNode) errorNode.style.display = 'block';
  }
}

function evaluateClearancePermissions() {
  if (!currentUser) return;
  const targetLabel = document.getElementById('displayName');
  const targetRole = document.getElementById('displayRole');
  const avatarBadge = document.getElementById('avatarBadgeIcon');
  const sidebarInput = document.getElementById('sidebarNameInput');
  if (targetLabel) targetLabel.innerText = currentUser.name;
  if (targetRole) targetRole.innerText = currentUser.role;
  if (avatarBadge) avatarBadge.innerText = currentUser.code;
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
  generateArchiveReportsGrid();
  generateActivitySummaryGrid();
  generateSourcesGrid();
  generateUsersTable();
  generateNotificationBar();
}

// ===================== NOTIFICATION BAR =====================
function dismissNotice(noticeId) {
  if (!dismissedNoticeIds.includes(noticeId)) {
    dismissedNoticeIds.push(noticeId);
    safeSaveJSON('jcompass_dismissed_notices', dismissedNoticeIds);
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
  const dueSoon = active.filter(p => {
    if (!p.deadline || p.status === 'FILED' || p.status === 'PUBLISHED') return false;
    const d = new Date(p.deadline);
    const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 3;
  });

  const notices = [];

  if (overdue.length > 0) {
    notices.push({
      id: 'overdue-' + overdue.length,
      type: 'danger',
      icon: '⚠',
      text: overdue.length + ' project' + (overdue.length > 1 ? 's are' : ' is') + ' overdue.',
      actionLabel: 'View Dashboard',
      actionPage: 'dashboard'
    });
  }
  if (dueSoon.length > 0) {
    notices.push({
      id: 'duesoon-' + dueSoon.length,
      type: 'warning',
      icon: '⏳',
      text: dueSoon.length + ' project' + (dueSoon.length > 1 ? 's are' : ' is') + ' due within 3 days.',
      actionLabel: 'View Dashboard',
      actionPage: 'dashboard'
    });
  }
  announcements.forEach(ann => {
    if (ann.target === currentUser.name) {
      notices.push({
        id: 'ann-' + ann.id,
        type: 'info',
        icon: '📌',
        text: 'Direct ping from ' + ann.sender + ': "' + ann.text + '"',
        actionLabel: null,
        actionPage: null
      });
    }
  });
  if (currentUser.role === 'ADMIN') {
    const pending = archiveRequests.filter(r => r.status === 'PENDING');
    if (pending.length > 0) {
      notices.push({
        id: 'archivereq-' + pending.length,
        type: 'info',
        icon: '🗄',
        text: pending.length + ' archive request' + (pending.length > 1 ? 's' : '') + ' awaiting review.',
        actionLabel: 'View Archive',
        actionPage: 'archive'
      });
    }
  }

  const visible = notices.filter(n => !dismissedNoticeIds.includes(n.id));
  container.innerHTML = visible.map(n =>
    '<div class="notice-bar notice-' + n.type + '" data-notice-id="' + n.id + '">' +
      '<span class="notice-icon">' + n.icon + '</span>' +
      '<span class="notice-text">' + n.text + '</span>' +
      '<div class="notice-actions">' +
      (n.actionLabel ? '<button class="notice-action-btn" data-page="' + n.actionPage + '">' + n.actionLabel + '</button>' : '') +
      '<button class="notice-dismiss-btn" title="Dismiss">✕</button>' +
      '</div>' +
    '</div>'
  ).join('');

  container.querySelectorAll('.notice-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bar = btn.closest('.notice-bar');
      dismissNotice(bar.dataset.noticeId);
    });
  });
  container.querySelectorAll('.notice-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPage = btn.dataset.page;
      const navItem = document.querySelector('.nav-item[data-page="' + targetPage + '"]');
      if (navItem) navItem.click();
    });
  });
}

// ===================== DASHBOARD STATS =====================
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

  const elActive = document.getElementById('statActiveProjects');
  const elOverdue = document.getElementById('statOverdue');
  const elSoon = document.getElementById('statDueSoon');
  const elStaff = document.getElementById('statStaffCount');
  const elCheckins = document.getElementById('statTodayCheckins');

  if (elActive) elActive.innerText = active.length;
  if (elOverdue) elOverdue.innerText = overdue.length;
  if (elSoon) elSoon.innerText = dueSoon.length;
  if (elStaff) elStaff.innerText = staffCount;
  if (elCheckins) elCheckins.innerText = todayCheckins;
}

// ===================== PROJECT DASHBOARD =====================
function getUrgencyLabel(deadline) {
  if (!deadline) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(deadline); due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return '<span class="urgency-overdue">⚠ ' + Math.abs(diff) + 'd overdue</span>';
  if (diff === 0) return '<span class="urgency-overdue">⚠ Due today</span>';
  if (diff <= 3) return '<span class="urgency-soon">⏳ ' + diff + 'd left</span>';
  return '<span class="urgency-ok">✓ ' + diff + 'd left</span>';
}

function generateProjectDashboard() {
  const container = document.getElementById('projectGrid');
  if (!container) return;
  container.innerHTML = '';
  const subset = projects.filter(item => {
    if (item.archived) return false;
    const matchesFilter = (currentFilter === 'ALL' || item.category === currentFilter);
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });
  const isAdmin = currentUser && currentUser.role === 'ADMIN';
  if (subset.length === 0) {
    container.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align:center; color: var(--text-muted);">No operational folders match criteria.</div>';
    return;
  }
  subset.forEach(p => {
    const nodeCard = document.createElement('div');
    nodeCard.className = 'card card-interactive';
    let statusClass = 'status-active';
    if (p.status === 'IN REVIEW') statusClass = 'status-review';
    if (p.status === 'FILED') statusClass = 'status-filed';
    if (p.status === 'ON HOLD') statusClass = 'status-on-hold';
    if (p.status === 'PUBLISHED') statusClass = 'status-published';
    const progress = p.progress || 0;
    const priorityColors = { HIGH: '#fc8181', MEDIUM: '#fbd38d', LOW: '#9ae6b4' };
    const priorityDot = p.priority ? '<span style="color:' + (priorityColors[p.priority] || 'var(--text-muted)') + '; font-size:0.7rem; font-weight:800;">● ' + p.priority + '</span>' : '';
    const tagsHtml = p.tags ? p.tags.split(',').filter(t => t.trim()).map(t => '<span class="card-tag">' + t.trim() + '</span>').join('') : '';
    const reporterHtml = p.reporter ?
      '<div class="card-reporter-chip"><div class="mini-avatar">' + p.reporter.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() + '</div><span>' + p.reporter + '</span></div>' : '';
    nodeCard.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:center;"><div class="card-category">' + p.category + '</div>' + priorityDot + '</div>' +
      '<div class="card-title">' + p.title + '</div>' +
      reporterHtml +
      (tagsHtml ? '<div class="card-tags">' + tagsHtml + '</div>' : '') +
      '<div><div class="card-progress-bar-wrap"><div class="card-progress-bar" style="width:' + progress + '%;"></div></div>' +
      '<div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.25rem; display:flex; justify-content:space-between;"><span>Progress</span><span>' + progress + '%</span></div></div>' +
      '<div class="card-meta"><span>📅 ' + p.deadline + '</span><div style="display:flex; align-items:center; gap:0.5rem;"><span style="font-size:0.75rem;">' + getUrgencyLabel(p.deadline) + '</span><span class="status-badge ' + statusClass + '">' + p.status + '</span></div></div>' +
      '<div class="card-actions">' +
      '<button class="card-action-btn profile-btn" data-id="' + p.id + '">📋 View Profile</button>' +
      (isAdmin ?
        '<button class="card-action-btn archive-btn" data-id="' + p.id + '">🗄 Archive</button><button class="card-action-btn delete-btn" data-id="' + p.id + '">🗑</button>' :
        (function() {
          const alreadyRequested = archiveRequests.some(r => r.projectId === p.id && r.status === 'PENDING' && r.requester === currentUser.name);
          return '<button class="card-action-btn request-archive-btn ' + (alreadyRequested ? 'req-pending' : '') + '" data-id="' + p.id + '" ' + (alreadyRequested ? 'disabled' : '') + '>' + (alreadyRequested ? '⏳ Pending' : '📤 Req. Archive') + '</button>';
        })()
      ) +
      '</div>';
    container.appendChild(nodeCard);
  });
  container.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openProjectProfile(parseInt(btn.dataset.id)); });
  });
  container.querySelectorAll('.archive-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); archiveProject(parseInt(btn.dataset.id)); });
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteProject(parseInt(btn.dataset.id)); });
  });
  container.querySelectorAll('.request-archive-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); requestArchiveProject(parseInt(btn.dataset.id)); });
  });
}

function generateAnnouncementsStream() {
  const container = document.getElementById('announcementsStreamContainer');
  if (!container) return;
  container.innerHTML = '';
  const historicalBroadcastData = [...announcements].reverse();
  historicalBroadcastData.forEach(ann => {
    const isPingedToMe = currentUser && ann.target === currentUser.name;
    const isBroadcastAll = ann.target === 'ALL';
    if (!isBroadcastAll && !isPingedToMe && currentUser.role !== 'ADMIN') return;
    const node = document.createElement('div');
    node.className = 'announcement-node ' + (isPingedToMe ? 'pinged' : '');
    let labelTag = isBroadcastAll ? 'NEWS FLASH' : 'DIRECT PING @' + ann.target.toUpperCase();
    node.innerHTML =
      '<div class="announcement-meta"><span class="announcement-badge-alert">' + labelTag + '</span><span>Issued by <b>' + ann.sender + '</b></span><span>•</span><span>' + ann.timestamp + '</span></div>' +
      '<div class="announcement-body">' + ann.text + '</div>';
    container.appendChild(node);
  });
  if (container.children.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding: 1rem; font-size:0.85rem;">No active security broadcast sheets filed.</div>';
  }
}

function generateStaffDirectory() {
  const container = document.getElementById('staffDirectoryList');
  if (!container) return;
  container.innerHTML = '';
  registeredUsersDB.forEach(user => {
    const row = document.createElement('div');
    row.className = 'staff-directory-row ' + (user.role === 'ADMIN' ? 'role-admin' : '');
    row.innerHTML =
      '<div class="staff-info-block"><div class="staff-avatar-mini">' + user.code + '</div><div class="staff-details"><span class="staff-row-name">' + user.name + '</span><span class="staff-row-role">' + user.role + '</span></div></div>' +
      (user.role === 'STAFF' ? '<button class="staff-action-link-btn" onclick="directRouteTaskTrigger(\'' + user.name + '\')">Assign Task</button>' : '');
    container.appendChild(row);
  });
}

// ===================== PROJECT PROFILE MODAL =====================
let activeProfileId = null;

function openProjectProfile(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  activeProfileId = projectId;
  const isAdmin = currentUser && currentUser.role === 'ADMIN';
  document.getElementById('profileModalCategory').innerText = p.category;
  document.getElementById('profileModalTitle').innerText = p.title;
  let statusClass = 'status-active';
  if (p.status === 'IN REVIEW') statusClass = 'status-review';
  if (p.status === 'FILED') statusClass = 'status-filed';
  if (p.status === 'ON HOLD') statusClass = 'status-on-hold';
  if (p.status === 'PUBLISHED') statusClass = 'status-published';
  const statusEl = document.getElementById('profileModalStatus');
  statusEl.innerText = p.status;
  statusEl.className = 'status-badge ' + statusClass;
  document.getElementById('profileModalDeadline').innerText = p.deadline || '—';
  document.getElementById('profileModalUrgency').innerHTML = getUrgencyLabel(p.deadline);
  const prog = p.progress || 0;
  document.getElementById('profileProgressBar').style.width = prog + '%';
  document.getElementById('profileProgressLabel').innerText = prog + '%';
  document.getElementById('profileProgressInput').value = prog;
  document.getElementById('profileAssignedReporter').value = p.reporter || '';
  document.getElementById('profileNotes').value = p.notes || '';
  document.getElementById('profileTags').value = p.tags || '';
  document.getElementById('profileStatusSelect').value = p.status || 'ACTIVE';
  document.querySelectorAll('.priority-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === (p.priority || 'MEDIUM'));
  });
  const editableInputs = ['profileProgressInput', 'profileAssignedReporter', 'profileNotes', 'profileTags', 'profileStatusSelect'];
  editableInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isAdmin;
  });
  document.querySelectorAll('.priority-select-btn').forEach(btn => btn.disabled = !isAdmin);
  const saveBtn = document.getElementById('profileSaveBtn');
  const delBtn = document.getElementById('profileDeleteBtn');
  const archBtn = document.getElementById('profileArchiveBtn');
  const reqBtn = document.getElementById('profileRequestArchiveBtn');
  if (saveBtn) saveBtn.style.display = isAdmin ? '' : 'none';
  if (delBtn) delBtn.style.display = isAdmin ? '' : 'none';
  if (archBtn) archBtn.style.display = isAdmin ? '' : 'none';
  if (reqBtn) {
    reqBtn.style.display = isAdmin ? 'none' : '';
    const alreadyRequested = archiveRequests.some(r => r.projectId === projectId && r.status === 'PENDING' && r.requester === currentUser.name);
    reqBtn.disabled = alreadyRequested;
    reqBtn.innerText = alreadyRequested ? '⏳ Request Pending...' : '📤 Request Archive';
  }
  const staffNotice = document.getElementById('profileStaffNotice');
  if (staffNotice) staffNotice.style.display = isAdmin ? 'none' : 'flex';
  document.getElementById('projectProfileModal').classList.add('active');
}

function saveProjectProfile() {
  const p = projects.find(x => x.id === activeProfileId);
  if (!p) return;
  p.progress = parseInt(document.getElementById('profileProgressInput').value) || 0;
  p.reporter = document.getElementById('profileAssignedReporter').value.trim();
  p.notes = document.getElementById('profileNotes').value.trim();
  p.tags = document.getElementById('profileTags').value.trim();
  p.status = document.getElementById('profileStatusSelect').value;
  const activeBtn = document.querySelector('.priority-select-btn.active');
  if (activeBtn) p.priority = activeBtn.dataset.priority;
  flushStateToDisk();
  rebuildApplicationDOMViews();
}