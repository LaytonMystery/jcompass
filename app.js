/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  JOURNALIST'S COMPASS v2.0 — Newsroom Operations Terminal           ║
 * ║  A complete newsroom management dashboard for journalists            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 1: CONFIGURATION & ENVIRONMENT
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://odqfqaywzwvxkvqptzxo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6CWGOKOIj4aXmRpidG6dVA_nYvcctoP';

let supabaseClient = null;
let realtimePingsChannel = null;
let realtimeAttendanceChannel = null;

// ── Supabase Client Management ────────────────────────────────────────

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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 2: SAFE STORAGE UTILITIES
// ═══════════════════════════════════════════════════════════════════════

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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 3: APPLICATION STATE
// ═══════════════════════════════════════════════════════════════════════

// ── Session & UI State ────────────────────────────────────────────────

let currentUser = safeLoadJSON('jcompass_user', null);
let currentFilter = 'ALL';
let searchQuery = '';
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let sourceSearchQuery = '';
let attendanceSearchQuery = '';
let archiveSearchQuery = '';
let activeProfileId = null;

// ── Data Stores ───────────────────────────────────────────────────────

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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 4: PERSISTENCE LAYER
// ═══════════════════════════════════════════════════════════════════════

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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 5: SUPABASE REMOTE SYNC
// ═══════════════════════════════════════════════════════════════════════

// ── Pings / Announcements Sync ────────────────────────────────────────

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

// ── Attendance Sync ───────────────────────────────────────────────────

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

// ── Full Data Sync ────────────────────────────────────────────────────

async function syncAllDataFromSupabase() {
  if (!supabaseClient) return;

  const syncMap = [
    { table: 'projects',    store: 'projects',    mapper: p => ({ id: p.id, title: p.title, category: p.category, deadline: p.deadline, status: p.status, priority: p.priority, progress: p.progress, reporter: p.reporter || '', notes: p.notes || '', tags: p.tags || '', archived: p.archived || false }) },
    { table: 'assignments', store: 'assignments', mapper: a => ({ id: a.id, title: a.title, assignee: a.assignee || '' }) },
    { table: 'beats',       store: 'beats',       mapper: b => ({ id: b.id, name: b.name, reporter: b.reporter || '', priority: b.priority || 'MEDIUM', imgData: b.img_data || '' }) },
    { table: 'sources',     store: 'sources',     mapper: s => ({ id: s.id, name: s.name, beat: s.beat || '', contact: s.contact || '', reliability: s.reliability || 'MEDIUM', notes: s.notes || '', createdBy: s.created_by || 'Unknown' }) },
    { table: 'events',      store: 'events',      mapper: e => ({ id: e.id, name: e.name, date: e.date, completed: e.completed || false, archived: e.archived || false, locationNote: e.location_note || '' }) },
    { table: 'users',       store: 'registeredUsersDB', mapper: u => ({ name: u.name, pass: u.pass, role: u.role, code: u.code, created: new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }) }
  ];

  for (const { table, store, mapper } of syncMap) {
    try {
      const { data } = await supabaseClient.from(table).select('*');
      if (data && data.length > 0) {
        window[store] = data.map(mapper);
      }
    } catch (err) {
      console.error('Sync ' + table + ' failed:', err);
    }
  }

  flushStateToDisk();
  rebuildApplicationDOMViews();
  console.log('✅ All data synced from Supabase');
}


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 6: NOTIFICATIONS & PINGS
// ═══════════════════════════════════════════════════════════════════════

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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 7: AUTHENTICATION & SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

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
    
    // Set OneSignal user ID
    setOneSignalUser(matchUser.name);
    
    enforceSessionGuard();
    triggerNotificationToast('Welcome ' + currentUser.name);
  } else {
    if (errorNode) errorNode.style.display = 'block';
  }
}

function evaluateClearancePermissions() {
  if (!currentUser) return;

  // Update UI elements
  const targetLabel = document.getElementById('displayName');
  const targetRole = document.getElementById('displayRole');
  const avatarBadge = document.getElementById('avatarBadgeIcon');
  const sidebarInput = document.getElementById('sidebarNameInput');

  if (targetLabel) targetLabel.innerText = currentUser.name;
  if (targetRole) targetRole.innerText = currentUser.role;
  if (avatarBadge) avatarBadge.innerText = currentUser.code;
  if (sidebarInput) sidebarInput.value = currentUser.name;

  // Admin-only navigation
  document.querySelectorAll('.admin-only-nav').forEach(el => {
    el.style.display = (currentUser.role === 'ADMIN') ? '' : 'none';
  });

  // Ping target dropdown
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
//  SECTION 8: MASTER VIEW REBUILDER
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
  generateArchiveReportsGrid();
  generateActivitySummaryGrid();
  generateSourcesGrid();
  generateUsersTable();
  generateNotificationBar();
}


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 9: DASHBOARD & PROJECTS
// ═══════════════════════════════════════════════════════════════════════

// ── Dashboard Statistics ──────────────────────────────────────────────

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

// ── Project Grid ──────────────────────────────────────────────────────

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

// ── Project Profile Modal ─────────────────────────────────────────────

function openProjectProfile(projectId) {
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  activeProfileId = projectId;

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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 10: ANNOUNCEMENTS & STAFF
// ═══════════════════════════════════════════════════════════════════════

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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 11: BEATS & ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════════════

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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 12: EVENTS & CALENDAR
// ═══════════════════════════════════════════════════════════════════════

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
//  SECTION 13: ATTENDANCE & GEO-TRACKING
// ═══════════════════════════════════════════════════════════════════════

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
      lat: lat.toFixed(6), lon: lon.toFixed(6), accuracy: Math.round(accuracy),
      location: locationLabel, note: note, timestamp: now.toISOString()
    };

    attendanceLogs.unshift(entry);
    saveAttendanceLogs();
    publishAttendanceRemote(entry);
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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 14: ARCHIVES & REPORTS
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
      '<div class="card-category">' + p.category + '</div>' +
      '<div class="card-title">' + p.title + '</div>' +
      '<div class="card-meta"><span>📅 ' + p.deadline + '</span><span>' + p.status + '</span></div>';
    container.appendChild(card);
  });
}

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
    card.innerHTML = '<div class="card-title">' + r.title + '</div><div style="font-size:0.85rem;color:var(--text-muted);">' + r.summary + '</div>';
    container.appendChild(card);
  });
}

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
    card.innerHTML = '<div class="card-title">' + r.title + '</div><div style="font-size:0.85rem;color:var(--text-muted);">' + r.summary + '</div>';
    container.appendChild(card);
  });
}

function generateActivitySummaryReport() {
  if (!currentUser || currentUser.role !== 'ADMIN') return;
  const activeProjects = projects.filter(p => !p.archived).length;
  const archivedCount = projects.filter(p => p.archived).length;
  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayCheckins = attendanceLogs.filter(l => l.date === todayStr).length;
  const summaryText = 'Active: ' + activeProjects + ', Archived: ' + archivedCount + ', Check-ins today: ' + todayCheckins;

  activitySummaries.push({
    id: Date.now(), title: 'Summary ' + new Date().toLocaleDateString(),
    summary: summaryText, closedBy: currentUser.name,
    timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  });
  flushStateToDisk();
  generateActivitySummaryGrid();
  triggerNotificationToast('Summary generated.');
}


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 15: SOURCE VAULT
// ═══════════════════════════════════════════════════════════════════════

function generateSourcesGrid() {
  const container = document.getElementById('sourcesGrid');
  if (!container) return;
  container.innerHTML = '';

  const subset = sources.filter(s =>
    s.name.toLowerCase().includes(sourceSearchQuery.toLowerCase()) ||
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


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 16: USER MANAGEMENT (ADMIN)
// ═══════════════════════════════════════════════════════════════════════

function generateUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  registeredUsersDB.forEach(user => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    tr.innerHTML =
      '<td style="padding:0.9rem 1.25rem;font-weight:800;">' + user.code + '</td>' +
      '<td style="padding:0.9rem 1.25rem;font-weight:600;">' + user.name + '</td>' +
      '<td style="padding:0.9rem 1.25rem;">' + user.role + '</td>' +
      '<td style="padding:0.9rem 1.25rem;color:var(--text-muted);">' + (user.created || '—') + '</td>' +
      '<td style="padding:0.9rem 1.25rem;text-align:right;">—</td>';
    tbody.appendChild(tr);
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
  triggerNotificationToast('Account "' + name + '" created.');
}


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 17: NOTIFICATION BAR
// ═══════════════════════════════════════════════════════════════════════

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

  const notices = [];
  if (overdue.length > 0) {
    notices.push({ id: 'overdue-' + overdue.length, type: 'danger', icon: '⚠', text: overdue.length + ' project(s) overdue.', actionLabel: 'View', actionPage: 'dashboard' });
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
//  SECTION 18: APPLICATION INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════

function initializeApp() {
  // ── Login ──────────────────────────────────────────────────────────
  const loginBtn = document.getElementById('loginSubmitBtn');
  if (loginBtn) loginBtn.onclick = processCredentialsAuthentication;

  ['username', 'password'].forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.onkeydown = function(e) {
        if (e.key === 'Enter') processCredentialsAuthentication();
      };
    }
  });

  // ── Supabase ───────────────────────────────────────────────────────
  initSupabaseClient();

  // ── Theme ──────────────────────────────────────────────────────────
  const savedTheme = localStorage.getItem('jcompass_theme') || 'forest';
  document.body.setAttribute('data-theme-profile', savedTheme);

  // ── Session ────────────────────────────────────────────────────────
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
      if (breadcrumb) breadcrumb.innerText = nav.querySelector('.nav-label').innerText;
      if (targetPage === 'attend') initAttendancePage();
      if (targetPage === 'calendar') generateDeadlineCalendarGrid();
    });
  });

  // ── Menu Toggle ────────────────────────────────────────────────────
  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('active');
    });
  }

  // ── Sign Out ───────────────────────────────────────────────────────
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      localStorage.removeItem('jcompass_user');
      location.reload();
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
      generateAnnouncementsStream();
    });
  }

  // ── Attendance ─────────────────────────────────────────────────────
  const attendanceBtn = document.getElementById('markAttendanceBtn');
  if (attendanceBtn) attendanceBtn.addEventListener('click', processFieldTelemetryMarking);

  // ── Create Project ─────────────────────────────────────────────────
  const createProjectBtn = document.getElementById('createProjectBtn');
  if (createProjectBtn) {
    createProjectBtn.addEventListener('click', () => {
      const title = document.getElementById('newTitle').value.trim();
      const category = document.getElementById('newCategory').value;
      const deadline = document.getElementById('newDeadline').value || new Date().toISOString().split('T')[0];
      if (!title) return;
      projects.push({
        id: Date.now(), title: title, category: category, deadline: deadline,
        status: 'ACTIVE', priority: 'MEDIUM', progress: 0, reporter: currentUser ? currentUser.name : '',
        notes: '', tags: '', archived: false
      });
      flushStateToDisk();
      rebuildApplicationDOMViews();
      document.getElementById('newProjectModal').classList.remove('active');
      document.getElementById('newTitle').value = '';
    });
  }

  // ── Save User ──────────────────────────────────────────────────────
  const saveUserBtn = document.getElementById('saveUserBtn');
  if (saveUserBtn) saveUserBtn.addEventListener('click', createNewUser);

  // ── Save Source ────────────────────────────────────────────────────
  const saveSourceBtn = document.getElementById('saveSourceBtn');
  if (saveSourceBtn) {
    saveSourceBtn.addEventListener('click', () => {
      const name = document.getElementById('sourceName').value.trim();
      const beat = document.getElementById('sourceBeat').value.trim();
      const contact = document.getElementById('sourceContact').value.trim();
      const reliability = document.getElementById('sourceReliability').value;
      const notes = document.getElementById('sourceNotes').value.trim();
      if (!name) return;
      sources.push({
        id: Date.now(), name: name, beat: beat, contact: contact,
        reliability: reliability, notes: notes, createdBy: currentUser ? currentUser.name : 'Unknown'
      });
      flushStateToDisk();
      generateSourcesGrid();
      document.getElementById('addSourceModal').classList.remove('active');
    });
  }

  // ── Notifications ──────────────────────────────────────────────────
  refreshNotificationPermissionUI();
  const notifyBtn = document.getElementById('enableNotificationsBtn');
  if (notifyBtn) notifyBtn.addEventListener('click', requestNotificationPermission);

  // ── Calendar Navigation ────────────────────────────────────────────
  const prevBtn = document.getElementById('calPrevMonth');
  const nextBtn = document.getElementById('calNextMonth');
  if (prevBtn) prevBtn.addEventListener('click', () => { calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; } generateDeadlineCalendarGrid(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; } generateDeadlineCalendarGrid(); });

  // ── Search Inputs ──────────────────────────────────────────────────
  const searchInput = document.getElementById('dashboardSearchInput');
  if (searchInput) searchInput.addEventListener('input', (e) => { searchQuery = e.target.value; generateProjectDashboard(); });

  const sourceSearch = document.getElementById('sourceSearchInput');
  if (sourceSearch) sourceSearch.addEventListener('input', (e) => { sourceSearchQuery = e.target.value; generateSourcesGrid(); });

  const attSearch = document.getElementById('attendanceSearchInput');
  if (attSearch) attSearch.addEventListener('input', (e) => { attendanceSearchQuery = e.target.value; renderAttendanceTable(); });

  // ── Activity Summary ───────────────────────────────────────────────
  const genSummaryBtn = document.getElementById('generateActivitySummaryBtn');
  if (genSummaryBtn) genSummaryBtn.addEventListener('click', generateActivitySummaryReport);

  // ── Save Profile ───────────────────────────────────────────────────
  const saveProfileBtn = document.getElementById('profileSaveBtn');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProjectProfile);

  // ── Modal Close Buttons ────────────────────────────────────────────
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      document.getElementById(modalId).classList.remove('active');
    });
  });

  // ── Modal Open Buttons ─────────────────────────────────────────────
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
    if (btn) btn.addEventListener('click', () => document.getElementById(modalId).classList.add('active'));
  });

  // ── Save Beat ──────────────────────────────────────────────────────
  const saveBeatBtn = document.getElementById('saveBeatBtn');
  if (saveBeatBtn) {
    saveBeatBtn.addEventListener('click', () => {
      const name = document.getElementById('beatName').value.trim();
      const reporter = document.getElementById('beatReporter').value.trim() || (currentUser ? currentUser.name : 'Reporter');
      const priority = document.getElementById('beatPriority').value;
      if (!name) return;
      beats.push({ id: Date.now(), name: name, reporter: reporter, priority: priority, imgData: '' });
      flushStateToDisk();
      generateBeatsGrid();
      document.getElementById('addBeatModal').classList.remove('active');
    });
  }

  // ── Save Assignment ────────────────────────────────────────────────
  const saveAssignmentBtn = document.getElementById('saveAssignmentBtn');
  if (saveAssignmentBtn) {
    saveAssignmentBtn.addEventListener('click', () => {
      const title = document.getElementById('asgTitle').value.trim();
      const assignee = document.getElementById('asgAssignee').value.trim() || 'General Desk';
      if (!title) return;
      assignments.push({ id: Date.now(), title: title, assignee: assignee });
      flushStateToDisk();
      generateAssignmentsGrid();
      document.getElementById('addAssignmentModal').classList.remove('active');
    });
  }

  // ── Save Event ─────────────────────────────────────────────────────
  const saveEventBtn = document.getElementById('saveEventBtn');
  if (saveEventBtn) {
    saveEventBtn.addEventListener('click', () => {
      const name = document.getElementById('evtName').value.trim();
      const date = document.getElementById('evtDate').value || new Date().toISOString().split('T')[0];
      if (!name) return;
      events.push({ id: Date.now(), name: name, date: date, completed: false });
      flushStateToDisk();
      generateEventsTrackerChecklist();
      document.getElementById('addEventModal').classList.remove('active');
    });
  }

  // ── Save Name ──────────────────────────────────────────────────────
  const saveNameBtn = document.getElementById('saveNameBtn');
  if (saveNameBtn) {
    saveNameBtn.addEventListener('click', () => {
      const input = document.getElementById('sidebarNameInput');
      if (!input || !currentUser) return;
      const newName = input.value.trim();
      if (!newName) return;
      currentUser.name = newName;
      localStorage.setItem('jcompass_user', JSON.stringify(currentUser));
      evaluateClearancePermissions();
      triggerNotificationToast('Name updated.');
    });
  }

  // ── Theme Buttons ──────────────────────────────────────────────────
  document.querySelectorAll('.theme-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-chip-btn').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const theme = btn.getAttribute('data-theme');
      document.body.setAttribute('data-theme-profile', theme);
      localStorage.setItem('jcompass_theme', theme);
    });
  });

  // ── Export CSV ─────────────────────────────────────────────────────
  const exportBtn = document.getElementById('exportAttendanceBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (attendanceLogs.length === 0) { triggerNotificationToast('No attendance data.'); return; }
      const csv = ['Reporter,Role,Date,Time,Lat,Lon,Accuracy,Location,Note'].concat(
        attendanceLogs.map(l => [l.reporter, l.role, l.date, l.time, l.lat, l.lon, l.accuracy, l.location, l.note].join(','))
      ).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'attendance.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  console.log('✅ JCompass initialized successfully');
}


// ═══════════════════════════════════════════════════════════════════════
//  SECTION 19: BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

//
//
//

// Settings Gear Button
const settingsGearBtn = document.getElementById('settingsGearBtn');
if (settingsGearBtn) {
  settingsGearBtn.addEventListener('click', () => {
    const tray = document.getElementById('controlTray');
    const trayOverlay = document.getElementById('controlTrayOverlay');
    if (tray) tray.classList.add('active');
    if (trayOverlay) trayOverlay.classList.add('active');
  });
}

// Settings Sidebar Button
const settingsSidebarBtn = document.getElementById('settingsSidebarBtn');
if (settingsSidebarBtn) {
  settingsSidebarBtn.addEventListener('click', () => {
    const tray = document.getElementById('controlTray');
    const trayOverlay = document.getElementById('controlTrayOverlay');
    if (tray) tray.classList.add('active');
    if (trayOverlay) trayOverlay.classList.add('active');
  });
}

// User Chip Click (existing)
const userChip = document.getElementById('userAvatarBtn');
if (userChip) {
  userChip.addEventListener('click', () => {
    const tray = document.getElementById('controlTray');
    const trayOverlay = document.getElementById('controlTrayOverlay');
    if (tray) tray.classList.add('active');
    if (trayOverlay) trayOverlay.classList.add('active');
  });
}

// Close Tray
const trayClose = document.getElementById('controlTrayCloseBtn');
const trayOverlay = document.getElementById('controlTrayOverlay');
if (trayClose) {
  trayClose.addEventListener('click', () => {
    const tray = document.getElementById('controlTray');
    if (tray) tray.classList.remove('active');
    if (trayOverlay) trayOverlay.classList.remove('active');
  });
}
if (trayOverlay) {
  trayOverlay.addEventListener('click', () => {
    const tray = document.getElementById('controlTray');
    if (tray) tray.classList.remove('active');
    trayOverlay.classList.remove('active');
  });
}
// ===================== ONESIGNAL PUSH NOTIFICATIONS =====================
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
    
    // If targeting specific user, use their name as external ID
    if (targetUserName) {
      notificationData.include_external_user_ids = [targetUserName];
    } else {
      notificationData.included_segments = ['Subscribed Users'];
    }
    
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + ONESIGNAL_API_KEY
      },
      body: JSON.stringify(notificationData)
    });
    
    return await response.json();
  } catch (err) {
    console.error('Push notification failed:', err);
  }
}

// Update dispatchPing to send push notifications
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
  
  // Send push notification via OneSignal
  if (target === 'ALL') {
    sendPushNotification(
      '📰 Newsroom Broadcast',
      sender + ': ' + text
    );
  } else {
    sendPushNotification(
      '📌 Direct Ping from ' + sender,
      text,
      target // Send to specific user
    );
  }
}
// Set external user ID when logged in
async function setOneSignalUser(userName) {
  if (window.OneSignal) {
    try {
      await window.OneSignal.login(userName);
      console.log('OneSignal user set:', userName);
    } catch (err) {
      console.error('OneSignal login failed:', err);
    }
  }
}