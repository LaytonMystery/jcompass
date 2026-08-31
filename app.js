/**
 * Journalist's Compass v2.0 — Newsroom Operations Terminal
 */

// ===================== SUPABASE REALTIME PINGS =====================
// Fill these in with your own Supabase project's values (Project Settings →
// API). The anon/public key is safe to expose in client code — it's meant
// to be used from the browser and is constrained by your RLS policies, not
// by secrecy. Leave SUPABASE_URL blank to run the app in local-only mode
// (pings stay on this device, same as before).
const SUPABASE_URL = 'https://odqfqaywzwvxkvqptzxo.supabase.co';        // e.g. 'https://xxxxxxxxxxxx.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_6CWGOKOIj4aXmRpidG6dVA_nYvcctoP';   // e.g. 'eyJhbGciOi...'

let supabaseClient = null;
let realtimePingsChannel = null;

// ===================== ATTENDANCE / DJANGO BACKEND =====================
// Where check-ins get posted so the whole newsroom shares one attendance
// log instead of each device only seeing its own localStorage copy.
const ATTENDANCE_API_URL = 'http://localhost:8000/api/attendance/';

function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY && typeof window.supabase !== 'undefined');
}

function initSupabaseClient() {
  if (!isSupabaseConfigured()) {
    console.info('JCompass: Supabase not configured — pings will stay local to this device/browser.');
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Pulls existing pings down from Supabase so a fresh login/device sees
// history that happened elsewhere, then opens a realtime channel so any
// NEW ping (from any device) lands here the moment it's sent.
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

// Converts a Supabase "pings" row into the app's existing announcement
// shape and adds it if it isn't already in memory (avoids duplicates when
// the initial fetch and a realtime event overlap).
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

// ===================== TASK-ASSIGNED / @MENTION PINGS =====================
// Fires a targeted ping through the same pipeline as manual broadcasts, so
// assignment and @mention alerts show up as real-time popups/toasts exactly
// like a direct ping does (native OS notification if the tab is backgrounded
// and permission was granted, in-app toast otherwise).
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

// Scans free text for "@Full Name" mentions against the registered staff
// directory and pings each matched person once. Used on assignment
// instructions and project notes.
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

// ===================== BROWSER / DEVICE POPUP NOTIFICATIONS =====================
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

// Called whenever a ping arrives in realtime. Shows a native OS/device
// notification popup if permission was granted and this tab is currently
// in the background (matches "someone pings me while I'm out of the app").
// If the tab is focused, a lighter in-app toast is used instead so the
// same ping doesn't announce itself twice.
function notifyIncomingPing(ann) {
  if (!currentUser) return;
  const isPingedToMe = ann.target === currentUser.name;
  const isBroadcastAll = ann.target === 'ALL';
  if (!isPingedToMe && !isBroadcastAll) return;
  if (ann.sender === currentUser.name) return; // don't notify yourself

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

// ===================== SAFE STORAGE HELPERS =====================
// A single malformed value in localStorage (partial write, quota overflow,
// manual edit during testing, etc.) used to throw a SyntaxError at the top
// of this file on every page load. Because that happened before
// DOMContentLoaded even registered, the login button's click handler never
// got attached — so after a refresh the auth screen would sit there and
// "Authenticate Session" would silently do nothing. safeLoadJSON() below
// catches that and falls back to the default instead of taking the whole
// script down with it.
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
let attendanceSearchQuery = '';
let archiveSearchQuery = '';

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

// ===================== AUTH & SESSION =====================
function enforceSessionGuard() {
  const gateOverlay = document.getElementById('authScreen');
  if (!gateOverlay) return;
  if (currentUser) {
    gateOverlay.style.display = 'none';
    document.body.setAttribute('data-user-clearance', currentUser.role);
    evaluateClearancePermissions();
    rebuildApplicationDOMViews();
    if (supabaseClient) syncRemotePings();
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
// Persistent, dismissible banners shown across every page (not just the
// dashboard) for things that need attention right now: overdue/due-soon
// projects, unread direct pings, and — for admins — pending archive
// requests. Count-based notices are keyed by their count (e.g. "overdue-3")
// so dismissing one only silences that specific count; if the number
// changes it resurfaces as a "new" notice. Direct pings are keyed by their
// announcement id so each one only needs to be dismissed once, ever.
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
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('Project profile updated successfully.');
  scanAndNotifyMentions(p.notes, 'in project "' + p.title + '"');
}

function archiveProject(projectId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Permission denied. Only Admins can archive projects.');
    return;
  }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  p.archived = true;
  archiveRequests.forEach(r => { if (r.projectId === projectId && r.status === 'PENDING') r.status = 'APPROVED'; });
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast('"' + p.title + '" moved to Archive Vault.');
}

function requestArchiveProject(projectId) {
  if (!currentUser) return;
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  const duplicate = archiveRequests.some(r => r.projectId === projectId && r.status === 'PENDING' && r.requester === currentUser.name);
  if (duplicate) {
    triggerNotificationToast('You already have a pending archive request for this project.');
    return;
  }
  archiveRequests.push({
    id: Date.now(), projectId: projectId, projectTitle: p.title,
    requester: currentUser.name,
    timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    status: 'PENDING'
  });
  flushStateToDisk();
  rebuildApplicationDOMViews();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('Archive request submitted for "' + p.title + '". Awaiting admin approval.');
}

function approveArchiveRequest(requestId) {
  if (!currentUser || currentUser.role !== 'ADMIN') return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'APPROVED';
  archiveProject(req.projectId);
  triggerNotificationToast('Archive request by ' + req.requester + ' approved.');
}

function denyArchiveRequest(requestId) {
  if (!currentUser || currentUser.role !== 'ADMIN') return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'DENIED';
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast('Archive request denied.');
}

function restoreProject(projectId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Permission denied. Only Admins can restore archived projects.');
    return;
  }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  p.archived = false;
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast('"' + p.title + '" restored to active dashboard.');
}

function deleteProject(projectId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Permission denied. Only Admins can delete projects.');
    return;
  }
  if (!confirm('Permanently delete this project? This cannot be undone.')) return;
  projects = projects.filter(x => x.id !== projectId);
  archiveRequests = archiveRequests.filter(r => r.projectId !== projectId);
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast('Project permanently deleted.');
}

// ===================== ARCHIVE GRID =====================
function generateArchiveGrid() {
  const container = document.getElementById('archiveGrid');
  const countBadge = document.getElementById('archiveCountBadge');
  if (!container) return;
  container.innerHTML = '';
  const isAdmin = currentUser && currentUser.role === 'ADMIN';
  if (!isAdmin) {
    container.innerHTML =
      '<div class="card" style="grid-column:1/-1; text-align:center; padding:3rem 2rem; border-color:rgba(229,62,62,0.3); background:rgba(229,62,62,0.05);">' +
      '<div style="font-size:2.5rem; margin-bottom:1rem;">🔒</div>' +
      '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700; margin-bottom:0.5rem; color:#fc8181;">Access Restricted</div>' +
      '<div style="color:var(--text-muted); font-size:0.9rem; max-width:360px; margin:0 auto;">The Archive Vault is accessible to Admin personnel only.</div></div>';
    if (countBadge) countBadge.style.display = 'none';
    return;
  }
  if (countBadge) {
    countBadge.style.display = '';
    countBadge.innerText = projects.filter(p => p.archived).length + ' archived';
  }
  const pending = archiveRequests.filter(r => r.status === 'PENDING');
  if (pending.length > 0) {
    const reqPanel = document.createElement('div');
    reqPanel.style.cssText = 'grid-column:1/-1;';
    reqPanel.innerHTML =
      '<div class="archive-requests-panel"><div class="archive-req-header"><span>📥 Pending Archive Requests</span><span class="archive-req-count">' + pending.length + '</span></div><div class="archive-req-list" id="archiveReqList"></div></div>';
    container.appendChild(reqPanel);
    const reqList = reqPanel.querySelector('#archiveReqList');
    pending.forEach(req => {
      const row = document.createElement('div');
      row.className = 'archive-req-row';
      row.innerHTML =
        '<div class="archive-req-info"><div style="font-weight:700; font-size:0.9rem;">' + req.projectTitle + '</div><div style="font-size:0.78rem; color:var(--text-muted);">Requested by <b>' + req.requester + '</b> · ' + req.timestamp + '</div></div>' +
        '<div style="display:flex; gap:0.5rem; flex-shrink:0;"><button class="req-approve-btn" data-req-id="' + req.id + '">✓ Approve</button><button class="req-deny-btn" data-req-id="' + req.id + '">✕ Deny</button></div>';
      reqList.appendChild(row);
    });
    reqPanel.querySelectorAll('.req-approve-btn').forEach(btn => {
      btn.addEventListener('click', () => approveArchiveRequest(parseInt(btn.dataset.reqId)));
    });
    reqPanel.querySelectorAll('.req-deny-btn').forEach(btn => {
      btn.addEventListener('click', () => denyArchiveRequest(parseInt(btn.dataset.reqId)));
    });
  }
  const archived = projects.filter(p => p.archived &&
    (p.title.toLowerCase().includes(archiveSearchQuery.toLowerCase()) ||
     p.category.toLowerCase().includes(archiveSearchQuery.toLowerCase()))
  );
  if (archived.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.style.cssText = 'grid-column:1/-1; text-align:center; color:var(--text-muted); padding:3rem;';
    empty.innerText = 'No archived projects. Archive a project from the dashboard to store it here.';
    container.appendChild(empty);
    return;
  }
  archived.forEach(p => {
    const nodeCard = document.createElement('div');
    nodeCard.className = 'card archived-card';
    let statusClass = 'status-active';
    if (p.status === 'IN REVIEW') statusClass = 'status-review';
    if (p.status === 'FILED') statusClass = 'status-filed';
    if (p.status === 'ON HOLD') statusClass = 'status-on-hold';
    if (p.status === 'PUBLISHED') statusClass = 'status-published';
    const tagsHtml = p.tags ? p.tags.split(',').filter(t => t.trim()).map(t => '<span class="card-tag">' + t.trim() + '</span>').join('') : '';
    const reporterHtml = p.reporter ? '<div class="card-reporter-chip"><div class="mini-avatar">' + p.reporter.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() + '</div><span>' + p.reporter + '</span></div>' : '';
    nodeCard.innerHTML =
      '<div class="card-category">' + p.category + '</div>' +
      '<div class="card-title" style="font-size:1.05rem;">' + p.title + '</div>' +
      reporterHtml +
      (tagsHtml ? '<div class="card-tags">' + tagsHtml + '</div>' : '') +
      '<div class="card-meta"><span>📅 ' + p.deadline + '</span><span class="status-badge ' + statusClass + '">' + p.status + '</span></div>' +
      '<div style="display:flex; gap:0.5rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.05);"><button class="restore-btn" data-id="' + p.id + '" style="flex:1;">↩ Restore</button><button class="card-action-btn delete-btn" data-id="' + p.id + '" style="flex:0 0 auto; padding:0.4rem 0.6rem;">🗑</button></div>';
    container.appendChild(nodeCard);
  });
  container.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', () => restoreProject(parseInt(btn.dataset.id)));
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProject(parseInt(btn.dataset.id)));
  });
}

// ===================== ARCHIVED SUMMARY REPORTS (assignments & beats) =====================
function generateArchiveReportsGrid() {
  const container = document.getElementById('archiveReportsGrid');
  const countBadge = document.getElementById('archiveReportsCountBadge');
  if (!container) return;
  container.innerHTML = '';
  const isAdmin = currentUser && currentUser.role === 'ADMIN';
  if (!isAdmin) {
    if (countBadge) countBadge.style.display = 'none';
    return;
  }
  const query = archiveSearchQuery.toLowerCase();
  const reports = archivedReports.filter(r =>
    r.title.toLowerCase().includes(query) || r.summary.toLowerCase().includes(query)
  );
  if (countBadge) {
    countBadge.style.display = '';
    countBadge.innerText = archivedReports.length + ' filed';
  }
  if (reports.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.style.cssText = 'grid-column:1/-1; text-align:center; color:var(--text-muted); padding:2rem;';
    empty.innerText = 'No closed-out reports yet. Filing an assignment or beat clear generates one automatically.';
    container.appendChild(empty);
    return;
  }
  reports.slice().reverse().forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';
    const typeIcon = r.type === 'BEAT' ? '📰' : '📋';
    const typeLabel = r.type === 'BEAT' ? 'Beat Closure' : 'Assignment Closure';
    card.innerHTML =
      '<div class="card-category">' + typeIcon + ' ' + typeLabel + '</div>' +
      '<div class="card-title" style="font-size:1.0rem;">' + r.title + '</div>' +
      '<div style="font-size:0.82rem; color:var(--text-muted); line-height:1.5;">' + r.summary + '</div>' +
      '<div class="card-meta"><span>🖊 Filed by ' + r.closedBy + '</span><span>📅 ' + r.timestamp + '</span></div>' +
      '<div style="display:flex; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.05);"><button class="card-action-btn delete-report-btn" data-id="' + r.id + '" style="flex:1; color:var(--danger);">🗑 Delete Report</button></div>';
    container.appendChild(card);
  });
  container.querySelectorAll('.delete-report-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Permanently delete this archived report? This cannot be undone.')) return;
      archivedReports = archivedReports.filter(r => r.id !== parseInt(btn.dataset.id));
      flushStateToDisk();
      generateArchiveReportsGrid();
      triggerNotificationToast('Report permanently deleted.');
    });
  });
}

// ===================== ACTIVITY SUMMARY (separate from Closed-Out Reports) =====================
function generateActivitySummaryGrid() {
  const container = document.getElementById('activitySummaryGrid');
  const countBadge = document.getElementById('activitySummaryCountBadge');
  if (!container) return;
  container.innerHTML = '';
  const isAdmin = currentUser && currentUser.role === 'ADMIN';
  if (!isAdmin) {
    if (countBadge) countBadge.style.display = 'none';
    return;
  }
  const query = archiveSearchQuery.toLowerCase();
  const summaries = activitySummaries.filter(r => r.title.toLowerCase().includes(query) || r.summary.toLowerCase().includes(query));
  if (countBadge) {
    countBadge.style.display = '';
    countBadge.innerText = activitySummaries.length + ' generated';
  }
  if (summaries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.style.cssText = 'grid-column:1/-1; text-align:center; color:var(--text-muted); padding:2rem;';
    empty.innerText = 'No activity summaries yet. Use "📊 Generate Activity Summary" to snapshot newsroom activity.';
    container.appendChild(empty);
    return;
  }
  summaries.slice().reverse().forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-category">📊 Activity Summary</div>' +
      '<div class="card-title" style="font-size:1.0rem;">' + r.title + '</div>' +
      '<div style="font-size:0.82rem; color:var(--text-muted); line-height:1.5;">' + r.summary + '</div>' +
      '<div class="card-meta"><span>🖊 Generated by ' + r.closedBy + '</span><span>📅 ' + r.timestamp + '</span></div>' +
      '<div style="display:flex; gap:0.5rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.05);">' +
      '<button class="card-action-btn export-summary-btn" data-id="' + r.id + '" style="flex:1;">⬇ Export CSV</button>' +
      '<button class="card-action-btn delete-summary-btn" data-id="' + r.id + '" style="flex:1; color:var(--danger);">🗑 Delete</button>' +
      '</div>';
    container.appendChild(card);
  });
  container.querySelectorAll('.export-summary-btn').forEach(btn => {
    btn.addEventListener('click', () => exportActivitySummaryCSV(parseInt(btn.dataset.id)));
  });
  container.querySelectorAll('.delete-summary-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Permanently delete this activity summary? This cannot be undone.')) return;
      activitySummaries = activitySummaries.filter(r => r.id !== parseInt(btn.dataset.id));
      flushStateToDisk();
      generateActivitySummaryGrid();
      triggerNotificationToast('Activity summary deleted.');
    });
  });
}

function exportActivitySummaryCSV(reportId) {
  const r = activitySummaries.find(x => x.id === reportId);
  if (!r) return;
  const m = r.meta || {};
  const headers = ['Title', 'Generated By', 'Date', 'Active Projects', 'Archived Projects', 'Open Assignments', 'Open Beats', 'Sources On File', 'Closed Assignments (all-time)', 'Closed Beats (all-time)', 'Check-ins Today'];
  const row = [
    '"' + r.title.replace(/"/g, '""') + '"', '"' + r.closedBy + '"', r.timestamp,
    m.activeProjects, m.archivedProjectsCount, m.openAssignments, m.openBeats,
    m.sourcesCount, m.closedTasks, m.closedBeats, m.todayCheckins
  ].join(',');
  const csv = [headers.join(','), row].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'jcompass_activity_summary_' + r.timestamp.replace(/[, ]+/g, '_') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  triggerNotificationToast('Activity summary exported as CSV.');
}

// Generates a snapshot report of overall newsroom activity (active/archived
// projects, open vs. closed tasks and beats, sources on file, and today's
// attendance) and files it into its own Activity Summary section.
function generateActivitySummaryReport() {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Permission denied. Only Admins can generate activity summaries.');
    return;
  }
  const activeProjects = projects.filter(p => !p.archived).length;
  const archivedProjectsCount = projects.filter(p => p.archived).length;
  const openAssignments = assignments.length;
  const openBeats = beats.length;
  const sourcesCount = sources.length;
  const closedTasks = archivedReports.filter(r => r.type === 'ASSIGNMENT').length;
  const closedBeats = archivedReports.filter(r => r.type === 'BEAT').length;
  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr).length;
  const now = new Date();
  const closedDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const summaryText =
    'Snapshot as of ' + closedDate + ': ' + activeProjects + ' active project(s), ' + archivedProjectsCount + ' archived. ' +
    openAssignments + ' assignment(s) and ' + openBeats + ' beat(s) currently open; ' +
    closedTasks + ' assignment(s) and ' + closedBeats + ' beat(s) have been filed clear to date. ' +
    sourcesCount + ' source(s) on file in the vault. ' + todayCheckins + ' field check-in(s) logged today.';
  activitySummaries.push({
    id: Date.now(),
    title: 'Newsroom Activity Summary — ' + closedDate,
    summary: summaryText,
    meta: { activeProjects, archivedProjectsCount, openAssignments, openBeats, sourcesCount, closedTasks, closedBeats, todayCheckins },
    closedBy: currentUser.name,
    timestamp: closedDate
  });
  flushStateToDisk();
  generateActivitySummaryGrid();
  triggerNotificationToast('Activity summary generated and filed.');
}

window.directRouteTaskTrigger = function(targetStaffName) {
  const modal = document.getElementById('addAssignmentModal');
  if (!modal) return;
  const targetNavNode = document.querySelector('[data-page="assignments"]');
  if (targetNavNode) targetNavNode.click();
  document.getElementById('asgAssignee').value = targetStaffName;
  modal.classList.add('active');
  document.getElementById('asgTitle').focus();
};

function processAnnouncementPublishing() {
  const input = document.getElementById('announceTextInput');
  const targetSelect = document.getElementById('announcePingTarget');
  if (!input || !input.value.trim() || !currentUser) return;
  const payload = {
    id: Date.now(), sender: currentUser.name, target: targetSelect.value,
    text: input.value.trim(),
    timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };
  input.value = '';

  if (supabaseClient) {
    // Don't add it locally here — the realtime subscription (open on every
    // logged-in device, including this one) adds it as soon as Supabase
    // confirms the insert, which keeps every device's view identical.
    publishPingRemote(payload)
      .then(() => triggerNotificationToast('Broadcast alert dispatched to workspace stream.'))
      .catch(err => {
        console.error('JCompass: failed to publish ping to Supabase.', err);
        triggerNotificationToast('Could not reach the server — ping was not sent.');
      });
  } else {
    announcements.push(payload);
    flushStateToDisk();
    generateAnnouncementsStream();
    triggerNotificationToast('Broadcast alert dispatched to workspace stream. (Local only — connect Supabase for cross-device delivery.)');
  }
}

// ===================== BEATS, ASSIGNMENTS, EVENTS =====================
function generateBeatsGrid() {
  const container = document.getElementById('beatsGrid');
  if (!container) return;
  container.innerHTML = '';
  beats.forEach(b => {
    const beatNode = document.createElement('div');
    beatNode.className = 'card';
    let imageElement = b.imgData
      ? '<img src="' + b.imgData + '" class="beat-card-img" alt="Beat Visual Descriptor">'
      : '<div class="beat-card-img" style="display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size:2rem;">📰</div>';
    let actionBtnHtml = currentUser && currentUser.role === 'ADMIN'
      ? '<button class="btn btn-ghost" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="processBeatResolve(' + b.id + ')">File Clear</button>'
      : '<span style="font-size:0.75rem; color:var(--accent-light); font-weight:700;">● ACTIVE</span>';
    beatNode.innerHTML =
      '<span class="priority-flag priority-' + b.priority + '">' + b.priority + '</span>' +
      imageElement +
      '<div class="card-title" style="margin-top:0.5rem;">' + b.name + '</div>' +
      '<div style="font-size: 0.85rem; color: var(--text-muted); display:flex; justify-content:space-between; align-items:center;"><span>Correspondent: <b>' + b.reporter + '</b></span>' + actionBtnHtml + '</div>';
    container.appendChild(beatNode);
  });
}

window.processBeatResolve = function(targetId) {
  const b = beats.find(x => x.id === targetId);
  if (!b) return;
  if (!confirm('File this beat clear? A summary report will be generated and moved to the Archive Vault.')) return;
  const closedDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  archivedReports.push({
    id: Date.now(),
    type: 'BEAT',
    title: b.name,
    summary: 'Beat desk "' + b.name + '" (Priority: ' + b.priority + ') was covered by ' + b.reporter + ' and closed out by ' + (currentUser ? currentUser.name : 'an editor') + ' on ' + closedDate + '.',
    meta: { reporter: b.reporter, priority: b.priority },
    closedBy: currentUser ? currentUser.name : 'Unknown',
    timestamp: closedDate
  });
  beats = beats.filter(x => x.id !== targetId);
  flushStateToDisk();
  generateBeatsGrid();
  generateArchiveReportsGrid();
  triggerNotificationToast('Beat filed clear — summary report archived.');
};

function generateAssignmentsGrid() {
  const container = document.getElementById('assignmentsGrid');
  if (!container) return;
  container.innerHTML = '';
  assignments.forEach(a => {
    const node = document.createElement('div');
    node.className = 'card card-interactive';
    let actionBtnHtml = currentUser && currentUser.role === 'ADMIN'
      ? '<button class="btn btn-ghost" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="processAssignmentResolve(' + a.id + ')">File Clear</button>'
      : '<span style="font-size:0.75rem; color:var(--accent-light); font-weight:700;">● DISPATCHED</span>';
    node.innerHTML =
      '<div class="card-title" style="font-size:1.05rem;">' + a.title + '</div>' +
      '<div style="font-size:0.85rem; color: var(--text-muted); display:flex; justify-content:space-between; align-items:center;"><span>Assignee: <b>' + a.assignee + '</b></span>' + actionBtnHtml + '</div>';
    container.appendChild(node);
  });
}

window.processAssignmentResolve = function(targetId) {
  const a = assignments.find(x => x.id === targetId);
  if (!a) return;
  const closedDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  archivedReports.push({
    id: Date.now(),
    type: 'ASSIGNMENT',
    title: a.title,
    summary: 'Assignment "' + a.title + '" was dispatched to ' + a.assignee + ' and filed clear by ' + (currentUser ? currentUser.name : 'an editor') + ' on ' + closedDate + '. No open follow-ups remain on this directive.',
    meta: { assignee: a.assignee },
    closedBy: currentUser ? currentUser.name : 'Unknown',
    timestamp: closedDate
  });
  assignments = assignments.filter(x => x.id !== targetId);
  flushStateToDisk();
  generateAssignmentsGrid();
  generateArchiveReportsGrid();
  triggerNotificationToast('Assignment filed clear — summary report archived.');
};

function generateEventsTrackerChecklist() {
  const container = document.getElementById('eventsChecklistContainer');
  if (!container) return;
  container.innerHTML = '';
  const active = events.filter(evt => !evt.archived);
  const archived = events.filter(evt => evt.archived);

  if (active.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center; color:var(--text-muted); font-size:0.9rem; padding:2rem 0;';
    empty.innerText = 'Agenda completely cleared.';
    container.appendChild(empty);
  } else {
    active.forEach(evt => {
      const div = document.createElement('div');
      div.className = 'event-row ' + (evt.completed ? 'done' : '');
      div.innerHTML =
        '<div><div style="font-weight:600; font-size:0.9rem;">' + evt.name + '</div><div style="font-size:0.75rem; color: var(--text-muted);">Target Date: ' + evt.date + (evt.locationNote ? ' · 📍 ' + evt.locationNote : '') + '</div></div>' +
        '<div style="display:flex; align-items:center; gap:0.4rem; flex-shrink:0;">' +
        '<button class="event-check-btn" title="Mark complete/incomplete">' + (evt.completed ? '✓' : '○') + '</button>' +
        '<button class="event-archive-btn btn btn-ghost" title="Archive this item" style="padding:0.2rem 0.45rem; font-size:0.85rem;">🗄</button>' +
        '<button class="event-remove-btn btn btn-ghost" title="Remove this item" style="padding:0.2rem 0.45rem; font-size:0.85rem; color:var(--danger); border-color:rgba(229,62,62,0.3);">🗑</button>' +
        '</div>';
      div.querySelector('.event-check-btn').addEventListener('click', () => {
        evt.completed = !evt.completed;
        flushStateToDisk();
        generateEventsTrackerChecklist();
      });
      div.querySelector('.event-archive-btn').addEventListener('click', () => {
        evt.archived = true;
        evt.archivedAt = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        flushStateToDisk();
        generateEventsTrackerChecklist();
        triggerNotificationToast('Agenda item archived.');
      });
      div.querySelector('.event-remove-btn').addEventListener('click', () => {
        if (!confirm('Remove "' + evt.name + '" from the agenda? This cannot be undone.')) return;
        events = events.filter(x => x.id !== evt.id);
        flushStateToDisk();
        generateEventsTrackerChecklist();
        triggerNotificationToast('Agenda item removed.');
      });
      container.appendChild(div);
    });
  }

  if (archived.length > 0) {
    const archHeader = document.createElement('div');
    archHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-top:1rem; padding-top:0.75rem; border-top:1px solid rgba(255,255,255,0.06); font-size:0.78rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px;';
    archHeader.innerHTML = '<span>🗄 ARCHIVED ITEMS</span><span>' + archived.length + '</span>';
    container.appendChild(archHeader);
    archived.forEach(evt => {
      const div = document.createElement('div');
      div.className = 'event-row done';
      div.style.opacity = '0.7';
      div.innerHTML =
        '<div><div style="font-weight:600; font-size:0.9rem;">' + evt.name + '</div><div style="font-size:0.75rem; color: var(--text-muted);">Target Date: ' + evt.date + (evt.locationNote ? ' · 📍 ' + evt.locationNote : '') + '</div></div>' +
        '<div style="display:flex; align-items:center; gap:0.4rem; flex-shrink:0;">' +
        '<button class="event-restore-btn btn btn-ghost" title="Restore to active agenda" style="padding:0.2rem 0.5rem; font-size:0.75rem;">↩ Restore</button>' +
        '<button class="event-remove-btn btn btn-ghost" title="Permanently delete" style="padding:0.2rem 0.45rem; font-size:0.85rem; color:var(--danger); border-color:rgba(229,62,62,0.3);">🗑</button>' +
        '</div>';
      div.querySelector('.event-restore-btn').addEventListener('click', () => {
        evt.archived = false;
        flushStateToDisk();
        generateEventsTrackerChecklist();
        triggerNotificationToast('Agenda item restored.');
      });
      div.querySelector('.event-remove-btn').addEventListener('click', () => {
        if (!confirm('Permanently delete "' + evt.name + '"? This cannot be undone.')) return;
        events = events.filter(x => x.id !== evt.id);
        flushStateToDisk();
        generateEventsTrackerChecklist();
        triggerNotificationToast('Archived agenda item deleted.');
      });
      container.appendChild(div);
    });
  }
}

// ===================== DYNAMIC CALENDAR =====================
function generateDeadlineCalendarGrid() {
  const container = document.getElementById('calendarMatrixLayout');
  const monthYearLabel = document.getElementById('calMonthYear');
  if (!container) return;
  container.innerHTML = '';
  if (monthYearLabel) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    monthYearLabel.innerText = monthNames[calendarMonth] + ' ' + calendarYear;
  }
  const headers = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  headers.forEach(lbl => {
    const cell = document.createElement('div');
    cell.className = 'cal-day-head';
    cell.innerText = lbl;
    container.appendChild(cell);
  });
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === calendarMonth && today.getFullYear() === calendarYear;
  const todayDate = today.getDate();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell cal-cell-empty';
    empty.style.opacity = '0.3';
    container.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const wrapperCell = document.createElement('div');
    const isToday = isCurrentMonth && day === todayDate;
    wrapperCell.className = 'cal-cell ' + (isToday ? 'today' : '');
    wrapperCell.innerHTML = '<div class="cal-num">' + day + '</div>';
    const dateStr = calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const dayProjects = projects.filter(p => p.deadline === dateStr && !p.archived);
    dayProjects.forEach(p => {
      const calElementBlock = document.createElement('div');
      calElementBlock.className = 'cal-entry';
      calElementBlock.innerText = p.title;
      calElementBlock.title = p.title + ' — ' + p.status;
      calElementBlock.style.cursor = 'pointer';
      calElementBlock.addEventListener('click', (e) => {
        e.stopPropagation();
        openProjectProfile(p.id);
      });
      wrapperCell.appendChild(calElementBlock);
    });
    wrapperCell.addEventListener('click', () => {
      document.getElementById('newDeadline').value = dateStr;
      document.getElementById('newProjectModal').classList.add('active');
      document.getElementById('newTitle').focus();
    });
    wrapperCell.style.cursor = 'pointer';
    container.appendChild(wrapperCell);
  }
}

// ===================== SOURCE VAULT =====================
function removeSourceDirect(sourceId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Permission denied. Only Admins can remove sources directly.');
    return;
  }
  const s = sources.find(x => x.id === sourceId);
  if (!s) return;
  if (!confirm('Remove "' + s.name + '" from the vault? This cannot be undone.')) return;
  sources = sources.filter(x => x.id !== sourceId);
  sourceRemovalRequests = sourceRemovalRequests.filter(r => r.sourceId !== sourceId);
  flushStateToDisk();
  generateSourcesGrid();
  triggerNotificationToast('Source removed from vault.');
}

function requestRemoveSource(sourceId) {
  if (!currentUser) return;
  const s = sources.find(x => x.id === sourceId);
  if (!s) return;
  const duplicate = sourceRemovalRequests.some(r => r.sourceId === sourceId && r.status === 'PENDING' && r.requester === currentUser.name);
  if (duplicate) {
    triggerNotificationToast('You already have a pending removal request for this source.');
    return;
  }
  sourceRemovalRequests.push({
    id: Date.now(), sourceId: sourceId, sourceName: s.name,
    requester: currentUser.name,
    timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    status: 'PENDING'
  });
  flushStateToDisk();
  generateSourcesGrid();
  triggerNotificationToast('Removal request submitted for "' + s.name + '". Awaiting admin approval.');
}

function approveRemoveSourceRequest(requestId) {
  if (!currentUser || currentUser.role !== 'ADMIN') return;
  const req = sourceRemovalRequests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'APPROVED';
  sources = sources.filter(x => x.id !== req.sourceId);
  flushStateToDisk();
  generateSourcesGrid();
  triggerNotificationToast('Removal request by ' + req.requester + ' approved — source deleted.');
}

function denyRemoveSourceRequest(requestId) {
  if (!currentUser || currentUser.role !== 'ADMIN') return;
  const req = sourceRemovalRequests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'DENIED';
  flushStateToDisk();
  generateSourcesGrid();
  triggerNotificationToast('Removal request denied.');
}

function generateSourcesGrid() {
  const container = document.getElementById('sourcesGrid');
  if (!container) return;
  container.innerHTML = '';
  const isAdmin = currentUser && currentUser.role === 'ADMIN';

  if (isAdmin) {
    const pending = sourceRemovalRequests.filter(r => r.status === 'PENDING');
    if (pending.length > 0) {
      const reqPanel = document.createElement('div');
      reqPanel.style.cssText = 'grid-column:1/-1;';
      reqPanel.innerHTML =
        '<div class="archive-requests-panel"><div class="archive-req-header"><span>📥 Pending Source Removal Requests</span><span class="archive-req-count">' + pending.length + '</span></div><div class="archive-req-list" id="sourceRemovalReqList"></div></div>';
      container.appendChild(reqPanel);
      const reqList = reqPanel.querySelector('#sourceRemovalReqList');
      pending.forEach(req => {
        const row = document.createElement('div');
        row.className = 'archive-req-row';
        row.innerHTML =
          '<div class="archive-req-info"><div style="font-weight:700; font-size:0.9rem;">' + req.sourceName + '</div><div style="font-size:0.78rem; color:var(--text-muted);">Requested by <b>' + req.requester + '</b> · ' + req.timestamp + '</div></div>' +
          '<div style="display:flex; gap:0.5rem; flex-shrink:0;"><button class="req-approve-btn" data-req-id="' + req.id + '">✓ Approve</button><button class="req-deny-btn" data-req-id="' + req.id + '">✕ Deny</button></div>';
        reqList.appendChild(row);
      });
      reqPanel.querySelectorAll('.req-approve-btn').forEach(btn => {
        btn.addEventListener('click', () => approveRemoveSourceRequest(parseInt(btn.dataset.reqId)));
      });
      reqPanel.querySelectorAll('.req-deny-btn').forEach(btn => {
        btn.addEventListener('click', () => denyRemoveSourceRequest(parseInt(btn.dataset.reqId)));
      });
    }
  }

  const query = sourceSearchQuery.toLowerCase();
  const subset = sources.filter(s =>
    s.name.toLowerCase().includes(query) ||
    (s.beat || '').toLowerCase().includes(query) ||
    (s.contact || '').toLowerCase().includes(query)
  );
  if (subset.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.style.cssText = 'grid-column:1/-1; text-align:center; color:var(--text-muted); padding:3rem;';
    empty.innerText = 'No sources in vault. Add a confidential source to get started.';
    container.appendChild(empty);
    return;
  }
  subset.forEach(s => {
    const card = document.createElement('div');
    card.className = 'card source-card';
    const relColors = { HIGH: '#fc8181', MEDIUM: '#fbd38d', LOW: '#9ae6b4' };
    const relLabels = { HIGH: '🔴 High', MEDIUM: '🟡 Medium', LOW: '🟢 Low' };
    const pendingForThis = sourceRemovalRequests.some(r => r.sourceId === s.id && r.status === 'PENDING' && r.requester === (currentUser ? currentUser.name : ''));
    const actionBtnHtml = isAdmin
      ? '<button class="btn btn-ghost source-delete-btn" data-id="' + s.id + '" style="font-size:0.75rem; padding:0.25rem 0.5rem; color:var(--danger); border-color:rgba(229,62,62,0.3);">Remove</button>'
      : '<button class="btn btn-ghost source-request-remove-btn" data-id="' + s.id + '" ' + (pendingForThis ? 'disabled' : '') + ' style="font-size:0.75rem; padding:0.25rem 0.5rem; color:#fbd38d; border-color:rgba(221,107,32,0.35);">' + (pendingForThis ? '⏳ Pending...' : '📤 Request Removal') + '</button>';
    card.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:flex-start;"><div class="card-title" style="font-size:1.1rem;">' + s.name + '</div>' +
      '<span style="font-size:0.72rem; font-weight:800; padding:0.2rem 0.5rem; border-radius:4px; background:' + (relColors[s.reliability] || 'var(--border-color)') + '22; color:' + (relColors[s.reliability] || 'var(--text-muted)') + '; border:1px solid ' + (relColors[s.reliability] || 'var(--border-color)') + '44;">' + (relLabels[s.reliability] || s.reliability) + '</span></div>' +
      '<div style="font-size:0.85rem; color:var(--text-muted);">📰 <b>' + (s.beat || 'Unassigned Beat') + '</b></div>' +
      '<div style="font-size:0.82rem; color:var(--accent-light); font-family:monospace;">' + (s.contact || 'No contact on file') + '</div>' +
      (s.notes ? '<div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.05);">' + s.notes + '</div>' : '') +
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto; padding-top:0.75rem; border-top:1px solid rgba(255,255,255,0.05);"><span style="font-size:0.7rem; color:var(--text-muted);">Added by ' + (s.createdBy || 'Unknown') + '</span>' +
      actionBtnHtml + '</div>';
    container.appendChild(card);
  });
  container.querySelectorAll('.source-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSourceDirect(parseInt(btn.dataset.id));
    });
  });
  container.querySelectorAll('.source-request-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      requestRemoveSource(parseInt(btn.dataset.id));
    });
  });
}

// ===================== USER MANAGEMENT =====================
function generateUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  registeredUsersDB.forEach(user => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    const isSelf = currentUser && user.name === currentUser.name;
    tr.innerHTML =
      '<td style="padding:0.9rem 1.25rem; font-weight:800; font-size:0.85rem;">' + user.code + '</td>' +
      '<td style="padding:0.9rem 1.25rem; font-weight:600;"><div style="display:flex; align-items:center; gap:0.5rem;">' +
      '<div style="width:32px; height:32px; background:' + (user.role === 'ADMIN' ? 'rgba(221,107,32,0.25)' : 'var(--accent)') + '; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.72rem; font-weight:800; flex-shrink:0; color:' + (user.role === 'ADMIN' ? '#fbd38d' : 'white') + ';">' + user.code + '</div>' +
      user.name + (isSelf ? ' <span style="font-size:0.7rem; color:var(--accent-light); font-weight:700;">(YOU)</span>' : '') + '</div></td>' +
      '<td style="padding:0.9rem 1.25rem;"><span style="font-size:0.75rem; font-weight:800; padding:0.25rem 0.6rem; border-radius:4px; background:' + (user.role === 'ADMIN' ? 'rgba(221,107,32,0.2)' : 'rgba(49,57,98,0.6)') + '; color:' + (user.role === 'ADMIN' ? '#fbd38d' : '#cbd5e1') + ';">' + user.role + '</span></td>' +
      '<td style="padding:0.9rem 1.25rem; color:var(--text-muted); font-size:0.82rem;">' + (user.created || '—') + '</td>' +
      '<td style="padding:0.9rem 1.25rem; text-align:right;">' + (!isSelf ? '<button class="btn btn-ghost user-delete-btn" data-name="' + user.name + '" style="font-size:0.78rem; padding:0.3rem 0.6rem; color:var(--danger); border-color:rgba(229,62,62,0.3);">Delete</button>' : '<span style="font-size:0.78rem; color:var(--text-muted);">—</span>') + '</td>';
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.user-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      if (!confirm('Permanently delete account "' + name + '"? This cannot be undone.')) return;
      registeredUsersDB = registeredUsersDB.filter(u => u.name !== name);
      flushStateToDisk();
      generateUsersTable();
      generateStaffDirectory();
      triggerNotificationToast('Account "' + name + '" deleted.');
    });
  });
}

function createNewUser() {
  const name = document.getElementById('newUserName').value.trim();
  const pass = document.getElementById('newUserPass').value.trim();
  const role = document.getElementById('newUserRole').value;
  if (name.length < 2 || pass.length < 4) {
    triggerNotificationToast('Name too short or password < 4 characters.');
    return;
  }
  const isDuplicate = registeredUsersDB.some(u => u.name.toLowerCase() === name.toLowerCase());
  if (isDuplicate) {
    triggerNotificationToast('Desk identity already exists in directory.');
    return;
  }
  const parts = name.split(' ');
  const code = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
  registeredUsersDB.push({
    name: name, pass: pass, role: role, code: code,
    created: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  });
  flushStateToDisk();
  generateUsersTable();
  generateStaffDirectory();
  document.getElementById('addUserModal').classList.remove('active');
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPass').value = '';
  triggerNotificationToast('Account "' + name + '" created successfully.');
}

// ===================== ATTENDANCE =====================
function saveAttendanceLogs() {
  localStorage.setItem('jcompass_attendance', JSON.stringify(attendanceLogs));
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
    const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lon, {
      headers: { 'Accept-Language': 'en' }
    });
    const data = await res.json();
    const a = data.address || {};
    return a.suburb || a.village || a.town || a.city || a.county || a.state || data.display_name || 'Unknown Location';
  } catch {
    return 'Location label unavailable';
  }
}

function hasCheckedInToday() {
  if (!currentUser) return false;
  const today = new Date().toLocaleDateString('en-CA');
  return attendanceLogs.some(log => log.reporter === currentUser.name && log.date === today);
}

function processFieldTelemetryMarking() {
  const loggerNode = document.getElementById('telemetryStatus');
  const statusBadge = document.getElementById('attendanceStatusBadge');
  const btn = document.getElementById('markAttendanceBtn');
  if (!loggerNode || !currentUser) return;
  if (hasCheckedInToday()) {
    statusBadge.style.display = 'block';
    statusBadge.style.background = 'rgba(221,107,32,0.15)';
    statusBadge.style.border = '1px solid rgba(221,107,32,0.35)';
    statusBadge.style.color = '#fbd38d';
    statusBadge.innerHTML = '⚠ Already checked in today. Only one log per reporter per day.';
    return;
  }
  loggerNode.innerHTML = '<span style="color:var(--text-muted);">⏳ Acquiring GPS signal...</span>';
  btn.disabled = true;
  btn.innerText = '⏳ Locating...';
  if (!navigator.geolocation) {
    loggerNode.innerHTML = '<span style="color:var(--danger);">✗ Geolocation API not supported on this device.</span>';
    btn.disabled = false;
    btn.innerText = '📍 Stamp Geo-Presence';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      const now = new Date();
      loggerNode.innerHTML = '<span style="color:var(--text-muted);">🌐 Resolving location name...</span>';
      const locationLabel = await reverseGeocodeLabel(lat, lon);
      const noteInput = document.getElementById('attendanceLocationNote');
      const locationNote = noteInput ? noteInput.value.trim() : '';
      const entry = {
        id: Date.now(), reporter: currentUser.name, role: currentUser.role,
        date: now.toLocaleDateString('en-CA'),
        time: now.toLocaleTimeString('en-US', { hour12: true }),
        lat: lat.toFixed(6), lon: lon.toFixed(6),
        accuracy: Math.round(accuracy), location: locationLabel,
        note: locationNote,
        timestamp: now.toISOString()
      };
      if (noteInput) noteInput.value = '';
      attendanceLogs.unshift(entry);
      saveAttendanceLogs();

      // Mirror the check-in to the Django backend so other staff/admins see
      // it too, not just this device's localStorage. Local save above has
      // already happened, so a network failure here doesn't lose the log —
      // it just stays local-only until the next successful sync.
      try {
        const response = await fetch(ATTENDANCE_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reporter: currentUser.name,
            role: currentUser.role,
            lat: lat,
            lon: lon,
            accuracy: accuracy,
            location: locationLabel,
            note: locationNote
          })
        });
        const result = await response.json();
        if (response.ok) {
          console.log('Saved to Django database:', result);
        } else {
          console.error('Failed to save to database:', result);
        }
      } catch (err) {
        console.error('Network error reaching Django server:', err);
      }

      document.getElementById('locationPreviewText').innerText = locationLabel + ' (±' + Math.round(accuracy) + 'm)';
      statusBadge.style.display = 'block';
      statusBadge.style.background = 'rgba(56,161,105,0.15)';
      statusBadge.style.border = '1px solid rgba(56,161,105,0.35)';
      statusBadge.style.color = '#9ae6b4';
      statusBadge.innerHTML = '✓ Check-in recorded at ' + entry.time;
      loggerNode.innerHTML =
        '<span style="color:var(--success); font-weight:700;">✓ Geo-Presence Stamped</span><br>' +
        '<span>📍 ' + locationLabel + '</span><br>' +
        '<span style="color:var(--text-muted);">Lat: ' + lat.toFixed(6) + '° | Lon: ' + lon.toFixed(6) + '°</span><br>' +
        '<span style="color:var(--text-muted);">Accuracy: ±' + Math.round(accuracy) + 'm | ' + entry.time + '</span>';
      btn.disabled = false;
      btn.innerText = '✓ Geo-Presence Timestamped';
      btn.style.background = 'var(--success)';
      renderAttendanceTable();
      updateAttendanceStats();
      triggerNotificationToast('Attendance logged: ' + entry.time + ' — ' + locationLabel);
    },
    (err) => {
      const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Location request timed out.' };
      loggerNode.innerHTML = '<span style="color:var(--danger);">✗ ' + (msgs[err.code] || 'Location error.') + '</span>';
      btn.disabled = false;
      btn.innerText = '📍 Timestamp Geo-Presence Profile';
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

function renderAttendanceTable() {
  const tbody = document.getElementById('attendanceTableBody');
  const emptyRow = document.getElementById('attendanceEmptyRow');
  if (!tbody) return;
  const query = attendanceSearchQuery.toLowerCase();
  const subset = attendanceLogs.filter(log =>
    log.reporter.toLowerCase().includes(query) ||
    log.date.includes(query) ||
    log.location.toLowerCase().includes(query)
  );
  Array.from(tbody.querySelectorAll('tr:not(#attendanceEmptyRow)')).forEach(r => r.remove());
  if (subset.length === 0) {
    if (emptyRow) emptyRow.style.display = '';
    return;
  }
  if (emptyRow) emptyRow.style.display = 'none';
  subset.forEach((log, idx) => {
    const isToday = log.date === new Date().toLocaleDateString('en-CA');
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    if (isToday) tr.style.background = 'rgba(56,161,105,0.05)';
    tr.innerHTML =
      '<td style="padding:0.75rem 1.5rem; color:var(--text-muted); font-size:0.75rem;">' + (idx + 1) + '</td>' +
      '<td style="padding:0.75rem 1rem; font-weight:600;"><div style="display:flex; align-items:center; gap:0.5rem;">' +
      '<div style="width:28px; height:28px; background:var(--accent); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:800; flex-shrink:0;">' + log.reporter.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() + '</div>' + log.reporter + '</div></td>' +
      '<td style="padding:0.75rem 1rem; color:var(--text-muted);">' + (isToday ? '<span style="color:var(--success); font-weight:700; font-size:0.75rem;">TODAY</span> ' : '') + log.date + '</td>' +
      '<td style="padding:0.75rem 1rem; font-family:monospace; font-size:0.82rem;">' + log.time + '</td>' +
      '<td style="padding:0.75rem 1rem; font-family:monospace; font-size:0.8rem; color:var(--accent-light);">' + log.lat + '°</td>' +
      '<td style="padding:0.75rem 1rem; font-family:monospace; font-size:0.8rem; color:var(--accent-light);">' + log.lon + '°</td>' +
      '<td style="padding:0.75rem 1rem; font-size:0.8rem; color:var(--text-muted);">±' + log.accuracy + 'm</td>' +
      '<td style="padding:0.75rem 1rem; font-size:0.82rem; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + log.location + '">📍 ' + log.location + '</td>' +
      '<td style="padding:0.75rem 1rem; font-size:0.8rem; color:var(--text-muted); max-width:160px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + (log.note || '') + '">' + (log.note ? '📝 ' + log.note : '—') + '</td>' +
      '<td style="padding:0.75rem 1rem;"><span style="font-size:0.7rem; font-weight:800; padding:0.2rem 0.45rem; border-radius:4px; background:' + (log.role === 'ADMIN' ? 'rgba(221,107,32,0.2)' : 'rgba(49,57,98,0.6)') + '; color:' + (log.role === 'ADMIN' ? '#fbd38d' : '#cbd5e1') + ';">' + log.role + '</span></td>' +
      '<td style="padding:0.75rem 1rem;"><button class="btn btn-ghost geo-map-btn" data-log-id="' + log.id + '" style="font-size:0.75rem; padding:0.25rem 0.6rem; white-space:nowrap; display:flex; align-items:center; gap:0.3rem;">🗺️ View</button></td>';
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

function openGeoMapModal(logId) {
  const log = attendanceLogs.find(l => l.id === logId);
  if (!log) return;
  const lat = parseFloat(log.lat);
  const lon = parseFloat(log.lon);
  const googleMapsUrl = 'https://www.google.com/maps?q=' + lat + ',' + lon + '&z=17';
  const embedUrl = 'https://maps.google.com/maps?q=' + lat + ',' + lon + '&z=17&output=embed';
  const infoBar = document.getElementById('geoMapReporterInfo');
  if (infoBar) {
    infoBar.innerHTML =
      '<div style="display:flex; align-items:center; gap:0.5rem;">' +
      '<div style="width:32px;height:32px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;flex-shrink:0;">' + log.reporter.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() + '</div>' +
      '<div><div style="font-weight:700; font-size:0.9rem;">' + log.reporter + '</div><div style="font-size:0.72rem; color:var(--text-muted);">' + log.role + '</div></div></div>' +
      '<div style="margin-left:auto; display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">' +
      '<span style="font-size:0.78rem; background:rgba(0,0,0,0.25); padding:0.25rem 0.6rem; border-radius:6px; font-family:monospace; color:var(--accent-light);">' + lat.toFixed(6) + '°, ' + lon.toFixed(6) + '°</span>' +
      '<span style="font-size:0.78rem; color:var(--text-muted);">📅 ' + log.date + ' · ' + log.time + '</span>' +
      '<span style="font-size:0.78rem; color:var(--text-muted);">±' + log.accuracy + 'm</span></div>' +
      '<div style="width:100%; font-size:0.82rem; color:var(--text-muted);">📍 ' + log.location + '</div>';
  }
  const iframe = document.getElementById('geoMapIframe');
  const fallback = document.getElementById('geoMapFallback');
  if (iframe) {
    iframe.src = embedUrl;
    iframe.style.display = 'block';
    if (fallback) fallback.style.display = 'none';
    iframe.onerror = () => {
      iframe.style.display = 'none';
      if (fallback) {
        fallback.style.display = 'flex';
        document.getElementById('geoMapFallbackCoords').innerText = lat.toFixed(6) + '°, ' + lon.toFixed(6) + '°';
        document.getElementById('geoMapExternalLink').href = googleMapsUrl;
      }
    };
  }
  const extLink = document.getElementById('geoMapOpenBtn');
  if (extLink) extLink.href = googleMapsUrl;
  document.getElementById('geoMapModal')?.classList.add('active');
}

function exportAttendanceCSV() {
  if (attendanceLogs.length === 0 && events.filter(e => e.archived).length === 0) {
    triggerNotificationToast('No attendance records to export.');
    return;
  }
  const headers = ['#', 'Reporter', 'Role', 'Date', 'Time', 'Latitude', 'Longitude', 'Accuracy (m)', 'Location Label', 'Note'];
  const rows = attendanceLogs.map((log, i) =>
    [i + 1, log.reporter, log.role, log.date, log.time, log.lat, log.lon, log.accuracy, '"' + log.location + '"', '"' + (log.note || '').replace(/"/g, '""') + '"'].join(',')
  );
  let csv = [headers.join(','), ...rows].join('\n');

  // Archived Checklist Agenda Items are appended as a second table in the
  // same file so a filed-away agenda item's history travels with the
  // attendance export instead of needing a separate download.
  const archivedEvents = events.filter(e => e.archived);
  if (archivedEvents.length > 0) {
    const evtHeaders = ['#', 'Event', 'Target Date', 'Location Note', 'Completed', 'Archived Date'];
    const evtRows = archivedEvents.map((evt, i) => [
      i + 1, '"' + evt.name.replace(/"/g, '""') + '"', evt.date,
      '"' + (evt.locationNote || '').replace(/"/g, '""') + '"',
      evt.completed ? 'YES' : 'NO', evt.archivedAt || ''
    ].join(','));
    csv += '\n\nArchived Checklist Agenda Items\n' + [evtHeaders.join(','), ...evtRows].join('\n');
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'jcompass_attendance_' + new Date().toLocaleDateString('en-CA') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  triggerNotificationToast('Attendance log exported as CSV.');
}

function exportProjectsCSV() {
  const active = projects.filter(p => !p.archived);
  if (active.length === 0) {
    triggerNotificationToast('No projects to export.');
    return;
  }
  const headers = ['ID', 'Title', 'Category', 'Deadline', 'Status', 'Priority', 'Progress', 'Reporter', 'Tags', 'Notes'];
  const rows = active.map(p => [
    p.id, '"' + p.title + '"', p.category, p.deadline, p.status, p.priority,
    p.progress, '"' + (p.reporter || '') + '"', '"' + (p.tags || '') + '"', '"' + (p.notes || '').replace(/"/g, '""') + '"'
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'jcompass_projects_' + new Date().toLocaleDateString('en-CA') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  triggerNotificationToast('Projects exported as CSV.');
}

function initAttendancePage() {
  startLiveClock();
  renderAttendanceTable();
  updateAttendanceStats();
  if (hasCheckedInToday()) {
    const btn = document.getElementById('markAttendanceBtn');
    const badge = document.getElementById('attendanceStatusBadge');
    if (btn) { btn.innerText = '✓ Geo-Presence Timestamped'; btn.style.background = 'var(--success)'; }
    if (badge) {
      badge.style.display = 'block';
      badge.style.background = 'rgba(56,161,105,0.15)';
      badge.style.border = '1px solid rgba(56,161,105,0.35)';
      badge.style.color = '#9ae6b4';
      const todayLog = attendanceLogs.find(l => l.reporter === currentUser?.name && l.date === new Date().toLocaleDateString('en-CA'));
      badge.innerHTML = todayLog ? '✓ Already checked in at ' + todayLog.time : '✓ Checked in today';
    }
  }
  document.getElementById('exportAttendanceBtn')?.addEventListener('click', exportAttendanceCSV);
  const tbody = document.getElementById('attendanceTableBody');
  if (tbody && !tbody.dataset.mapListenerAttached) {
    tbody.dataset.mapListenerAttached = 'true';
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.geo-map-btn');
      if (!btn) return;
      const logId = parseInt(btn.getAttribute('data-log-id'));
      if (!isNaN(logId)) openGeoMapModal(logId);
    });
  }
  document.getElementById('geoMapModal')?.querySelectorAll('[data-close="geoMapModal"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('geoMapModal').classList.remove('active');
      const iframe = document.getElementById('geoMapIframe');
      if (iframe) iframe.src = 'about:blank';
    });
  });
  document.getElementById('clearAttendanceBtn')?.addEventListener('click', () => {
    if (!confirm('Clear ALL attendance records? This cannot be undone.')) return;
    attendanceLogs = [];
    saveAttendanceLogs();
    renderAttendanceTable();
    updateAttendanceStats();
    const badge = document.getElementById('attendanceStatusBadge');
    if (badge) badge.style.display = 'none';
    triggerNotificationToast('Attendance log cleared.');
  });
  document.getElementById('attendanceSearchInput')?.addEventListener('input', (e) => {
    attendanceSearchQuery = e.target.value;
    renderAttendanceTable();
  });
}

function triggerNotificationToast(strMessage) {
  const popToast = document.getElementById('toast');
  if (!popToast) return;
  popToast.innerText = strMessage;
  popToast.classList.add('active');
  setTimeout(() => { popToast.classList.remove('active'); }, 3000);
}

// ===================== INITIALIZATION =====================
document.addEventListener('DOMContentLoaded', () => {
  // Auth wiring goes first and unconditionally, before anything else in this
  // block runs. That way, even if something below throws (a rendering bug,
  // a bad data record, etc.), the login form is already interactive and a
  // refresh never leaves the user stuck on a dead auth screen.
  const loginBtn = document.getElementById('loginSubmitBtn');
  if (loginBtn) loginBtn.addEventListener('click', processCredentialsAuthentication);
  ['username', 'password'].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') processCredentialsAuthentication();
    });
  });

  try {
    initSupabaseClient();
    const activeProfileTheme = localStorage.getItem('jcompass_theme') || 'forest';
    document.body.setAttribute('data-theme-profile', activeProfileTheme);
    const targetActiveChip = document.querySelector('.theme-chip-btn[data-theme="' + activeProfileTheme + '"]');
    if (targetActiveChip) {
      document.querySelectorAll('.theme-chip-btn').forEach(c => c.classList.remove('active'));
      targetActiveChip.classList.add('active');
    }
    enforceSessionGuard();
  } catch (err) {
    console.error('JCompass: session/theme init failed, continuing with a fresh login screen.', err);
    const gateOverlay = document.getElementById('authScreen');
    if (gateOverlay) gateOverlay.style.display = 'flex';
  }

  // Push notification permission toggle
  refreshNotificationPermissionUI();
  const notifyBtn = document.getElementById('enableNotificationsBtn');
  if (notifyBtn) notifyBtn.addEventListener('click', requestNotificationPermission);

  // Control Tray
  const userChipBtn = document.getElementById('userAvatarBtn');
  const trayOverlay = document.getElementById('controlTrayOverlay');
  const controlTray = document.getElementById('controlTray');
  const trayCloseBtn = document.getElementById('controlTrayCloseBtn');
  if (userChipBtn && controlTray && trayOverlay) {
    userChipBtn.addEventListener('click', () => {
      controlTray.classList.add('active');
      trayOverlay.classList.add('active');
    });
    const closeTrayWorkflow = () => {
      controlTray.classList.remove('active');
      trayOverlay.classList.remove('active');
    };
    trayCloseBtn.addEventListener('click', closeTrayWorkflow);
    trayOverlay.addEventListener('click', closeTrayWorkflow);
  }

  // Announcements
  document.getElementById('submitAnnouncementBtn').addEventListener('click', processAnnouncementPublishing);

  // Navigation
  const items = document.querySelectorAll('.nav-item');
  items.forEach(nav => {
    nav.addEventListener('click', () => {
      items.forEach(i => i.classList.remove('active'));
      nav.classList.add('active');
      const targetPageId = nav.getAttribute('data-page');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const matchTargetElement = document.getElementById('page-' + targetPageId);
      if (matchTargetElement) matchTargetElement.classList.add('active');
      const breadcrumb = document.getElementById('breadcrumbCurrent');
      if (breadcrumb) breadcrumb.innerText = nav.querySelector('.nav-label').innerText;
      document.getElementById('sidebar').classList.remove('active');
      if (targetPageId === 'attend') initAttendancePage();
      if (targetPageId === 'calendar') generateDeadlineCalendarGrid();
    });
  });

  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('active');
    });
  }

  // Dashboard search & filter
  const searchInp = document.getElementById('dashboardSearchInput');
  if (searchInp) {
    searchInp.addEventListener('input', (evt) => {
      searchQuery = evt.target.value;
      generateProjectDashboard();
    });
  }
  const filterBar = document.getElementById('dashboardFilterBar');
  if (filterBar) {
    filterBar.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        filterBar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentFilter = chip.getAttribute('data-filter');
        generateProjectDashboard();
      });
    });
  }

  // Attendance
  if (document.getElementById('markAttendanceBtn')) {
    document.getElementById('markAttendanceBtn').addEventListener('click', processFieldTelemetryMarking);
  }

  // Save name
  const saveNameBtn = document.getElementById('saveNameBtn');
  if (saveNameBtn) {
    saveNameBtn.addEventListener('click', () => {
      const sideInput = document.getElementById('sidebarNameInput');
      if (!sideInput || !currentUser) return;
      const adjustedNameValue = sideInput.value.trim();
      if (!adjustedNameValue) return triggerNotificationToast('Display name cannot be left blank.');
      currentUser.name = adjustedNameValue;
      const indexParts = adjustedNameValue.split(' ');
      currentUser.code = indexParts.length > 1
        ? (indexParts[0][0] + indexParts[1][0]).toUpperCase()
        : adjustedNameValue.substring(0, 2).toUpperCase();
      localStorage.setItem('jcompass_user', JSON.stringify(currentUser));
      const currentDbRecord = registeredUsersDB.find(u => u.pass === (currentUser.role === 'ADMIN' ? 'admin123' : 'staff123'));
      if (currentDbRecord) {
        currentDbRecord.name = currentUser.name;
        currentDbRecord.code = currentUser.code;
      }
      flushStateToDisk();
      evaluateClearancePermissions();
      generateStaffDirectory();
      triggerNotificationToast('Display identity updated successfully.');
    });
  }

  // Themes
  document.querySelectorAll('.theme-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-chip-btn').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const selectedThemeId = btn.getAttribute('data-theme');
      document.body.setAttribute('data-theme-profile', selectedThemeId);
      localStorage.setItem('jcompass_theme', selectedThemeId);
      triggerNotificationToast('Workspace theme changed to: ' + selectedThemeId);
    });
  });

  // Modal openers
  const workflowMappingBridges = [
    { buttonId: 'fabBtn', windowModalId: 'newProjectModal' },
    { buttonId: 'addCalendarProjectBtn', windowModalId: 'newProjectModal' },
    { buttonId: 'addBeatBtn', windowModalId: 'addBeatModal' },
    { buttonId: 'addAssignmentBtn', windowModalId: 'addAssignmentModal' },
    { buttonId: 'addEventBtn', windowModalId: 'addEventModal' },
    { buttonId: 'addUserBtn', windowModalId: 'addUserModal' },
    { buttonId: 'addSourceBtn', windowModalId: 'addSourceModal' },
    { buttonId: 'quickAddProjectBtn', windowModalId: 'newProjectModal' }
  ];
  workflowMappingBridges.forEach(bridge => {
    const trackingBtn = document.getElementById(bridge.buttonId);
    if (trackingBtn) {
      trackingBtn.addEventListener('click', () => {
        document.getElementById(bridge.windowModalId).classList.add('active');
      });
    }
  });

  // Modal closers
  document.querySelectorAll('[data-close]').forEach(closeControlBtn => {
    closeControlBtn.addEventListener('click', () => {
      const activeWindowTargetId = closeControlBtn.getAttribute('data-close');
      document.getElementById(activeWindowTargetId).classList.remove('active');
    });
  });

  // Create Project
  document.getElementById('createProjectBtn').addEventListener('click', () => {
    const headline = document.getElementById('newTitle').value.trim();
    const categoricalNode = document.getElementById('newCategory').value;
    const dateLimit = document.getElementById('newDeadline').value || new Date().toISOString().split('T')[0];
    if (!headline) return triggerNotificationToast('Card requires content text.');
    projects.push({ id: Date.now(), title: headline, category: categoricalNode, deadline: dateLimit, status: 'ACTIVE', priority: 'MEDIUM', progress: 0, reporter: currentUser ? currentUser.name : '', notes: '', tags: '', archived: false });
    flushStateToDisk();
    rebuildApplicationDOMViews();
    document.getElementById('newProjectModal').classList.remove('active');
    document.getElementById('newTitle').value = '';
    triggerNotificationToast('Project dashboard item published.');
  });

  // Save Assignment
  document.getElementById('saveAssignmentBtn').addEventListener('click', () => {
    const payloadInstruction = document.getElementById('asgTitle').value.trim();
    const targetedUser = document.getElementById('asgAssignee').value.trim() || 'General Desk';
    if (!payloadInstruction) return triggerNotificationToast('Task payload content rejected empty.');
    assignments.push({ id: Date.now(), title: payloadInstruction, assignee: targetedUser });
    flushStateToDisk();
    generateAssignmentsGrid();
    document.getElementById('addAssignmentModal').classList.remove('active');
    document.getElementById('asgTitle').value = '';
    document.getElementById('asgAssignee').value = '';
    triggerNotificationToast('Assignment successfully updated.');
    // Real-time alert: notify the assignee directly if they're a registered account,
    // plus anyone @mentioned inside the instruction text itself.
    const assigneeAccount = registeredUsersDB.find(u => u.name.toLowerCase() === targetedUser.toLowerCase());
    if (assigneeAccount && currentUser && assigneeAccount.name !== currentUser.name) {
      dispatchPing(currentUser.name, assigneeAccount.name, 'New task assigned to you: "' + payloadInstruction + '"');
    }
    scanAndNotifyMentions(payloadInstruction, 'in a task');
  });

  // Save Event
  document.getElementById('saveEventBtn').addEventListener('click', () => {
    const textNode = document.getElementById('evtName').value.trim();
    const targetDateString = document.getElementById('evtDate').value || new Date().toISOString().split('T')[0];
    const locationNote = document.getElementById('evtLocationNote') ? document.getElementById('evtLocationNote').value.trim() : '';
    if (!textNode) return triggerNotificationToast('Please specify event workspace parameters.');
    events.push({ id: Date.now(), name: textNode, date: targetDateString, completed: false, locationNote: locationNote });
    flushStateToDisk();
    generateEventsTrackerChecklist();
    document.getElementById('addEventModal').classList.remove('active');
    document.getElementById('evtName').value = '';
    if (document.getElementById('evtLocationNote')) document.getElementById('evtLocationNote').value = '';
    triggerNotificationToast('Checklist element added.');
  });

  // Save Beat
  document.getElementById('saveBeatBtn').addEventListener('click', () => {
    const bName = document.getElementById('beatName').value.trim();
    const bReporter = document.getElementById('beatReporter').value.trim() || (currentUser ? currentUser.name : 'Reporter');
    const bPriority = document.getElementById('beatPriority').value;
    const imageUplinkNode = document.getElementById('beatImgUpload').files[0];
    if (!bName) return triggerNotificationToast('Beat requires a module name.');
    if (imageUplinkNode) {
      const convertingReaderInstance = new FileReader();
      convertingReaderInstance.onloadend = () => {
        beats.push({ id: Date.now(), name: bName, reporter: bReporter, priority: bPriority, imgData: convertingReaderInstance.result });
        finalizeBeatSavingProcessing();
      };
      convertingReaderInstance.readAsDataURL(imageUplinkNode);
    } else {
      beats.push({ id: Date.now(), name: bName, reporter: bReporter, priority: bPriority, imgData: '' });
      finalizeBeatSavingProcessing();
    }
  });

  function finalizeBeatSavingProcessing() {
    flushStateToDisk();
    generateBeatsGrid();
    document.getElementById('addBeatModal').classList.remove('active');
    document.getElementById('beatName').value = '';
    document.getElementById('beatReporter').value = '';
    document.getElementById('beatImgUpload').value = '';
    triggerNotificationToast('Coverage module saved.');
  }

  // Save User
  document.getElementById('saveUserBtn').addEventListener('click', createNewUser);

  // Save Source
  document.getElementById('saveSourceBtn').addEventListener('click', () => {
    const name = document.getElementById('sourceName').value.trim();
    const beat = document.getElementById('sourceBeat').value.trim();
    const contact = document.getElementById('sourceContact').value.trim();
    const reliability = document.getElementById('sourceReliability').value;
    const notes = document.getElementById('sourceNotes').value.trim();
    if (!name) return triggerNotificationToast('Source name is required.');
    sources.push({
      id: Date.now(), name: name, beat: beat, contact: contact,
      reliability: reliability, notes: notes,
      createdBy: currentUser ? currentUser.name : 'Unknown',
      createdAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    });
    flushStateToDisk();
    generateSourcesGrid();
    document.getElementById('addSourceModal').classList.remove('active');
    document.getElementById('sourceName').value = '';
    document.getElementById('sourceBeat').value = '';
    document.getElementById('sourceContact').value = '';
    document.getElementById('sourceNotes').value = '';
    triggerNotificationToast('Source added to vault.');
  });

  // Source search
  document.getElementById('sourceSearchInput')?.addEventListener('input', (e) => {
    sourceSearchQuery = e.target.value;
    generateSourcesGrid();
  });

  // Calendar navigation
  document.getElementById('calPrevMonth')?.addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    generateDeadlineCalendarGrid();
  });
  document.getElementById('calNextMonth')?.addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    generateDeadlineCalendarGrid();
  });

  // Export projects CSV
  document.getElementById('quickExportCSVBtn')?.addEventListener('click', exportProjectsCSV);

  // Generate Activity Summary report
  document.getElementById('generateActivitySummaryBtn')?.addEventListener('click', generateActivitySummaryReport);

  // Sign out
  document.getElementById('signOutBtn').addEventListener('click', () => {
    localStorage.removeItem('jcompass_user');
    currentUser = null;
    if (supabaseClient && realtimePingsChannel) {
      supabaseClient.removeChannel(realtimePingsChannel);
      realtimePingsChannel = null;
    }
    const barStack = document.getElementById('notificationBarStack');
    if (barStack) barStack.innerHTML = '';
    triggerNotificationToast('Session terminated safely. Resetting workspace profiles...');
    setTimeout(() => { location.reload(); }, 600);
  });

  // Profile modal listeners
  document.getElementById('profileProgressInput')?.addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('profileProgressBar').style.width = val + '%';
    document.getElementById('profileProgressLabel').innerText = val + '%';
  });
  document.querySelectorAll('.priority-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.priority-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.getElementById('profileSaveBtn')?.addEventListener('click', saveProjectProfile);
  document.getElementById('profileArchiveBtn')?.addEventListener('click', () => {
    archiveProject(activeProfileId);
    document.getElementById('projectProfileModal').classList.remove('active');
  });
  document.getElementById('profileRequestArchiveBtn')?.addEventListener('click', () => {
    requestArchiveProject(activeProfileId);
  });
  document.getElementById('profileDeleteBtn')?.addEventListener('click', () => {
    document.getElementById('projectProfileModal').classList.remove('active');
    setTimeout(() => deleteProject(activeProfileId), 200);
  });
  document.getElementById('profileStatusSelect')?.addEventListener('change', (e) => {
    const statusEl = document.getElementById('profileModalStatus');
    const val = e.target.value;
    let cls = 'status-active';
    if (val === 'IN REVIEW') cls = 'status-review';
    if (val === 'FILED') cls = 'status-filed';
    if (val === 'ON HOLD') cls = 'status-on-hold';
    if (val === 'PUBLISHED') cls = 'status-published';
    statusEl.innerText = val;
    statusEl.className = 'status-badge ' + cls;
  });

  // Archive search
  document.getElementById('archiveSearchInput')?.addEventListener('input', (e) => {
    archiveSearchQuery = e.target.value;
    generateArchiveGrid();
    generateArchiveReportsGrid();
    generateActivitySummaryGrid();
  });
});
