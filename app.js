/**
 * Journalist's Compass v2.0 — Newsroom Operations Terminal
 * Complete version with all functions
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
    try { localStorage.removeItem(key); } catch (e) { }
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
let activeProfileId = null;

let registeredUsersDB = safeLoadJSON('jcompass_accounts_db', null);
if (!registeredUsersDB || registeredUsersDB.length === 0) {
  registeredUsersDB = [
    { name: 'Admin Account', pass: 'admin123', role: 'ADMIN', code: 'AA', created: 'Aug 11, 2026' },
    { name: 'Staff Reporter', pass: 'staff123', role: 'STAFF', code: 'SR', created: 'Aug 11, 2026' }
  ];
  localStorage.setItem('jcompass_accounts_db', JSON.stringify(registeredUsersDB));
}

let projects = safeLoadJSON('jcompass_projects', [
  { id: 101, title: 'Global Supply Route Friction Analytics', category: 'INVESTIGATIVE', deadline: '2026-08-12', status: 'ACTIVE', priority: 'HIGH', progress: 65, reporter: 'Staff Reporter', notes: '', tags: 'exclusive,urgent', archived: false },
  { id: 102, title: 'Mayoral Campaign Expenditure Audits', category: 'BREAKING', deadline: '2026-08-20', status: 'IN REVIEW', priority: 'HIGH', progress: 80, reporter: 'Staff Reporter', notes: '', tags: 'follow-up', archived: false },
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

// ===================== SUPABASE SYNC =====================
async function syncRemotePings() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('pings').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    (data || []).forEach(row => mergeIncomingPing(row, false));
    rebuildApplicationDOMViews();
  } catch (err) {
    console.error('Failed to load pings:', err);
  }
  if (realtimePingsChannel) supabaseClient.removeChannel(realtimePingsChannel);
  realtimePingsChannel = supabaseClient
    .channel('pings-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings' }, (payload) => {
      mergeIncomingPing(payload.new, true);
      flushStateToDisk();
      rebuildApplicationDOMViews();
    })
    .subscribe();
}

async function syncRemoteAttendance() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('attendance').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    (data || []).forEach(row => {
      const localId = 'remote-' + row.id;
      if (!attendanceLogs.some(a => a.id === localId)) {
        attendanceLogs.push({
          id: localId, reporter: row.reporter, role: row.role, date: row.date, time: row.time,
          lat: row.lat, lon: row.lon, accuracy: row.accuracy, location: row.location,
          note: row.note || '', timestamp: row.timestamp_iso
        });
      }
    });
    saveAttendanceLogs();
    renderAttendanceTable();
    updateAttendanceStats();
  } catch (err) {
    console.error('Failed to load attendance:', err);
  }
  if (realtimeAttendanceChannel) supabaseClient.removeChannel(realtimeAttendanceChannel);
  realtimeAttendanceChannel = supabaseClient
    .channel('attendance-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, (payload) => {
      const row = payload.new;
      const localId = 'remote-' + row.id;
      if (!attendanceLogs.some(a => a.id === localId)) {
        attendanceLogs.unshift({
          id: localId, reporter: row.reporter, role: row.role, date: row.date, time: row.time,
          lat: row.lat, lon: row.lon, accuracy: row.accuracy, location: row.location,
          note: row.note || '', timestamp: row.timestamp_iso
        });
        saveAttendanceLogs();
        renderAttendanceTable();
        updateAttendanceStats();
      }
    })
    .subscribe();
}

function mergeIncomingPing(row, isLive) {
  const localId = 'remote-' + row.id;
  if (announcements.some(a => a.id === localId)) return;
  const ann = {
    id: localId, sender: row.sender, target: row.target, text: row.message,
    timestamp: new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };
  announcements.push(ann);
  if (isLive) notifyIncomingPing(ann);
}

async function publishPingRemote(payload) {
  const { error } = await supabaseClient.from('pings').insert({
    sender: payload.sender, target: payload.target, message: payload.text
  });
  if (error) throw error;
}

async function publishAttendanceRemote(entry) {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient.from('attendance').insert({
      reporter: entry.reporter, role: entry.role, date: entry.date, time: entry.time,
      lat: parseFloat(entry.lat), lon: parseFloat(entry.lon), accuracy: entry.accuracy,
      location: entry.location, note: entry.note || '', timestamp_iso: entry.timestamp
    });
    if (error) throw error;
  } catch (err) {
    console.error('Failed to publish attendance:', err);
  }
}

// ===================== NOTIFICATIONS =====================
function refreshNotificationPermissionUI() {
  const btn = document.getElementById('enableNotificationsBtn');
  const label = document.getElementById('notificationStatusLabel');
  if (!btn || !label || !('Notification' in window)) {
    if (label) label.textContent = 'Push alerts not supported in this browser.';
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
    label.textContent = 'Notifications blocked in browser settings.';
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
    const n = new Notification(title, { body: body, icon: 'https://cdn-icons-png.flaticon.com/512/148/148813.png' });
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

function dispatchPing(sender, target, text) {
  const payload = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    sender: sender, target: target, text: text,
    timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };
  if (supabaseClient) {
    publishPingRemote(payload).catch(err => console.error('Failed to publish ping:', err));
  } else {
    announcements.push(payload);
    flushStateToDisk();
    generateAnnouncementsStream();
    notifyIncomingPing(payload);
  }
}

// ===================== AUTH =====================
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
    triggerNotificationToast('Welcome ' + currentUser.name);
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

// ===================== REBUILD ALL VIEWS =====================
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

// ===================== DASHBOARD =====================
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
    const tagsHtml = p.tags ? p.tags.split(',').filter(t => t.trim()).map(t => '<span class="card-tag">' + t.trim() + '</span>').join('') : '';
    const reporterHtml = p.reporter ? '<div class="card-reporter-chip"><div class="mini-avatar">' + p.reporter.split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase() + '</div><span>' + p.reporter + '</span></div>' : '';
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;"><div class="card-category">' + p.category + '</div><span style="font-size:0.7rem;font-weight:800;">' + (p.priority || 'MEDIUM') + '</span></div>' +
      '<div class="card-title">' + p.title + '</div>' +
      reporterHtml +
      (tagsHtml ? '<div class="card-tags">' + tagsHtml + '</div>' : '') +
      '<div class="card-meta"><span>📅 ' + p.deadline + '</span><span class="status-badge ' + statusClass + '">' + p.status + '</span></div>' +
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

function generateAnnouncementsStream() {
  const container = document.getElementById('announcementsStreamContainer');
  if (!container) return;
  container.innerHTML = '';
  const reversed = [...announcements].reverse();
  reversed.forEach(ann => {
    const isPingedToMe = currentUser && ann.target === currentUser.name;
    const isBroadcastAll = ann.target === 'ALL';
    if (!isBroadcastAll && !isPingedToMe && currentUser.role !== 'ADMIN') return;
    const node = document.createElement('div');
    node.className = 'announcement-node' + (isPingedToMe ? ' pinged' : '');
    node.innerHTML =
      '<div class="announcement-meta"><span class="announcement-badge-alert">' + (isBroadcastAll ? 'NEWS FLASH' : 'DIRECT PING') + '</span><span>By <b>' + ann.sender + '</b></span><span>•</span><span>' + ann.timestamp + '</span></div>' +
      '<div class="announcement-body">' + ann.text + '</div>';
    container.appendChild(node);
  });
  if (container.children.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">No announcements.</div>';
  }
}

function generateStaffDirectory() {
  const container = document.getElementById('staffDirectoryList');
  if (!container) return;
  container.innerHTML = '';
  registeredUsersDB.forEach(user => {
    const row = document.createElement('div');
    row.className = 'staff-directory-row' + (user.role === 'ADMIN' ? ' role-admin' : '');
    row.innerHTML =
      '<div class="staff-info-block"><div class="staff-avatar-mini">' + user.code + '</div><div class="staff-details"><span class="staff-row-name">' + user.name + '</span><span class="staff-row-role">' + user.role + '</span></div></div>';
    container.appendChild(row);
  });
}

// ===================== PROJECT PROFILE =====================
function openProjectProfile(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  activeProfileId = projectId;
  const isAdmin = currentUser && currentUser.role === 'ADMIN';
  document.getElementById('profileModalCategory').innerText = p.category;
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
  flushStateToDisk();
  rebuildApplicationDOMViews();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast('Project profile saved.');
}

function archiveProject(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  p.archived = true;
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast('Project archived.');
}

function deleteProject(projectId) {
  if (!confirm('Delete this project?')) return;
  projects = projects.filter(x => x.id !== projectId);
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast('Project deleted.');
}

function requestArchiveProject(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  archiveRequests.push({
    id: Date.now(), projectId: projectId, projectTitle: p.title,
    requester: currentUser.name, timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), status: 'PENDING'
  });
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast('Archive request submitted.');
}

// ===================== BEATS =====================
function generateBeatsGrid() {
  const container = document.getElementById('beatsGrid');
  if (!container) return;
  container.innerHTML = '';
  beats.forEach(b => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<span class="priority-flag priority-' + b.priority + '">' + b.priority + '</span>' +
      '<div class="card-title">' + b.name + '</div>' +
      '<div style="font-size:0.85rem;color:var(--text-muted);">Reporter: <b>' + b.reporter + '</b></div>';
    container.appendChild(card);
  });
}

// ===================== ASSIGNMENTS =====================
function generateAssignmentsGrid() {
  const container = document.getElementById('assignmentsGrid');
  if (!container) return;
  container.innerHTML = '';
  assignments.forEach(a => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-title" style="font-size:1.05rem;">' + a.title + '</div>' +
      '<div style="font-size:0.85rem;color:var(--text-muted);">Assignee: <b>' + a.assignee + '</b></div>';
    container.appendChild(card);
  });
}

// ===================== EVENTS =====================
function generateEventsTrackerChecklist() {
  const container = document.getElementById('eventsChecklistContainer');
  if (!container) return;
  container.innerHTML = '';
  events.forEach(evt => {
    const div = document.createElement('div');
    div.className = 'event-row' + (evt.completed ? ' done' : '');
    div.innerHTML = '<div><div style="font-weight:600;">' + evt.name + '</div><div style="font-size:0.75rem;color:var(--text-muted);">' + evt.date + '</div></div>';
    container.appendChild(div);
  });
}

// ===================== CALENDAR =====================
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

// ===================== ATTENDANCE =====================
function saveAttendanceLogs() {
  localStorage.setItem('jcompass_attendance', JSON.stringify(attendanceLogs));
}

function renderAttendanceTable() {
  const tbody = document.getElementById('attendanceTableBody');
  const emptyRow = document.getElementById('attendanceEmptyRow');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr:not(#attendanceEmptyRow)')).forEach(r => r.remove());
  const subset = attendanceLogs.filter(log =>
    log.reporter.toLowerCase().includes(attendanceSearchQuery.toLowerCase()) ||
    log.date.includes(attendanceSearchQuery) ||
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
  } catch {
    return 'Location unavailable';
  }
}

function processFieldTelemetryMarking() {
  const btn = document.getElementById('markAttendanceBtn');
  const loggerNode = document.getElementById('telemetryStatus');
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
      id: Date.now(), reporter: currentUser.name, role: currentUser.role,
      date: now.toLocaleDateString('en-CA'), time: now.toLocaleTimeString('en-US', { hour12: true }),
      lat: lat.toFixed(6), lon: lon.toFixed(6), accuracy: Math.round
    }