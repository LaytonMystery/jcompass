/**
 * Journalist's Compass — Operational Authentication & Interaction Framework Engine
 */

// 1. SYSTEM IDENTITY & DATA STRUCTURES
let currentUser = JSON.parse(localStorage.getItem('jcompass_user')) || null;
let currentFilter = 'ALL';
let searchQuery = '';

let registeredUsersDB = JSON.parse(localStorage.getItem('jcompass_accounts_db')) || [
  { name: 'Admin Account', pass: 'admin123', role: 'ADMIN', code: 'AA' },
  { name: 'Staff Reporter', pass: 'staff123', role: 'STAFF', code: 'SR' }
];

let projects = JSON.parse(localStorage.getItem('jcompass_projects')) || [
<<<<<<< HEAD
  { id: 101, title: 'Global Supply Route Friction Analytics', category: 'INVESTIGATIVE', deadline: '2026-05-12', status: 'ACTIVE', priority: 'HIGH', progress: 65, reporter: 'Staff Reporter', notes: 'Key source: Trade Ministry official. Follow up on embargo docs.', tags: 'exclusive,urgent', archived: false },
  { id: 102, title: 'Mayoral Campaign Expenditure Audits', category: 'BREAKING', deadline: '2026-05-20', status: 'IN REVIEW', priority: 'HIGH', progress: 80, reporter: 'Staff Reporter', notes: 'FEC filings cross-referenced. Awaiting legal review.', tags: 'follow-up', archived: false },
  { id: 103, title: 'Local Tech Ecosystem Multi-Tier Integration', category: 'FEATURES', deadline: '2026-05-28', status: 'FILED', priority: 'MEDIUM', progress: 100, reporter: '', notes: '', tags: '', archived: false }
=======
  { id: 101, title: 'Global Supply Route Friction Analytics', category: 'INVESTIGATIVE', deadline: '2026-05-12', status: 'ACTIVE' },
  { id: 102, title: 'Mayoral Campaign Expenditure Audits', category: 'BREAKING', deadline: '2026-05-20', status: 'IN REVIEW' },
  { id: 103, title: 'Local Tech Ecosystem Multi-Tier Integration', category: 'FEATURES', deadline: '2026-05-28', status: 'FILED' }
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
];

let assignments = JSON.parse(localStorage.getItem('jcompass_assignments')) || [
  { id: 201, title: 'Interview Chief of Police regarding recent data breach anomalies', assignee: 'Staff Reporter' }
];

let beats = JSON.parse(localStorage.getItem('jcompass_beats')) || [
  { id: 301, name: 'City Hall Hallways Desk', reporter: 'Lead Editor', priority: 'HIGH', imgData: '' }
];

let events = JSON.parse(localStorage.getItem('jcompass_events')) || [
  { id: 401, name: 'Press Conference Security Briefing Room B', date: '2026-05-18', completed: false }
];

let announcements = JSON.parse(localStorage.getItem('jcompass_announcements')) || [
  { id: 501, sender: 'Admin Account', target: 'ALL', text: 'All field correspondents report telemetry logs before 1800 hours sync.', timestamp: 'May 16, 2026' }
];

<<<<<<< HEAD
let archiveRequests = JSON.parse(localStorage.getItem('jcompass_archive_requests')) || [];

=======
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
// 2. INTERNAL STATE MEMORY STORAGE INTERACTION
function flushStateToDisk() {
  localStorage.setItem('jcompass_accounts_db', JSON.stringify(registeredUsersDB));
  localStorage.setItem('jcompass_projects', JSON.stringify(projects));
  localStorage.setItem('jcompass_assignments', JSON.stringify(assignments));
  localStorage.setItem('jcompass_beats', JSON.stringify(beats));
  localStorage.setItem('jcompass_events', JSON.stringify(events));
  localStorage.setItem('jcompass_announcements', JSON.stringify(announcements));
<<<<<<< HEAD
  localStorage.setItem('jcompass_archive_requests', JSON.stringify(archiveRequests));
=======
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
}

// 3. SECURE APPLICATION SESSIONS MANAGEMENT
function enforceSessionGuard() {
  const gateOverlay = document.getElementById('authScreen');
  if (!gateOverlay) return;
  
  if (currentUser) {
    gateOverlay.style.display = 'none';
    document.body.setAttribute('data-user-clearance', currentUser.role);
    evaluateClearancePermissions();
    rebuildApplicationDOMViews();
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
    triggerNotificationToast(`Session authenticated: Welcome ${currentUser.name}`);
  } else {
    if (errorNode) errorNode.style.display = 'block';
  }
}

function processRegistrationRegistration() {
  const sName = document.getElementById('signUpName').value.trim();
  const sPass = document.getElementById('signUpPassword').value.trim();
  const sInvite = document.getElementById('signUpInvite').value.trim();
  const errNode = document.getElementById('signUpError');

  if (sName.length < 2 || sPass.length < 4) {
    if (errNode) {
      errNode.innerText = "Name or password lengths parameters insufficient.";
      errNode.style.display = "block";
    }
    return;
  }

  let resolvedRole = '';
  if (sInvite === 'ADMIN2026') resolvedRole = 'ADMIN';
  else if (sInvite === 'NEWSROOM2026') resolvedRole = 'STAFF';

  if (!resolvedRole) {
    if (errNode) {
      errNode.innerText = "Invalid security invite code signature.";
      errNode.style.display = "block";
    }
    return;
  }

  const parts = sName.split(' ');
  const codeGen = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : sName.substring(0, 2).toUpperCase();

  const isDuplicate = registeredUsersDB.some(u => u.name.toLowerCase() === sName.toLowerCase());
  if (isDuplicate) {
    if (errNode) {
      errNode.innerText = "Desk identity already exists in directory.";
      errNode.style.display = "block";
    }
    return;
  }

  registeredUsersDB.push({ name: sName, pass: sPass, role: resolvedRole, code: codeGen });
  flushStateToDisk();

  if (errNode) errNode.style.display = "none";
  
  document.getElementById('authViewSignUp').classList.remove('active');
  document.getElementById('authViewLogin').classList.add('active');
  
  document.getElementById('username').value = sName;
  document.getElementById('password').value = sPass;

  triggerNotificationToast("Cryptographic account registered. Ready for authentication.");
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

  // Build target options for selection pings inside announcement console
  const pingSelect = document.getElementById('announcePingTarget');
  if (pingSelect) {
    pingSelect.innerHTML = '<option value="ALL">@All Desks</option>';
    registeredUsersDB.forEach(u => {
      if(u.role === 'STAFF') {
        pingSelect.innerHTML += `<option value="${u.name}">⚡ Ping: ${u.name}</option>`;
      }
    });
  }
}

function rebuildApplicationDOMViews() {
  generateProjectDashboard();
  generateAnnouncementsStream();
  generateStaffDirectory();
  generateBeatsGrid();
  generateAssignmentsGrid();
  generateEventsTrackerChecklist();
  generateDeadlineCalendarGrid();
  initAttendancePage();
<<<<<<< HEAD
  generateArchiveGrid();
}

// 4. GENERATE PROJECT DASHBOARD & NEW COMPONENTS
function getUrgencyLabel(deadline) {
  if (!deadline) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(deadline); due.setHours(0,0,0,0);
  const diff = Math.ceil((due - today) / (1000*60*60*24));
  if (diff < 0) return `<span class="urgency-overdue">⚠ ${Math.abs(diff)}d overdue</span>`;
  if (diff === 0) return `<span class="urgency-overdue">⚠ Due today</span>`;
  if (diff <= 3) return `<span class="urgency-soon">⏳ ${diff}d left</span>`;
  return `<span class="urgency-ok">✓ ${diff}d left</span>`;
}

=======
}

// 4. GENERATE PROJECT DASHBOARD & NEW COMPONENTS
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
function generateProjectDashboard() {
  const container = document.getElementById('projectGrid');
  if (!container) return;
  container.innerHTML = '';

  const subset = projects.filter(item => {
<<<<<<< HEAD
    if (item.archived) return false;
=======
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
    const matchesFilter = (currentFilter === 'ALL' || item.category === currentFilter);
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

<<<<<<< HEAD
  const isAdmin = currentUser && currentUser.role === 'ADMIN';

=======
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
  if (subset.length === 0) {
    container.innerHTML = `<div class="card" style="grid-column: 1/-1; text-align:center; color: var(--text-muted);">No operational folders match criteria.</div>`;
    return;
  }

  subset.forEach(p => {
    const nodeCard = document.createElement('div');
    nodeCard.className = 'card card-interactive';
    
    let statusClass = 'status-active';
    if (p.status === 'IN REVIEW') statusClass = 'status-review';
    if (p.status === 'FILED') statusClass = 'status-filed';
<<<<<<< HEAD
    if (p.status === 'ON HOLD') statusClass = 'status-on-hold';
    if (p.status === 'PUBLISHED') statusClass = 'status-published';

    const progress = p.progress || 0;
    const priorityColors = { HIGH: '#fc8181', MEDIUM: '#fbd38d', LOW: '#9ae6b4' };
    const priorityDot = p.priority ? `<span style="color:${priorityColors[p.priority] || 'var(--text-muted)'}; font-size:0.7rem; font-weight:800;">● ${p.priority}</span>` : '';
    
    const tagsHtml = p.tags ? p.tags.split(',').filter(t => t.trim()).map(t => `<span class="card-tag">${t.trim()}</span>`).join('') : '';
    
    const reporterHtml = p.reporter ? `
      <div class="card-reporter-chip">
        <div class="mini-avatar">${p.reporter.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase()}</div>
        <span>${p.reporter}</span>
      </div>` : '';

    nodeCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="card-category">${p.category}</div>
        ${priorityDot}
      </div>
      <div class="card-title">${p.title}</div>
      ${reporterHtml}
      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
      <div>
        <div class="card-progress-bar-wrap">
          <div class="card-progress-bar" style="width:${progress}%;"></div>
        </div>
        <div style="font-size:0.68rem; color:var(--text-muted); margin-top:0.25rem; display:flex; justify-content:space-between;">
          <span>Progress</span><span>${progress}%</span>
        </div>
      </div>
      <div class="card-meta">
        <span>📅 ${p.deadline}</span>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="font-size:0.75rem;">${getUrgencyLabel(p.deadline)}</span>
          <span class="status-badge ${statusClass}">${p.status}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="card-action-btn profile-btn" data-id="${p.id}">📋 View Profile</button>
        ${isAdmin
          ? `<button class="card-action-btn archive-btn" data-id="${p.id}">🗄 Archive</button>
             <button class="card-action-btn delete-btn" data-id="${p.id}">🗑</button>`
          : (() => {
              const alreadyRequested = archiveRequests.some(r => r.projectId === p.id && r.status === 'PENDING' && r.requester === currentUser.name);
              return `<button class="card-action-btn request-archive-btn ${alreadyRequested ? 'req-pending' : ''}" data-id="${p.id}" ${alreadyRequested ? 'disabled' : ''}>
                ${alreadyRequested ? '⏳ Pending' : '📤 Req. Archive'}
              </button>`;
            })()
        }
=======

    nodeCard.innerHTML = `
      <div class="card-category">${p.category}</div>
      <div class="card-title">${p.title}</div>
      <div class="card-meta">
        <span>📅 Dead: ${p.deadline}</span>
        <span class="status-badge ${statusClass}">${p.status}</span>
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
      </div>
    `;
    container.appendChild(nodeCard);
  });
<<<<<<< HEAD

  // Attach card action listeners
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
=======
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
}

function generateAnnouncementsStream() {
  const container = document.getElementById('announcementsStreamContainer');
  if (!container) return;
  container.innerHTML = '';

  const historicalBroadcastData = [...announcements].reverse();

  historicalBroadcastData.forEach(ann => {
    const isPingedToMe = currentUser && ann.target === currentUser.name;
    const isBroadcastAll = ann.target === 'ALL';
    
    // Safety verification check: Only render if public or directed at the active profile scope
    if (!isBroadcastAll && !isPingedToMe && currentUser.role !== 'ADMIN') return;

    const node = document.createElement('div');
    node.className = `announcement-node ${isPingedToMe ? 'pinged' : ''}`;
    
    let labelTag = isBroadcastAll ? 'NEWS FLASH' : `DIRECT PING @${ann.target.toUpperCase()}`;

    node.innerHTML = `
      <div class="announcement-meta">
        <span class="announcement-badge-alert">${labelTag}</span>
        <span>Issued by <b>${ann.sender}</b></span>
        <span>•</span>
        <span>${ann.timestamp}</span>
      </div>
      <div class="announcement-body">${ann.text}</div>
    `;
    container.appendChild(node);
  });

  if (container.children.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding: 1rem; font-size:0.85rem;">No active security broadcast sheets filed.</div>`;
  }
}

function generateStaffDirectory() {
  const container = document.getElementById('staffDirectoryList');
  if (!container) return;
  container.innerHTML = '';

  registeredUsersDB.forEach(user => {
    const row = document.createElement('div');
    row.className = `staff-directory-row ${user.role === 'ADMIN' ? 'role-admin' : ''}`;
    
    row.innerHTML = `
      <div class="staff-info-block">
        <div class="staff-avatar-mini">${user.code}</div>
        <div class="staff-details">
          <span class="staff-row-name">${user.name}</span>
          <span class="staff-row-role">${user.role}</span>
        </div>
      </div>
      ${user.role === 'STAFF' ? `<button class="staff-action-link-btn" onclick="directRouteTaskTrigger('${user.name}')">Assign Task</button>` : ''}
    `;
    container.appendChild(row);
  });
}

<<<<<<< HEAD
// ============================================================
//  PROJECT PROFILE MODAL
// ============================================================
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
  statusEl.className = `status-badge ${statusClass}`;

  document.getElementById('profileModalDeadline').innerText = p.deadline || '—';
  document.getElementById('profileModalUrgency').innerHTML = getUrgencyLabel(p.deadline);

  const prog = p.progress || 0;
  document.getElementById('profileProgressBar').style.width = prog + '%';
  document.getElementById('profileProgressLabel').innerText = prog + '%';
  document.getElementById('profileProgressInput').value = prog;

  document.getElementById('profileAssignedReporter').value = p.reporter || '';
  document.getElementById('profileNotes').value = p.notes || '';
  document.getElementById('profileTags').value = p.tags || '';

  const statusSelect = document.getElementById('profileStatusSelect');
  statusSelect.value = p.status || 'ACTIVE';

  document.querySelectorAll('.priority-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === (p.priority || 'MEDIUM'));
  });

  // ── Role-based UI enforcement ──────────────────────────────────
  const editableInputs = ['profileProgressInput','profileAssignedReporter','profileNotes','profileTags','profileStatusSelect'];
  editableInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isAdmin;
  });
  document.querySelectorAll('.priority-select-btn').forEach(btn => btn.disabled = !isAdmin);

  // Save & destructive buttons: admin only
  const saveBtn   = document.getElementById('profileSaveBtn');
  const delBtn    = document.getElementById('profileDeleteBtn');
  const archBtn   = document.getElementById('profileArchiveBtn');
  const reqBtn    = document.getElementById('profileRequestArchiveBtn');

  if (saveBtn)  saveBtn.style.display  = isAdmin ? '' : 'none';
  if (delBtn)   delBtn.style.display   = isAdmin ? '' : 'none';
  if (archBtn)  archBtn.style.display  = isAdmin ? '' : 'none';

  // Staff-only: "Request Archive" button
  if (reqBtn) {
    reqBtn.style.display = isAdmin ? 'none' : '';
    // Check if this staff already submitted a pending request for this project
    const alreadyRequested = archiveRequests.some(r => r.projectId === projectId && r.status === 'PENDING' && r.requester === currentUser.name);
    reqBtn.disabled = alreadyRequested;
    reqBtn.innerText = alreadyRequested ? '⏳ Request Pending...' : '📤 Request Archive';
  }

  // Staff-only read-only notice
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
}

function archiveProject(projectId) {
  if (!currentUser || currentUser.role !== 'ADMIN') {
    triggerNotificationToast('Permission denied. Only Admins can archive projects.');
    return;
  }
  const p = projects.find(x => x.id === projectId);
  if (!p) return;
  p.archived = true;
  // Auto-resolve any pending requests for this project
  archiveRequests.forEach(r => { if (r.projectId === projectId && r.status === 'PENDING') r.status = 'APPROVED'; });
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast(`"${p.title}" moved to Archive Vault.`);
}

function requestArchiveProject(projectId) {
  if (!currentUser) return;
  const p = projects.find(x => x.id === projectId);
  if (!p) return;

  // Prevent duplicate pending request from same user
  const duplicate = archiveRequests.some(r => r.projectId === projectId && r.status === 'PENDING' && r.requester === currentUser.name);
  if (duplicate) {
    triggerNotificationToast('You already have a pending archive request for this project.');
    return;
  }

  archiveRequests.push({
    id: Date.now(),
    projectId: projectId,
    projectTitle: p.title,
    requester: currentUser.name,
    timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    status: 'PENDING'
  });
  flushStateToDisk();
  rebuildApplicationDOMViews();
  document.getElementById('projectProfileModal').classList.remove('active');
  triggerNotificationToast(`Archive request submitted for "${p.title}". Awaiting admin approval.`);
}

function approveArchiveRequest(requestId) {
  if (!currentUser || currentUser.role !== 'ADMIN') return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'APPROVED';
  archiveProject(req.projectId);
  triggerNotificationToast(`Archive request by ${req.requester} approved.`);
}

function denyArchiveRequest(requestId) {
  if (!currentUser || currentUser.role !== 'ADMIN') return;
  const req = archiveRequests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'DENIED';
  flushStateToDisk();
  rebuildApplicationDOMViews();
  triggerNotificationToast(`Archive request denied.`);
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
  triggerNotificationToast(`"${p.title}" restored to active dashboard.`);
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

// ============================================================
//  ARCHIVE GRID (ADMIN ONLY)
// ============================================================
let archiveSearchQuery = '';

function generateArchiveGrid() {
  const container = document.getElementById('archiveGrid');
  const countBadge = document.getElementById('archiveCountBadge');
  if (!container) return;
  container.innerHTML = '';

  const isAdmin = currentUser && currentUser.role === 'ADMIN';

  // Staff: show access denied wall
  if (!isAdmin) {
    container.innerHTML = `
      <div class="card" style="grid-column:1/-1; text-align:center; padding:3rem 2rem; border-color:rgba(229,62,62,0.3); background:rgba(229,62,62,0.05);">
        <div style="font-size:2.5rem; margin-bottom:1rem;">🔒</div>
        <div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700; margin-bottom:0.5rem; color:#fc8181;">Access Restricted</div>
        <div style="color:var(--text-muted); font-size:0.9rem; max-width:360px; margin:0 auto;">
          The Archive Vault is accessible to Admin personnel only. Contact your newsroom administrator for access.
        </div>
      </div>`;
    if (countBadge) countBadge.style.display = 'none';
    return;
  }

  if (countBadge) {
    countBadge.style.display = '';
    countBadge.innerText = `${projects.filter(p => p.archived).length} archived`;
  }

  // Admin: show pending archive requests panel first
  const pending = archiveRequests.filter(r => r.status === 'PENDING');
  if (pending.length > 0) {
    const reqPanel = document.createElement('div');
    reqPanel.style.cssText = 'grid-column:1/-1;';
    reqPanel.innerHTML = `
      <div class="archive-requests-panel">
        <div class="archive-req-header">
          <span>📥 Pending Archive Requests</span>
          <span class="archive-req-count">${pending.length}</span>
        </div>
        <div class="archive-req-list" id="archiveReqList"></div>
      </div>`;
    container.appendChild(reqPanel);

    const reqList = reqPanel.querySelector('#archiveReqList');
    pending.forEach(req => {
      const row = document.createElement('div');
      row.className = 'archive-req-row';
      row.innerHTML = `
        <div class="archive-req-info">
          <div style="font-weight:700; font-size:0.9rem;">${req.projectTitle}</div>
          <div style="font-size:0.78rem; color:var(--text-muted);">Requested by <b>${req.requester}</b> · ${req.timestamp}</div>
        </div>
        <div style="display:flex; gap:0.5rem; flex-shrink:0;">
          <button class="req-approve-btn" data-req-id="${req.id}">✓ Approve</button>
          <button class="req-deny-btn"    data-req-id="${req.id}">✕ Deny</button>
        </div>`;
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

    const tagsHtml = p.tags ? p.tags.split(',').filter(t => t.trim()).map(t => `<span class="card-tag">${t.trim()}</span>`).join('') : '';
    const reporterHtml = p.reporter ? `<div class="card-reporter-chip"><div class="mini-avatar">${p.reporter.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase()}</div><span>${p.reporter}</span></div>` : '';

    nodeCard.innerHTML = `
      <div class="card-category">${p.category}</div>
      <div class="card-title" style="font-size:1.05rem;">${p.title}</div>
      ${reporterHtml}
      ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
      <div class="card-meta">
        <span>📅 ${p.deadline}</span>
        <span class="status-badge ${statusClass}">${p.status}</span>
      </div>
      <div style="display:flex; gap:0.5rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.05);">
        <button class="restore-btn" data-id="${p.id}" style="flex:1;">↩ Restore</button>
        <button class="card-action-btn delete-btn" data-id="${p.id}" style="flex:0 0 auto; padding:0.4rem 0.6rem;">🗑</button>
      </div>
    `;
    container.appendChild(nodeCard);
  });

  container.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', () => restoreProject(parseInt(btn.dataset.id)));
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProject(parseInt(btn.dataset.id)));
  });
}

=======
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
window.directRouteTaskTrigger = function(targetStaffName) {
  const modal = document.getElementById('addAssignmentModal');
  if (!modal) return;
  
  // Route focus to the explicit assignment subpage
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
    id: Date.now(),
    sender: currentUser.name,
    target: targetSelect.value,
    text: input.value.trim(),
    timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };

  announcements.push(payload);
  flushStateToDisk();
  generateAnnouncementsStream();
  
  input.value = '';
  triggerNotificationToast("Broadcast alert dispatched to workspace stream.");
}

// 5. STANDARD SYSTEM INTERACTION ENGINE BINDINGS
function generateBeatsGrid() {
  const container = document.getElementById('beatsGrid');
  if (!container) return;
  container.innerHTML = '';

  beats.forEach(b => {
    const beatNode = document.createElement('div');
    beatNode.className = 'card';
    
    let imageElement = b.imgData 
      ? `<img src="${b.imgData}" class="beat-card-img" alt="Beat Visual Descriptor">` 
      : `<div class="beat-card-img" style="display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size:2rem;">📰</div>`;

    beatNode.innerHTML = `
      <span class="priority-flag priority-${b.priority}">${b.priority}</span>
      ${imageElement}
      <div class="card-title" style="margin-top:0.5rem;">${b.name}</div>
      <div style="font-size: 0.85rem; color: var(--text-muted);">Correspondent: <b>${b.reporter}</b></div>
    `;
    container.appendChild(beatNode);
  });
}

function generateAssignmentsGrid() {
  const container = document.getElementById('assignmentsGrid');
  if (!container) return;
  container.innerHTML = '';

  assignments.forEach(a => {
    const node = document.createElement('div');
    node.className = 'card card-interactive';
    
    let actionBtnHtml = currentUser && currentUser.role === 'ADMIN' 
      ? `<button class="btn btn-ghost" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="processAssignmentResolve(${a.id})">File Clear</button>`
      : `<span style="font-size:0.75rem; color:var(--accent-light); font-weight:700;">● DISPATCHED</span>`;

    node.innerHTML = `
      <div class="card-title" style="font-size:1.05rem;">${a.title}</div>
      <div style="font-size:0.85rem; color: var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
        <span>Assignee: <b>${a.assignee}</b></span>
        ${actionBtnHtml}
      </div>
    `;
    container.appendChild(node);
  });
}

window.processAssignmentResolve = function(targetId) {
  assignments = assignments.filter(a => a.id !== targetId);
  flushStateToDisk();
  generateAssignmentsGrid();
  triggerNotificationToast("Assignment directive resolved.");
};

function generateEventsTrackerChecklist() {
  const container = document.getElementById('eventsChecklistContainer');
  if (!container) return;
  container.innerHTML = '';

  if (events.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:0.9rem; padding:2rem 0;">Agenda completely cleared.</div>`;
    return;
  }

  events.forEach(evt => {
    const div = document.createElement('div');
    div.className = `event-row ${evt.completed ? 'done' : ''}`;
    div.innerHTML = `
      <div>
        <div style="font-weight:600; font-size:0.9rem;">${evt.name}</div>
        <div style="font-size:0.75rem; color: var(--text-muted);">Target Date: ${evt.date}</div>
      </div>
      <button class="event-check-btn">${evt.completed ? '✓' : '○'}</button>
    `;
    div.querySelector('.event-check-btn').addEventListener('click', () => {
      evt.completed = !evt.completed;
      flushStateToDisk();
      generateEventsTrackerChecklist();
    });
    container.appendChild(div);
  });
}

function generateDeadlineCalendarGrid() {
  const container = document.getElementById('calendarMatrixLayout');
  if (!container) return;
  container.innerHTML = '';

  const dynamicHeaderLabels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  dynamicHeaderLabels.forEach(lbl => {
    const cell = document.createElement('div');
    cell.className = 'cal-day-head';
    cell.innerText = lbl;
    container.appendChild(cell);
  });

  for (let idx = 10; idx <= 30; idx++) {
    const wrapperCell = document.createElement('div');
    wrapperCell.className = `cal-cell ${idx === 16 ? 'today' : ''}`;
    wrapperCell.innerHTML = `<div class="cal-num">${idx}</div>`;

    const targetedMatchDateString = `2026-05-${idx}`;
    projects.forEach(p => {
      if (p.deadline === targetedMatchDateString) {
        const calElementBlock = document.createElement('div');
        calElementBlock.className = 'cal-entry';
        calElementBlock.innerText = p.title;
        calElementBlock.title = p.title;
        wrapperCell.appendChild(calElementBlock);
      }
    });

    container.appendChild(wrapperCell);
  }
}

// ============================================================
//  ATTENDANCE SYSTEM — Full geo-logging ledger
// ============================================================
let attendanceLogs = JSON.parse(localStorage.getItem('jcompass_attendance')) || [];
let attendanceSearchQuery = '';

function saveAttendanceLogs() {
  localStorage.setItem('jcompass_attendance', JSON.stringify(attendanceLogs));
}

// Live clock ticker
function startLiveClock() {
  const clockEl = document.getElementById('liveClock');
  const dateEl  = document.getElementById('liveDate');
  if (!clockEl) return;

  function tick() {
    const now = new Date();
    clockEl.innerText = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dateEl.innerText  = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  tick();
  setInterval(tick, 1000);
}

// Reverse-geocode coordinates to a readable label using OSM Nominatim (free, no key needed)
async function reverseGeocodeLabel(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`, {
      headers: { 'Accept-Language': 'en' }
    });
    const data = await res.json();
    // Return suburb/city/town — whatever is most meaningful
    const a = data.address || {};
    return a.suburb || a.village || a.town || a.city || a.county || a.state || data.display_name || 'Unknown Location';
  } catch {
    return 'Location label unavailable';
  }
}

// Check if user already checked in today
function hasCheckedInToday() {
  if (!currentUser) return false;
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  return attendanceLogs.some(log => log.reporter === currentUser.name && log.date === today);
}

function processFieldTelemetryMarking() {
  const loggerNode  = document.getElementById('telemetryStatus');
  const statusBadge = document.getElementById('attendanceStatusBadge');
  const btn         = document.getElementById('markAttendanceBtn');
  if (!loggerNode || !currentUser) return;

  // Prevent double check-in on same day
  if (hasCheckedInToday()) {
    statusBadge.style.display = 'block';
    statusBadge.style.background = 'rgba(221,107,32,0.15)';
    statusBadge.style.border = '1px solid rgba(221,107,32,0.35)';
    statusBadge.style.color = '#fbd38d';
    statusBadge.innerHTML = '⚠ Already checked in today. Only one log per reporter per day.';
    return;
  }

  loggerNode.innerHTML = `<span style="color:var(--text-muted);">⏳ Acquiring GPS signal...</span>`;
  btn.disabled = true;
  btn.innerText = '⏳ Locating...';

  if (!navigator.geolocation) {
    loggerNode.innerHTML = `<span style="color:var(--danger);">✗ Geolocation API not supported on this device.</span>`;
    btn.disabled = false;
    btn.innerText = '📍 Stamp Geo-Presence';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat      = pos.coords.latitude;
      const lon      = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      const now      = new Date();

      loggerNode.innerHTML = `<span style="color:var(--text-muted);">🌐 Resolving location name...</span>`;

      const locationLabel = await reverseGeocodeLabel(lat, lon);

      // Build the log entry
      const entry = {
        id:        Date.now(),
        reporter:  currentUser.name,
        role:      currentUser.role,
        date:      now.toLocaleDateString('en-CA'),            // YYYY-MM-DD
        time:      now.toLocaleTimeString('en-US', { hour12: true }),
        lat:       lat.toFixed(6),
        lon:       lon.toFixed(6),
        accuracy:  Math.round(accuracy),
        location:  locationLabel,
        timestamp: now.toISOString()
      };

      attendanceLogs.unshift(entry); // newest first
      saveAttendanceLogs();

      // Update preview box
      document.getElementById('locationPreviewText').innerText = `${locationLabel} (±${Math.round(accuracy)}m)`;

      // Success status badge
      statusBadge.style.display = 'block';
      statusBadge.style.background = 'rgba(56,161,105,0.15)';
      statusBadge.style.border = '1px solid rgba(56,161,105,0.35)';
      statusBadge.style.color = '#9ae6b4';
      statusBadge.innerHTML = `✓ Check-in recorded at ${entry.time}`;

      loggerNode.innerHTML = `
        <span style="color:var(--success); font-weight:700;">✓ Geo-Presence Stamped</span><br>
        <span>📍 ${locationLabel}</span><br>
        <span style="color:var(--text-muted);">Lat: ${lat.toFixed(6)}° | Lon: ${lon.toFixed(6)}°</span><br>
        <span style="color:var(--text-muted);">Accuracy: ±${Math.round(accuracy)}m | ${entry.time}</span>
      `;

      btn.disabled = false;
      btn.innerText = '✓ Geo-Presence Timestamped';
      btn.style.background = 'var(--success)';

      renderAttendanceTable();
      updateAttendanceStats();
      triggerNotificationToast(`Attendance logged: ${entry.time} — ${locationLabel}`);
    },
    (err) => {
      const msgs = {
        1: 'Location permission denied. Please allow location access in your browser.',
        2: 'Position unavailable. Try again or move to an open area.',
        3: 'Location request timed out. Please try again.'
      };
      loggerNode.innerHTML = `<span style="color:var(--danger);">✗ ${msgs[err.code] || 'Location error.'}</span>`;
      btn.disabled = false;
      btn.innerText = '📍 Timestamp Geo-Presence Profile';
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

function renderAttendanceTable() {
  const tbody  = document.getElementById('attendanceTableBody');
  const emptyRow = document.getElementById('attendanceEmptyRow');
  if (!tbody) return;

  const query  = attendanceSearchQuery.toLowerCase();
  const subset = attendanceLogs.filter(log =>
    log.reporter.toLowerCase().includes(query) ||
    log.date.includes(query) ||
    log.location.toLowerCase().includes(query)
  );

  // Remove all rows except the empty placeholder
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
    tr.innerHTML = `
      <td style="padding:0.75rem 1.5rem; color:var(--text-muted); font-size:0.75rem;">${idx + 1}</td>
      <td style="padding:0.75rem 1rem; font-weight:600;">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <div style="width:28px; height:28px; background:var(--accent); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:800; flex-shrink:0;">
            ${log.reporter.split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase()}
          </div>
          ${log.reporter}
        </div>
      </td>
      <td style="padding:0.75rem 1rem; color:var(--text-muted);">
        ${isToday ? '<span style="color:var(--success); font-weight:700; font-size:0.75rem;">TODAY</span> ' : ''}
        ${log.date}
      </td>
      <td style="padding:0.75rem 1rem; font-family:monospace; font-size:0.82rem;">${log.time}</td>
      <td style="padding:0.75rem 1rem; font-family:monospace; font-size:0.8rem; color:var(--accent-light);">${log.lat}°</td>
      <td style="padding:0.75rem 1rem; font-family:monospace; font-size:0.8rem; color:var(--accent-light);">${log.lon}°</td>
      <td style="padding:0.75rem 1rem; font-size:0.8rem; color:var(--text-muted);">±${log.accuracy}m</td>
      <td style="padding:0.75rem 1rem; font-size:0.82rem; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${log.location}">📍 ${log.location}</td>
      <td style="padding:0.75rem 1rem;">
        <span style="font-size:0.7rem; font-weight:800; padding:0.2rem 0.45rem; border-radius:4px; background:${log.role === 'ADMIN' ? 'rgba(221,107,32,0.2)' : 'rgba(49,57,98,0.6)'}; color:${log.role === 'ADMIN' ? '#fbd38d' : '#cbd5e1'};">
          ${log.role}
        </span>
      </td>
      <td style="padding:0.75rem 1rem;">
        <button class="btn btn-ghost geo-map-btn" data-log-id="${log.id}"
          style="font-size:0.75rem; padding:0.25rem 0.6rem; white-space:nowrap; display:flex; align-items:center; gap:0.3rem;">
          🗺️ View
        </button>
      </td>`;
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

// Open geo map modal for a specific attendance log entry
function openGeoMapModal(logId) {
  const log = attendanceLogs.find(l => l.id === logId);
  if (!log) return;

  const lat = parseFloat(log.lat);
  const lon = parseFloat(log.lon);
  const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lon}&z=17`;
  const embedUrl = `https://maps.google.com/maps?q=${lat},${lon}&z=17&output=embed`;

  // Reporter info bar
  const infoBar = document.getElementById('geoMapReporterInfo');
  if (infoBar) {
    infoBar.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <div style="width:32px;height:32px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:800;flex-shrink:0;">
          ${log.reporter.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase()}
        </div>
        <div>
          <div style="font-weight:700; font-size:0.9rem;">${log.reporter}</div>
          <div style="font-size:0.72rem; color:var(--text-muted);">${log.role}</div>
        </div>
      </div>
      <div style="margin-left:auto; display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">
        <span style="font-size:0.78rem; background:rgba(0,0,0,0.25); padding:0.25rem 0.6rem; border-radius:6px; font-family:monospace; color:var(--accent-light);">
          ${lat.toFixed(6)}°, ${lon.toFixed(6)}°
        </span>
        <span style="font-size:0.78rem; color:var(--text-muted);">📅 ${log.date} · ${log.time}</span>
        <span style="font-size:0.78rem; color:var(--text-muted);">±${log.accuracy}m</span>
      </div>
      <div style="width:100%; font-size:0.82rem; color:var(--text-muted);">📍 ${log.location}</div>
    `;
  }

  // Set iframe embed
  const iframe = document.getElementById('geoMapIframe');
  const fallback = document.getElementById('geoMapFallback');
  if (iframe) {
    iframe.src = embedUrl;
    iframe.style.display = 'block';
    if (fallback) fallback.style.display = 'none';

    // If iframe fails to load, show fallback
    iframe.onerror = () => {
      iframe.style.display = 'none';
      if (fallback) {
        fallback.style.display = 'flex';
        document.getElementById('geoMapFallbackCoords').innerText = `${lat.toFixed(6)}°, ${lon.toFixed(6)}°`;
        document.getElementById('geoMapExternalLink').href = googleMapsUrl;
      }
    };
  }

  // Set external link
  const extLink = document.getElementById('geoMapOpenBtn');
  if (extLink) extLink.href = googleMapsUrl;

  // Show modal
  document.getElementById('geoMapModal')?.classList.add('active');
}

function exportAttendanceCSV() {
  if (attendanceLogs.length === 0) {
    triggerNotificationToast("No attendance records to export.");
    return;
  }
  const headers = ['#', 'Reporter', 'Role', 'Date', 'Time', 'Latitude', 'Longitude', 'Accuracy (m)', 'Location Label'];
  const rows = attendanceLogs.map((log, i) =>
    [i + 1, log.reporter, log.role, log.date, log.time, log.lat, log.lon, log.accuracy, `"${log.location}"`].join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `jcompass_attendance_${new Date().toLocaleDateString('en-CA')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  triggerNotificationToast("Attendance log exported as CSV.");
}

function initAttendancePage() {
  startLiveClock();
  renderAttendanceTable();
  updateAttendanceStats();

  // Re-style check-in button if already checked in today
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
      badge.innerHTML = todayLog ? `✓ Already checked in at ${todayLog.time}` : '✓ Checked in today';
    }
  }

  document.getElementById('exportAttendanceBtn')?.addEventListener('click', exportAttendanceCSV);

  // Event delegation for map view buttons in attendance table
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

  // Close geo map modal via data-close
  document.getElementById('geoMapModal')?.querySelectorAll('[data-close="geoMapModal"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('geoMapModal').classList.remove('active');
      // Reset iframe to avoid background loading
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
    triggerNotificationToast("Attendance log cleared.");
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

// 6. INITIALIZATION & EVEN LISTENERS ROUTERS
document.addEventListener('DOMContentLoaded', () => {
  const activeProfileTheme = localStorage.getItem('jcompass_theme') || 'forest';
  document.body.setAttribute('data-theme-profile', activeProfileTheme);
  
  const targetActiveChip = document.querySelector(`.theme-chip-btn[data-theme="${activeProfileTheme}"]`);
  if (targetActiveChip) {
    document.querySelectorAll('.theme-chip-btn').forEach(c => c.classList.remove('active'));
    targetActiveChip.classList.add('active');
  }

  enforceSessionGuard();

  // Separate Workspace Tray Component Interactive Animation Controllers
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

  // Authentication Dynamic Panel State Swappers
  document.getElementById('goToSignUpBtn').addEventListener('click', () => {
    document.getElementById('authViewLogin').classList.remove('active');
    document.getElementById('authViewSignUp').classList.add('active');
  });

  document.getElementById('goToLoginBtn').addEventListener('click', () => {
    document.getElementById('authViewSignUp').classList.remove('active');
    document.getElementById('authViewLogin').classList.add('active');
  });

  document.getElementById('loginSubmitBtn').addEventListener('click', processCredentialsAuthentication);
  document.getElementById('signUpSubmitBtn').addEventListener('click', processRegistrationRegistration);
  document.getElementById('submitAnnouncementBtn').addEventListener('click', processAnnouncementPublishing);

  const items = document.querySelectorAll('.nav-item');
  items.forEach(nav => {
    nav.addEventListener('click', () => {
      items.forEach(i => i.classList.remove('active'));
      nav.classList.add('active');

      const targetPageId = nav.getAttribute('data-page');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      
      const matchTargetElement = document.getElementById(`page-${targetPageId}`);
      if (matchTargetElement) matchTargetElement.classList.add('active');

      const breadcrumb = document.getElementById('breadcrumbCurrent');
      if (breadcrumb) breadcrumb.innerText = nav.querySelector('.nav-label').innerText;
      
      document.getElementById('sidebar').classList.remove('active');

      // Init attendance page when navigated to
      if (targetPageId === 'attend') initAttendancePage();
    });
  });

  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('active');
    });
  }

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

  if (document.getElementById('markAttendanceBtn')) {
    document.getElementById('markAttendanceBtn').addEventListener('click', processFieldTelemetryMarking);
  }

  const saveNameBtn = document.getElementById('saveNameBtn');
  if (saveNameBtn) {
    saveNameBtn.addEventListener('click', () => {
      const sideInput = document.getElementById('sidebarNameInput');
      if (!sideInput || !currentUser) return;
      
      const adjustedNameValue = sideInput.value.trim();
      if (!adjustedNameValue) return triggerNotificationToast("Display name cannot be left blank.");

      currentUser.name = adjustedNameValue;
      const indexParts = adjustedNameValue.split(' ');
      currentUser.code = indexParts.length > 1 
        ? (indexParts[0][0] + indexParts[1][0]).toUpperCase()
        : adjustedNameValue.substring(0, 2).toUpperCase();

      localStorage.setItem('jcompass_user', JSON.stringify(currentUser));
      
      // Sync the modified entry inside our virtual database state array too
      const currentDbRecord = registeredUsersDB.find(u => u.pass === (currentUser.role === 'ADMIN' ? 'admin123' : 'staff123'));
      if(currentDbRecord) {
        currentDbRecord.name = currentUser.name;
        currentDbRecord.code = currentUser.code;
      }

      flushStateToDisk();
      evaluateClearancePermissions();
      generateStaffDirectory();
      triggerNotificationToast("Display identity updated successfully.");
    });
  }

  document.querySelectorAll('.theme-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-chip-btn').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      
      const selectedThemeId = btn.getAttribute('data-theme');
      document.body.setAttribute('data-theme-profile', selectedThemeId);
      localStorage.setItem('jcompass_theme', selectedThemeId);
      triggerNotificationToast(`Workspace theme changed to: ${selectedThemeId}`);
    });
  });

  const workflowMappingBridges = [
    { buttonId: 'fabBtn', windowModalId: 'newProjectModal' },
    { buttonId: 'addCalendarProjectBtn', windowModalId: 'newProjectModal' },
    { buttonId: 'addBeatBtn', windowModalId: 'addBeatModal' },
    { buttonId: 'addAssignmentBtn', windowModalId: 'addAssignmentModal' },
    { buttonId: 'addEventBtn', windowModalId: 'addEventModal' }
  ];

  workflowMappingBridges.forEach(bridge => {
    const trackingBtn = document.getElementById(bridge.buttonId);
    if (trackingBtn) {
      trackingBtn.addEventListener('click', () => {
        document.getElementById(bridge.windowModalId).classList.add('active');
      });
    }
  });

  document.querySelectorAll('[data-close]').forEach(closeControlBtn => {
    closeControlBtn.addEventListener('click', () => {
      const activeWindowTargetId = closeControlBtn.getAttribute('data-close');
      document.getElementById(activeWindowTargetId).classList.remove('active');
    });
  });

  document.getElementById('createProjectBtn').addEventListener('click', () => {
    const headline = document.getElementById('newTitle').value.trim();
    const categoricalNode = document.getElementById('newCategory').value;
    const dateLimit = document.getElementById('newDeadline').value || '2026-05-16';

    if (!headline) return triggerNotificationToast("Card requires content text.");

<<<<<<< HEAD
    projects.push({ id: Date.now(), title: headline, category: categoricalNode, deadline: dateLimit, status: 'ACTIVE', priority: 'MEDIUM', progress: 0, reporter: currentUser ? currentUser.name : '', notes: '', tags: '', archived: false });
=======
    projects.push({ id: Date.now(), title: headline, category: categoricalNode, deadline: dateLimit, status: 'ACTIVE' });
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
    flushStateToDisk();
    rebuildApplicationDOMViews();
    document.getElementById('newProjectModal').classList.remove('active');
    document.getElementById('newTitle').value = '';
    triggerNotificationToast("Project dashboard item published.");
  });

  document.getElementById('saveAssignmentBtn').addEventListener('click', () => {
    const payloadInstruction = document.getElementById('asgTitle').value.trim();
    const targetedUser = document.getElementById('asgAssignee').value.trim() || 'General Desk';

    if (!payloadInstruction) return triggerNotificationToast("Task payload content rejected empty.");

    assignments.push({ id: Date.now(), title: payloadInstruction, assignee: targetedUser });
    flushStateToDisk();
    generateAssignmentsGrid();
    document.getElementById('addAssignmentModal').classList.remove('active');
    document.getElementById('asgTitle').value = '';
    document.getElementById('asgAssignee').value = '';
    triggerNotificationToast("Assignment successfully updated.");
  });

  document.getElementById('saveEventBtn').addEventListener('click', () => {
    const textNode = document.getElementById('evtName').value.trim();
    const targetDateString = document.getElementById('evtDate').value || '2026-05-20';

    if (!textNode) return triggerNotificationToast("Please specify event workspace parameters.");

    events.push({ id: Date.now(), name: textNode, date: targetDateString, completed: false });
    flushStateToDisk();
    generateEventsTrackerChecklist();
    document.getElementById('addEventModal').classList.remove('active');
    document.getElementById('evtName').value = '';
    triggerNotificationToast("Checklist element added.");
  });

  document.getElementById('saveBeatBtn').addEventListener('click', () => {
    const bName = document.getElementById('beatName').value.trim();
    const bReporter = document.getElementById('beatReporter').value.trim() || (currentUser ? currentUser.name : 'Reporter');
    const bPriority = document.getElementById('beatPriority').value;
    const imageUplinkNode = document.getElementById('beatImgUpload').files[0];

    if (!bName) return triggerNotificationToast("Beat requires a module name.");

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
    triggerNotificationToast("Coverage module saved.");
  }

  document.getElementById('signOutBtn').addEventListener('click', () => {
    localStorage.removeItem('jcompass_user');
    currentUser = null;
    triggerNotificationToast("Session terminated safely. Resetting workspace profiles...");
    setTimeout(() => { location.reload(); }, 600);
  });
<<<<<<< HEAD

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
    statusEl.className = `status-badge ${cls}`;
  });

  // Archive search
  document.getElementById('archiveSearchInput')?.addEventListener('input', (e) => {
    archiveSearchQuery = e.target.value;
    generateArchiveGrid();
  });
=======
>>>>>>> 18dc45ebf983a8edbbdbfd5cd8787a95e40fe03a
});