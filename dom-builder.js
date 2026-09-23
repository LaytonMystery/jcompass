/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Dashboard DOM Builder
 *  Builds the entire dashboard UI at runtime. Loaded before app.js.
 * ══════════════════════════════════════════════════════════════════════
 */
(function buildDashboardDOM() {
  const UI = `
    <aside class="sidebar" id="sidebar">
      <button class="sidebar-close-btn" id="sidebarCloseBtn" type="button" aria-label="Close navigation">✕</button>
      <div class="sidebar-brand">
        <span class="brand-icon">🧭</span>
        <h1 class="brand-name">Journalist's Compass</h1>
      </div>
      <nav class="sidebar-nav">
        <ul class="nav-list">
          <li class="nav-item active" data-page="dashboard"><span class="nav-icon">⌂</span><span class="nav-label">Dashboard</span></li>
          <li class="nav-item" data-page="beat"><span class="nav-icon">📡</span><span class="nav-label">Field Operations</span></li>
          <li class="nav-item" data-page="assignments"><span class="nav-icon">🔔</span><span class="nav-label">Task Assignments</span></li>
          <li class="nav-item" data-page="attend"><span class="nav-icon">📋</span><span class="nav-label">Attendance</span></li>
          <li class="nav-item" data-page="calendar"><span class="nav-icon">📅</span><span class="nav-label">Deadline Calendar</span></li>
          <li class="nav-item" data-page="sources"><span class="nav-icon">🗃</span><span class="nav-label">Contacts</span></li>
          <li class="nav-item admin-only-nav" data-page="users"><span class="nav-icon">👥</span><span class="nav-label">User Management</span></li>
          <li class="nav-item" data-page="archive"><span class="nav-icon">🗄</span><span class="nav-label">Archive</span></li>
          <li class="nav-item admin-only-nav" data-page="audit"><span class="nav-icon">📜</span><span class="nav-label">Activity Log</span></li>
        </ul>
      </nav>
      <div class="sidebar-footer">
        <button class="settings-sidebar-btn" id="settingsSidebarBtn">⚙️ Workspace Settings</button>
        <button class="signout-btn" id="signOutBtn">→ SIGN OUT</button>
      </div>
    </aside>

    <div class="control-tray-overlay" id="controlTrayOverlay"></div>
    <div class="control-tray" id="controlTray">
      <div class="tray-header">
        <div class="tray-title">WORKSPACE CONTROLS</div>
        <button class="tray-close" id="controlTrayCloseBtn">✕</button>
      </div>
      <div class="tray-body">
        <div class="customizer-field">
          <label for="sidebarNameInput" class="customizer-label">Edit Username</label>
          <div class="input-inline-group">
            <input type="text" id="sidebarNameInput" class="customizer-input" placeholder="Type new name...">
            <button id="saveNameBtn" class="customizer-btn-save" title="Save Name">✓</button>
          </div>
        </div>
        <div class="customizer-field" style="margin-top: 1.5rem;">
          <label class="customizer-label">Select Theme</label>
          <div class="theme-select-row">
            <button class="theme-chip-btn active" data-theme="forest">🌲 Forest</button>
            <button class="theme-chip-btn" data-theme="night">🌌 Night</button>
            <button class="theme-chip-btn" data-theme="rust">🍂 Rust</button>
            <button class="theme-chip-btn" data-theme="violet">🔮 Violet</button>
          </div>
        </div>
        <div class="customizer-field" style="margin-top: 1.5rem;">
          <label class="customizer-label">Push Alerts</label>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin: 0.15rem 0 0.6rem;">Get a device popup when someone messages you.</p>
          <button id="enableNotificationsBtn" class="btn btn-ghost" style="width:100%; font-size:0.85rem;">🔔 Enable Push Alerts</button>
          <div id="notificationStatusLabel" style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.5rem;"></div>
        </div>
      </div>
    </div>

    <main class="main-content">
      <header class="topbar">
        <button class="menu-toggle" id="menuToggle">☰</button>
        <div class="topbar-center">
          <span>JCompass</span>
          <span class="breadcrumb-sep">›</span>
          <span class="breadcrumb-current" id="breadcrumbCurrent">Dashboard</span>
        </div>
        <div class="topbar-right">
          <div class="user-chip" id="userAvatarBtn">
            <span class="clearance-badge" id="displayRole">STAFF</span>
            <span class="user-name" id="displayName">Loading Profile...</span>
            <div class="user-avatar" id="avatarBadgeIcon">JC</div>
          </div>
        </div>
      </header>

      <div class="notification-bar-stack" id="notificationBarStack"></div>

      <div class="page active" id="page-dashboard">
        <div class="admin-exclusive-block" id="dashboardAdminConsole">
          <div class="card panel-card">
            <div class="card-category">ADMIN CONTROLS</div>
            <h3 class="section-title" style="font-size:1.2rem; margin-bottom: 0.5rem;">Send Team Announcement</h3>
            <div class="announcement-form-group">
              <input type="text" id="announceTextInput" class="form-input" placeholder="Type your announcement here...">
              <select id="announcePingTarget" class="form-select" style="max-width: 200px;">
                <option value="ALL">Send to All</option>
              </select>
              <button class="btn btn-primary" id="submitAnnouncementBtn">Send Announcement</button>
            </div>
          </div>
        </div>

        <div class="stats-grid" id="dashboardStatsGrid">
          <div class="stat-card"><div class="stat-value" id="statActiveProjects">0</div><div class="stat-label">Active Projects</div></div>
          <div class="stat-card stat-warning"><div class="stat-value" id="statOverdue">0</div><div class="stat-label">Overdue</div></div>
          <div class="stat-card stat-soon"><div class="stat-value" id="statDueSoon">0</div><div class="stat-label">Due Soon (3d)</div></div>
          <div class="stat-card"><div class="stat-value" id="statStaffCount">0</div><div class="stat-label">Team Members</div></div>
          <div class="stat-card stat-success"><div class="stat-value" id="statTodayCheckins">0</div><div class="stat-label">Today's Check-ins</div></div>
        </div>

        <div class="dashboard-announcements-section">
          <h3 class="section-title" style="font-size:1.1rem; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.5rem;"><span>📢</span> Team Announcements</h3>
          <div class="announcements-stream" id="announcementsStreamContainer"></div>
        </div>

        <div class="dashboard-layout-grid">
          <div class="dashboard-main-column">
            <div class="filter-bar" id="dashboardFilterBar">
              <button class="filter-chip active" data-filter="ALL">All Topics</button>
              <button class="filter-chip" data-filter="INVESTIGATIVE">Investigative</button>
              <button class="filter-chip" data-filter="SPORTS">Sports</button>
              <button class="filter-chip" data-filter="FEATURES">Features</button>
              <button class="filter-chip" data-filter="BREAKING">Breaking</button>
              <button class="filter-chip" data-filter="OPINION">Opinion</button>
            </div>
            <div class="search-wrap" style="margin-top: 1rem; margin-bottom: 1.5rem;">
              <input type="text" class="search-bar" id="dashboardSearchInput" placeholder="Search projects...">
            </div>
            <div class="grid" id="projectGrid"></div>
          </div>
          <div class="dashboard-side-column">
            <div class="card panel-card">
              <div class="card-category">TEAM DIRECTORY</div>
              <h3 class="section-title" style="font-size:1.1rem; margin-bottom: 0.75rem;">Team Members</h3>
              <div class="staff-directory-list" id="staffDirectoryList"></div>
            </div>
            <div class="card panel-card">
              <div class="card-category">QUICK ACTIONS</div>
              <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.75rem;">
                <button class="btn btn-primary" id="quickAddProjectBtn" style="font-size:0.85rem;">+ New Project</button>
                <button class="btn btn-ghost" id="quickExportCSVBtn" style="font-size:0.85rem;">⬇ Export CSV</button>
              </div>
            </div>
          </div>
        </div>
        <button class="fab" id="fabBtn" title="Create New Project">+</button>
      </div>

      <div class="page" id="page-beat">
        <div class="section-header">
          <h2 class="section-title">Active Field Operations</h2>
          <button class="btn btn-primary" id="addBeatBtn">+ New Field Operation</button>
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:-0.5rem;">Send team members to a location. Select multiple members — each is notified automatically.</p>
        <div class="grid" id="beatsGrid"></div>
      </div>

      <div class="page" id="page-assignments">
        <div class="section-header">
          <h2 class="section-title">Assigned Tasks</h2>
          <button class="btn btn-primary" id="addAssignmentBtn">+ Create Task</button>
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:-0.5rem;">Team members submit work on assigned tasks. Admins review and approve.</p>
        <div class="grid" id="assignmentsGrid"></div>
      </div>

      <div class="page" id="page-attend">
        <div class="attendance-split" style="margin-bottom: 1.5rem;">
          <div class="card" style="display:flex; flex-direction:column; gap:1rem;">
            <div>
              <div class="card-category">ATTENDANCE TERMINAL</div>
              <h3 style="font-family:var(--font-display); font-size:1.2rem; margin-top:0.25rem;">Check In</h3>
              <p style="color:var(--text-muted); font-size:0.875rem; margin-top:0.4rem;">Records your name, time, and location.</p>
            </div>
            <div style="background:rgba(0,0,0,0.2); border-radius:8px; padding:0.75rem 1rem; display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border-color);">
              <div>
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:1px;">CURRENT TIME</div>
                <div id="liveClock" style="font-family:var(--font-display); font-size:1.5rem; font-weight:700; letter-spacing:1px;">--:--:--</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:1px;">TODAY</div>
                <div id="liveDate" style="font-size:0.85rem; font-weight:600;">---</div>
              </div>
            </div>
            <div>
              <label class="form-label" style="margin-top:0;">Note (optional)</label>
              <input class="form-input" id="attendanceLocationNote" type="text" placeholder="e.g., Client meeting at City Hall">
            </div>
            <button class="btn btn-primary" id="markAttendanceBtn" style="width:100%; padding:1rem; font-size:1rem; letter-spacing:0.5px;">📍 Check In Now</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:1rem;">
            <div class="card" style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
              <div style="text-align:center; padding:0.5rem;">
                <div class="attendance-stat-value" style="color:var(--accent-light);" id="statTodayCount">0</div>
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px; margin-top:0.25rem;">TODAY'S CHECK-INS</div>
              </div>
              <div style="text-align:center; padding:0.5rem; border-left:1px solid var(--border-color);">
                <div class="attendance-stat-value" style="color:var(--success);" id="statTotalCount">0</div>
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; letter-spacing:0.5px; margin-top:0.25rem;">TOTAL LOGGED</div>
              </div>
            </div>
            <div class="card" style="flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                <h3 style="font-family:var(--font-display); font-size:1rem;">Upcoming Events</h3>
                <button class="btn btn-ghost" id="addEventBtn" style="padding:0.25rem 0.5rem; font-size:0.8rem;">+ Add Event</button>
              </div>
              <div class="event-checklist" id="eventsChecklistContainer"></div>
            </div>
          </div>
        </div>
        <div class="card" style="padding:0; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:1.25rem 1.5rem; border-bottom:1px solid var(--border-color);">
            <div>
              <div class="card-category">CHECK-IN HISTORY</div>
              <h3 style="font-family:var(--font-display); font-size:1.1rem; margin-top:0.15rem;">Attendance Records</h3>
            </div>
            <div style="display:flex; gap:0.75rem; align-items:center;">
              <input type="text" id="attendanceSearchInput" class="search-bar" placeholder="🔍 Search..." style="width:200px; padding:0.5rem 0.75rem; font-size:0.85rem;">
              <button class="btn btn-ghost" id="exportAttendanceBtn" style="font-size:0.8rem; white-space:nowrap;">⬇ Export</button>
              <button class="btn btn-ghost" id="clearAttendanceBtn" style="font-size:0.8rem; color:var(--danger); border-color:rgba(229,62,62,0.3); white-space:nowrap;">🗑 Clear</button>
            </div>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
              <thead>
                <tr style="background:rgba(0,0,0,0.2); text-align:left;">
                  <th style="padding:0.75rem 1.5rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">#</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">NAME</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">DATE</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">TIME</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">LAT</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">LON</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">ACCURACY</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">LOCATION</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">NOTE</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">ROLE</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.75rem;">MAP</th>
                </tr>
              </thead>
              <tbody id="attendanceTableBody">
                <tr id="attendanceEmptyRow"><td colspan="11" style="text-align:center; padding:3rem; color:var(--text-muted); font-size:0.9rem;">No attendance records yet.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="page" id="page-calendar">
        <div class="section-header">
          <h2 class="section-title">Task Deadline Calendar</h2>
          <button class="btn btn-primary" id="addCalendarProjectBtn">+ Add Project</button>
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:-0.5rem;">Click any date to view details of scheduled tasks.</p>
        <div class="calendar-header">
          <button class="cal-nav-btn" id="calPrevMonth">‹</button>
          <div class="cal-month-year" id="calMonthYear">August 2026</div>
          <button class="cal-nav-btn" id="calNextMonth">›</button>
        </div>
        <div class="calendar-grid" id="calendarMatrixLayout"></div>
      </div>

      <div class="page" id="page-sources">
        <div class="section-header">
          <h2 class="section-title">Contacts</h2>
          <button class="btn btn-primary" id="addSourceBtn">+ Add Contact</button>
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:-0.5rem;">Private contact directory.</p>
        <div class="search-wrap" style="margin-top:0.75rem; margin-bottom:1rem;">
          <input type="text" class="search-bar" id="sourceSearchInput" placeholder="Search contacts...">
        </div>
        <div class="grid" id="sourcesGrid"></div>
      </div>

      <div class="page" id="page-users">
        <div class="section-header">
          <h2 class="section-title">User Management</h2>
          <button class="btn btn-primary" id="addUserBtn">+ Create Account</button>
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:-0.5rem;">Admin-only.</p>
        <div class="card" style="margin-top:1rem; padding:0; overflow:hidden;">
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
              <thead>
                <tr style="background:rgba(0,0,0,0.2); text-align:left;">
                  <th style="padding:0.9rem 1.25rem; color:var(--text-muted); font-weight:700; font-size:0.78rem;">CODE</th>
                  <th style="padding:0.9rem 1.25rem; color:var(--text-muted); font-weight:700; font-size:0.78rem;">NAME</th>
                  <th style="padding:0.9rem 1.25rem; color:var(--text-muted); font-weight:700; font-size:0.78rem;">ROLE</th>
                  <th style="padding:0.9rem 1.25rem; color:var(--text-muted); font-weight:700; font-size:0.78rem;">CREATED</th>
                  <th style="padding:0.9rem 1.25rem; color:var(--text-muted); font-weight:700; font-size:0.78rem; text-align:right;">ACTIONS</th>
                </tr>
              </thead>
              <tbody id="usersTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="page" id="page-archive">
        <div class="section-header">
          <h2 class="section-title">🗄 Archive</h2>
          <span class="archive-count-badge" id="archiveCountBadge">0 archived</span>
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:-0.5rem;">Completed or retired projects.</p>
        <div class="search-wrap" style="margin-top:0.5rem;">
          <input type="text" class="search-bar" id="archiveSearchInput" placeholder="Search archived...">
        </div>
        <div class="grid" id="archiveGrid"></div>

        <div class="section-header" style="margin-top: 2rem;">
          <h2 class="section-title">📄 Closed Reports</h2>
          <span class="archive-count-badge" id="archiveReportsCountBadge">0 filed</span>
        </div>
        <div class="grid" id="archiveReportsGrid"></div>

        <div class="section-header" style="margin-top: 2rem;">
          <h2 class="section-title">📊 Activity Summary</h2>
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span class="archive-count-badge" id="activitySummaryCountBadge">0 generated</span>
            <button class="btn btn-ghost" id="generateActivitySummaryBtn" style="font-size:0.8rem; white-space:nowrap;">📊 Generate Summary</button>
          </div>
        </div>
        <div class="grid" id="activitySummaryGrid"></div>
      </div>

      <div class="page" id="page-audit">
        <div class="section-header">
          <h2 class="section-title">📜 Activity Log</h2>
          <span class="archive-count-badge" id="auditCountBadge">0 entries</span>
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:-0.5rem;">Admin-only history of every action.</p>
        <div class="search-wrap" style="margin-top:0.75rem;">
          <input type="text" class="search-bar" id="auditSearchInput" placeholder="Search by user, action, or item...">
        </div>
        <div class="card" style="padding:0; overflow:hidden; margin-top:1rem;">
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
              <thead>
                <tr style="background:rgba(0,0,0,0.2); text-align:left;">
                  <th style="padding:0.75rem 1.25rem; color:var(--text-muted); font-weight:700; font-size:0.72rem;">TIME</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.72rem;">USER</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.72rem;">ACTION</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.72rem;">ITEM</th>
                  <th style="padding:0.75rem 1rem; color:var(--text-muted); font-weight:700; font-size:0.72rem;">DETAILS</th>
                </tr>
              </thead>
              <tbody id="auditLogTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </main>

    <div class="modal-overlay" id="newProjectModal">
      <div class="modal">
        <div class="modal-header"><h2 class="modal-title">Create New Project</h2><button class="modal-close" data-close="newProjectModal">✕</button></div>
        <div class="modal-body">
          <label class="form-label">Project Title</label>
          <input class="form-input" id="newTitle" type="text" placeholder="Enter project title...">
          <label class="form-label">Category</label>
          <select class="form-select" id="newCategory">
            <option value="INVESTIGATIVE">Investigative</option>
            <option value="BREAKING">Breaking</option>
            <option value="FEATURES">Features</option>
            <option value="SPORTS">Sports</option>
            <option value="OPINION">Opinion</option>
          </select>
          <label class="form-label">Deadline</label>
          <input class="form-input" id="newDeadline" type="date">
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close="newProjectModal">Cancel</button>
          <button class="btn btn-primary" id="createProjectBtn">Create Project</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="addBeatModal">
      <div class="modal" style="max-width:600px; width:95vw;">
        <div class="modal-header"><h2 class="modal-title">New Field Operation</h2><button class="modal-close" data-close="addBeatModal">✕</button></div>
        <div class="modal-body">
          <label class="form-label">Operation Title</label>
          <input class="form-input" id="beatName" type="text" placeholder="e.g., City Hall Coverage...">
          <label class="form-label">Priority</label>
          <select class="form-select" id="beatPriority">
            <option value="HIGH">High</option>
            <option value="MEDIUM" selected>Medium</option>
            <option value="LOW">Low</option>
          </select>
          <label class="form-label">Location</label>
          <input class="form-input" id="beatLocation" type="text" placeholder="e.g., City Hall...">
          <label class="form-label">Instructions</label>
          <textarea class="form-input" id="beatDescription" rows="3" placeholder="What should the team do?" style="resize:vertical; font-family:var(--font-body);"></textarea>
          <label class="form-label">Select Team Member(s) <span style="color:var(--text-muted);font-weight:400;">(multi-select)</span></label>
          <div id="reporterCheckboxList" style="max-height:220px; overflow-y:auto; background:rgba(0,0,0,0.2); border:1px solid var(--border-color); border-radius:8px; padding:0.75rem;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close="addBeatModal">Cancel</button>
          <button class="btn btn-primary" id="saveBeatBtn">Deploy &amp; Notify</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="addAssignmentModal">
      <div class="modal" style="max-width:600px; width:95vw;">
        <div class="modal-header"><h2 class="modal-title">Create Task</h2><button class="modal-close" data-close="addAssignmentModal">✕</button></div>
        <div class="modal-body">
          <label class="form-label">Task Description</label>
          <input class="form-input" id="asgTitle" type="text" placeholder="What needs to be done?">
          <label class="form-label">Assign To <span style="color:var(--text-muted);font-weight:400;">(select one)</span></label>
          <div id="assigneeRadioList" style="max-height:220px; overflow-y:auto; background:rgba(0,0,0,0.2); border:1px solid var(--border-color); border-radius:8px; padding:0.75rem;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close="addAssignmentModal">Cancel</button>
          <button class="btn btn-primary" id="saveAssignmentBtn">Create &amp; Notify</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="addEventModal">
      <div class="modal">
        <div class="modal-header"><h2 class="modal-title">Add Event</h2><button class="modal-close" data-close="addEventModal">✕</button></div>
        <div class="modal-body">
          <label class="form-label">Event Title</label>
          <input class="form-input" id="evtName" type="text" placeholder="e.g., Team Meeting">
          <label class="form-label">Date</label>
          <input class="form-input" id="evtDate" type="date">
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close="addEventModal">Cancel</button>
          <button class="btn btn-primary" id="saveEventBtn">Add Event</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="addUserModal">
      <div class="modal">
        <div class="modal-header"><h2 class="modal-title">Create Account</h2><button class="modal-close" data-close="addUserModal">✕</button></div>
        <div class="modal-body">
          <label class="form-label">Full Name</label>
          <input class="form-input" id="newUserName" type="text" placeholder="e.g., Jane Doe">
          <label class="form-label">Password</label>
          <input class="form-input" id="newUserPass" type="text" placeholder="Min. 4 characters">
          <label class="form-label">Role</label>
          <select class="form-select" id="newUserRole">
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close="addUserModal">Cancel</button>
          <button class="btn btn-primary" id="saveUserBtn">Create Account</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="addSourceModal">
      <div class="modal">
        <div class="modal-header"><h2 class="modal-title">Add Contact</h2><button class="modal-close" data-close="addSourceModal">✕</button></div>
        <div class="modal-body">
          <label class="form-label">Contact Name</label>
          <input class="form-input" id="sourceName" type="text" placeholder="e.g., John Smith">
          <label class="form-label">Category</label>
          <input class="form-input" id="sourceBeat" type="text" placeholder="e.g., Government, Business">
          <label class="form-label">Contact Info</label>
          <input class="form-input" id="sourceContact" type="text" placeholder="Email or phone">
          <label class="form-label">Trust Level</label>
          <select class="form-select" id="sourceReliability">
            <option value="HIGH">🔴 High — Verified</option>
            <option value="MEDIUM" selected>🟡 Medium — Usually accurate</option>
            <option value="LOW">🟢 Low — Unverified</option>
          </select>
          <label class="form-label">Notes</label>
          <textarea class="form-input" id="sourceNotes" rows="3" placeholder="Background info..." style="resize:vertical; font-family:var(--font-body);"></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close="addSourceModal">Cancel</button>
          <button class="btn btn-primary" id="saveSourceBtn">Save Contact</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="projectProfileModal">
      <div class="modal" style="max-width:600px; width:95vw;">
        <div class="modal-header">
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <div class="card-category" id="profileModalCategory">CATEGORY</div>
            <h2 class="modal-title" id="profileModalTitle">Project</h2>
          </div>
          <button class="modal-close" data-close="projectProfileModal">✕</button>
        </div>
        <div class="modal-body" style="gap:1.25rem;">
          <div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:center;">
            <span class="status-badge" id="profileModalStatus">ACTIVE</span>
            <span style="font-size:0.82rem; color:var(--text-muted);">📅 Deadline: <b id="profileModalDeadline">—</b></span>
          </div>
          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
              <span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Progress</span>
              <span style="font-size:0.78rem; font-weight:700; color:var(--accent-light);" id="profileProgressLabel">0%</span>
            </div>
            <div style="background:rgba(0,0,0,0.3); border-radius:20px; height:8px; overflow:hidden;">
              <div id="profileProgressBar" style="height:100%; background:var(--accent-light); border-radius:20px; transition:width 0.4s ease; width:0%;"></div>
            </div>
            <input type="range" id="profileProgressInput" min="0" max="100" step="5" value="0" style="width:100%; margin-top:0.5rem; accent-color:var(--accent-light);">
          </div>
          <div>
            <span style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:0.4rem;">Priority</span>
            <div style="display:flex; gap:0.5rem;">
              <button class="priority-select-btn" data-priority="LOW">🟢 Low</button>
              <button class="priority-select-btn" data-priority="MEDIUM">🟡 Medium</button>
              <button class="priority-select-btn" data-priority="HIGH">🔴 High</button>
            </div>
          </div>
          <div><label class="form-label">Assigned To</label><input type="text" class="form-input" id="profileAssignedReporter" placeholder="Who is working on this?"></div>
          <div><label class="form-label">Notes</label><textarea class="form-input" id="profileNotes" rows="4" placeholder="Add notes..." style="resize:vertical; font-family:var(--font-body);"></textarea></div>
          <div><label class="form-label">Tags</label><input type="text" class="form-input" id="profileTags" placeholder="e.g., urgent, follow-up"></div>
          <div>
            <label class="form-label">Status</label>
            <select class="form-select" id="profileStatusSelect">
              <option value="ACTIVE">Active</option>
              <option value="IN REVIEW">In Review</option>
              <option value="FILED">Filed</option>
              <option value="ON HOLD">On Hold</option>
              <option value="PUBLISHED">Published</option>
            </select>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between;">
          <div id="profileStaffNotice" style="display:none; align-items:center; gap:0.6rem; font-size:0.8rem; color:var(--text-muted); background:rgba(0,0,0,0.2); border:1px solid var(--border-color); border-radius:6px; padding:0.5rem 0.85rem; flex:1; margin-right:0.75rem;">
            <span style="font-size:1rem;">🔒</span><span>Read-only. Only Admins can edit.</span>
          </div>
          <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-ghost" id="profileArchiveBtn" style="color:var(--warning); border-color:rgba(221,107,32,0.4);">🗄 Archive</button>
            <button class="btn btn-ghost" id="profileDeleteBtn" style="color:var(--danger); border-color:rgba(229,62,62,0.3);">🗑 Delete</button>
            <button class="btn btn-ghost" id="profileRequestArchiveBtn" style="display:none; color:var(--warning); border-color:rgba(221,107,32,0.4);">📤 Request Archive</button>
          </div>
          <div style="display:flex; gap:0.5rem; margin-left:0.5rem;">
            <button class="btn btn-ghost" data-close="projectProfileModal">Cancel</button>
            <button class="btn btn-primary" id="profileSaveBtn">💾 Save</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="deploymentProfileModal">
      <div class="modal" style="max-width:600px; width:95vw;">
        <div class="modal-header">
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <div class="card-category" id="deploymentModalCategory">FIELD OPERATION</div>
            <h2 class="modal-title" id="deploymentModalTitle">Operation</h2>
          </div>
          <button class="modal-close" data-close="deploymentProfileModal">✕</button>
        </div>
        <div class="modal-body" id="deploymentModalBody" style="gap:1rem;"></div>
        <div class="modal-footer" style="justify-content:space-between;">
          <div id="deploymentModalActions"></div>
          <button class="btn btn-ghost" data-close="deploymentProfileModal">Close</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="assignmentSubmissionModal">
      <div class="modal" style="max-width:600px; width:95vw;">
        <div class="modal-header">
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <div class="card-category" id="submissionModalCategory">TASK</div>
            <h2 class="modal-title" id="submissionModalTitle">Task</h2>
          </div>
          <button class="modal-close" data-close="assignmentSubmissionModal">✕</button>
        </div>
        <div class="modal-body" id="submissionModalBody" style="gap:1rem;"></div>
        <div class="modal-footer" id="submissionModalFooter"></div>
      </div>
    </div>

    <div class="modal-overlay" id="geoMapModal">
      <div class="modal" style="max-width:720px; width:95vw;">
        <div class="modal-header"><h2 class="modal-title">📍 Check-in Location</h2><button class="modal-close" data-close="geoMapModal">✕</button></div>
        <div class="modal-body" style="padding:0; overflow:hidden;">
          <div id="geoMapReporterInfo" style="padding:1rem 1.25rem; background:rgba(0,0,0,0.2); border-bottom:1px solid var(--border-color);"></div>
          <div style="position:relative; width:100%; height:400px; background:#141824;">
            <iframe id="geoMapIframe" width="100%" height="100%" style="border:0; display:block;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="about:blank"></iframe>
          </div>
          <div style="padding:0.75rem 1.25rem; display:flex; justify-content:space-between; gap:0.75rem; border-top:1px solid var(--border-color);">
            <a id="geoMapOpenBtn" href="#" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="font-size:0.82rem; text-decoration:none;">🌐 Open in Google Maps</a>
            <button class="btn btn-ghost" data-close="geoMapModal">Close</button>
          </div>
        </div>
      </div>
    </div>

    <div class="toast" id="toast">Notification</div>
  `;

  document.body.insertAdjacentHTML('afterbegin', UI);
})();