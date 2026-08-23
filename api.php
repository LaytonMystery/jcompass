<?php
session_start();
include_once 'db.php';

$raw = file_get_contents("php://input");
$input = json_decode($raw, true);
if (!$input) $input = $_POST;

$action = $input['action'] ?? '';

function send($data) {
    echo json_encode($data);
    exit;
}

function requireAuth() {
    if (empty($_SESSION['user'])) {
        send(['success' => false, 'message' => 'Session expired. Please log in again.']);
    }
}

function requireAdmin() {
    requireAuth();
    if ($_SESSION['user']['role'] !== 'ADMIN') {
        send(['success' => false, 'message' => 'Admin clearance required.']);
    }
}

// ============================================================
// AUTHENTICATION
// ============================================================
if ($action === 'login') {
    $name = trim($input['name'] ?? '');
    $pass = trim($input['pass'] ?? '');
    if (!$name || !$pass) send(['success' => false, 'message' => 'Credentials required.']);

    $stmt = $conn->prepare("SELECT * FROM users WHERE name = :name LIMIT 1");
    $stmt->execute([':name' => $name]);
    $user = $stmt->fetch();

    if ($user && $user['pass'] === $pass) {
        $_SESSION['user'] = [
            'id' => $user['id'],
            'name' => $user['name'],
            'role' => $user['role'],
            'code' => $user['code']
        ];
        send(['success' => true, 'user' => $_SESSION['user']]);
    }
    send(['success' => false, 'message' => 'Invalid credentials.']);
}

if ($action === 'logout') {
    session_destroy();
    send(['success' => true, 'message' => 'Logged out.']);
}

if ($action === 'get_session') {
    if (!empty($_SESSION['user'])) {
        send(['success' => true, 'user' => $_SESSION['user']]);
    }
    send(['success' => false]);
}

// ============================================================
// USER MANAGEMENT (Admin Only)
// ============================================================
if ($action === 'get_users') {
    requireAdmin();
    $stmt = $conn->query("SELECT id, name, role, code, created_at FROM users ORDER BY role DESC, name ASC");
    send(['success' => true, 'users' => $stmt->fetchAll()]);
}

if ($action === 'create_user') {
    requireAdmin();
    $name = trim($input['name'] ?? '');
    $pass = trim($input['pass'] ?? '');
    $role = in_array($input['role'] ?? '', ['ADMIN','STAFF']) ? $input['role'] : 'STAFF';
    if (strlen($name) < 2 || strlen($pass) < 4) {
        send(['success' => false, 'message' => 'Name too short or password < 4 chars.']);
    }
    $parts = explode(' ', $name);
    $code = count($parts) > 1 ? strtoupper($parts[0][0] . $parts[1][0]) : strtoupper(substr($name, 0, 2));

    try {
        $stmt = $conn->prepare("INSERT INTO users (name, pass, role, code) VALUES (:name, :pass, :role, :code)");
        $stmt->execute([':name'=>$name, ':pass'=>$pass, ':role'=>$role, ':code'=>$code]);
        send(['success' => true, 'message' => 'User created successfully.']);
    } catch (PDOException $e) {
        if ($e->getCode() == 23000) {
            send(['success' => false, 'message' => 'Username already exists.']);
        }
        send(['success' => false, 'message' => $e->getMessage()]);
    }
}

if ($action === 'delete_user') {
    requireAdmin();
    $id = intval($input['id'] ?? 0);
    if ($id === $_SESSION['user']['id']) {
        send(['success' => false, 'message' => 'You cannot delete your own account.']);
    }
    $stmt = $conn->prepare("DELETE FROM users WHERE id = :id");
    $stmt->execute([':id' => $id]);
    send(['success' => true, 'message' => 'User deleted.']);
}

if ($action === 'update_user_password') {
    requireAdmin();
    $id = intval($input['id'] ?? 0);
    $pass = trim($input['pass'] ?? '');
    if (strlen($pass) < 4) send(['success' => false, 'message' => 'Password too short.']);
    $stmt = $conn->prepare("UPDATE users SET pass = :pass WHERE id = :id");
    $stmt->execute([':pass'=>$pass, ':id'=>$id]);
    send(['success' => true, 'message' => 'Password updated.']);
}

// ============================================================
// PROJECTS
// ============================================================
if ($action === 'get_projects') {
    requireAuth();
    $stmt = $conn->query("SELECT * FROM projects ORDER BY deadline ASC");
    $rows = $stmt->fetchAll();
    // Cast types
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['progress'] = (int)$r['progress'];
        $r['archived'] = (bool)$r['archived'];
    }
    send(['success' => true, 'projects' => $rows]);
}

if ($action === 'add_project') {
    requireAuth();
    $title = trim($input['title'] ?? '');
    $cat = trim($input['category'] ?? 'INVESTIGATIVE');
    $deadline = trim($input['deadline'] ?? date('Y-m-d'));
    if (!$title) send(['success' => false, 'message' => 'Title required.']);
    $stmt = $conn->prepare("INSERT INTO projects (title, category, deadline, status, priority, progress, reporter, notes, tags, archived) VALUES (:title, :cat, :deadline, 'ACTIVE', 'MEDIUM', 0, :reporter, '', '', 0)");
    $stmt->execute([':title'=>$title, ':cat'=>$cat, ':deadline'=>$deadline, ':reporter'=>$_SESSION['user']['name']]);
    send(['success' => true, 'id' => $conn->lastInsertId()]);
}

if ($action === 'update_project') {
    requireAuth();
    $id = intval($input['id'] ?? 0);
    // Verify admin or assigned reporter can edit
    $stmt = $conn->prepare("SELECT reporter FROM projects WHERE id = :id");
    $stmt->execute([':id'=>$id]);
    $proj = $stmt->fetch();
    if (!$proj) send(['success' => false, 'message' => 'Project not found.']);

    $isAdmin = $_SESSION['user']['role'] === 'ADMIN';
    $isReporter = $proj['reporter'] === $_SESSION['user']['name'];

    $fields = [];
    $params = [':id' => $id];

    if (isset($input['title'])) { $fields[] = "title = :title"; $params[':title'] = $input['title']; }
    if (isset($input['category'])) { $fields[] = "category = :category"; $params[':category'] = $input['category']; }
    if (isset($input['deadline'])) { $fields[] = "deadline = :deadline"; $params[':deadline'] = $input['deadline']; }
    if (isset($input['status'])) { $fields[] = "status = :status"; $params[':status'] = $input['status']; }
    if (isset($input['priority'])) { $fields[] = "priority = :priority"; $params[':priority'] = $input['priority']; }
    if (isset($input['progress'])) { $fields[] = "progress = :progress"; $params[':progress'] = intval($input['progress']); }
    if (isset($input['reporter'])) { $fields[] = "reporter = :reporter"; $params[':reporter'] = $input['reporter']; }
    if (isset($input['notes'])) { $fields[] = "notes = :notes"; $params[':notes'] = $input['notes']; }
    if (isset($input['tags'])) { $fields[] = "tags = :tags"; $params[':tags'] = $input['tags']; }
    if (isset($input['archived'])) { $fields[] = "archived = :archived"; $params[':archived'] = $input['archived'] ? 1 : 0; }

    if (empty($fields)) send(['success' => false, 'message' => 'No fields to update.']);

    $sql = "UPDATE projects SET " . implode(', ', $fields) . " WHERE id = :id";
    $stmt = $conn->prepare($sql);
    $stmt->execute($params);
    send(['success' => true, 'message' => 'Project updated.']);
}

if ($action === 'delete_project') {
    requireAdmin();
    $id = intval($input['id'] ?? 0);
    $conn->prepare("DELETE FROM archive_requests WHERE project_id = :id")->execute([':id'=>$id]);
    $conn->prepare("DELETE FROM projects WHERE id = :id")->execute([':id'=>$id]);
    send(['success' => true, 'message' => 'Project deleted.']);
}

// ============================================================
// ASSIGNMENTS
// ============================================================
if ($action === 'get_assignments') {
    requireAuth();
    $stmt = $conn->query("SELECT * FROM assignments ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) $r['id'] = (int)$r['id'];
    send(['success' => true, 'assignments' => $rows]);
}

if ($action === 'add_assignment') {
    requireAuth();
    $title = trim($input['title'] ?? '');
    $assignee = trim($input['assignee'] ?? 'General Desk');
    if (!$title) send(['success' => false, 'message' => 'Title required.']);
    $stmt = $conn->prepare("INSERT INTO assignments (title, assignee) VALUES (:title, :assignee)");
    $stmt->execute([':title'=>$title, ':assignee'=>$assignee]);
    send(['success' => true, 'id' => $conn->lastInsertId()]);
}

if ($action === 'delete_assignment') {
    requireAuth();
    $id = intval($input['id'] ?? 0);
    $conn->prepare("DELETE FROM assignments WHERE id = :id")->execute([':id'=>$id]);
    send(['success' => true]);
}

// ============================================================
// BEATS
// ============================================================
if ($action === 'get_beats') {
    requireAuth();
    $stmt = $conn->query("SELECT * FROM beats ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) $r['id'] = (int)$r['id'];
    send(['success' => true, 'beats' => $rows]);
}

if ($action === 'add_beat') {
    requireAuth();
    $name = trim($input['name'] ?? '');
    $reporter = trim($input['reporter'] ?? $_SESSION['user']['name']);
    $priority = trim($input['priority'] ?? 'MEDIUM');
    $imgData = trim($input['imgData'] ?? '');
    if (!$name) send(['success' => false, 'message' => 'Name required.']);
    $stmt = $conn->prepare("INSERT INTO beats (name, reporter, priority, imgData) VALUES (:name, :reporter, :priority, :imgData)");
    $stmt->execute([':name'=>$name, ':reporter'=>$reporter, ':priority'=>$priority, ':imgData'=>$imgData]);
    send(['success' => true, 'id' => $conn->lastInsertId()]);
}

// ============================================================
// EVENTS
// ============================================================
if ($action === 'get_events') {
    requireAuth();
    $stmt = $conn->query("SELECT * FROM events ORDER BY date ASC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['completed'] = (bool)$r['completed'];
    }
    send(['success' => true, 'events' => $rows]);
}

if ($action === 'add_event') {
    requireAuth();
    $name = trim($input['name'] ?? '');
    $date = trim($input['date'] ?? date('Y-m-d'));
    if (!$name) send(['success' => false, 'message' => 'Name required.']);
    $stmt = $conn->prepare("INSERT INTO events (name, date, completed) VALUES (:name, :date, 0)");
    $stmt->execute([':name'=>$name, ':date'=>$date]);
    send(['success' => true, 'id' => $conn->lastInsertId()]);
}

if ($action === 'toggle_event') {
    requireAuth();
    $id = intval($input['id'] ?? 0);
    $stmt = $conn->prepare("UPDATE events SET completed = NOT completed WHERE id = :id");
    $stmt->execute([':id'=>$id]);
    send(['success' => true]);
}

if ($action === 'delete_event') {
    requireAuth();
    $id = intval($input['id'] ?? 0);
    $conn->prepare("DELETE FROM events WHERE id = :id")->execute([':id'=>$id]);
    send(['success' => true]);
}

// ============================================================
// ANNOUNCEMENTS
// ============================================================
if ($action === 'get_announcements') {
    requireAuth();
    $stmt = $conn->query("SELECT * FROM announcements ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) $r['id'] = (int)$r['id'];
    send(['success' => true, 'announcements' => $rows]);
}

if ($action === 'add_announcement') {
    requireAuth();
    $text = trim($input['text'] ?? '');
    $target = trim($input['target'] ?? 'ALL');
    if (!$text) send(['success' => false, 'message' => 'Text required.']);
    $ts = date('M j, Y');
    $stmt = $conn->prepare("INSERT INTO announcements (sender, target, text, timestamp) VALUES (:sender, :target, :text, :ts)");
    $stmt->execute([':sender'=>$_SESSION['user']['name'], ':target'=>$target, ':text'=>$text, ':ts'=>$ts]);
    send(['success' => true, 'id' => $conn->lastInsertId()]);
}

// ============================================================
// ARCHIVE REQUESTS
// ============================================================
if ($action === 'get_archive_requests') {
    requireAuth();
    $stmt = $conn->query("SELECT * FROM archive_requests ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) $r['id'] = (int)$r['id'];
    send(['success' => true, 'requests' => $rows]);
}

if ($action === 'add_archive_request') {
    requireAuth();
    $pid = intval($input['project_id'] ?? 0);
    $ptitle = trim($input['project_title'] ?? '');
    $ts = date('M j, Y');
    // Check duplicate pending
    $chk = $conn->prepare("SELECT id FROM archive_requests WHERE project_id = :pid AND requester = :req AND status = 'PENDING'");
    $chk->execute([':pid'=>$pid, ':req'=>$_SESSION['user']['name']]);
    if ($chk->fetch()) {
        send(['success' => false, 'message' => 'You already have a pending request for this project.']);
    }
    $stmt = $conn->prepare("INSERT INTO archive_requests (project_id, project_title, requester, request_timestamp, status) VALUES (:pid, :ptitle, :req, :ts, 'PENDING')");
    $stmt->execute([':pid'=>$pid, ':ptitle'=>$ptitle, ':req'=>$_SESSION['user']['name'], ':ts'=>$ts]);
    send(['success' => true]);
}

if ($action === 'update_archive_request') {
    requireAdmin();
    $id = intval($input['id'] ?? 0);
    $status = in_array($input['status'] ?? '', ['APPROVED','DENIED']) ? $input['status'] : 'DENIED';
    $conn->prepare("UPDATE archive_requests SET status = :status WHERE id = :id")->execute([':status'=>$status, ':id'=>$id]);
    // If approved, archive the project
    if ($status === 'APPROVED') {
        $req = $conn->prepare("SELECT project_id FROM archive_requests WHERE id = :id");
        $req->execute([':id'=>$id]);
        $row = $req->fetch();
        if ($row) {
            $conn->prepare("UPDATE projects SET archived = 1 WHERE id = :pid")->execute([':pid'=>$row['project_id']]);
        }
    }
    send(['success' => true]);
}

// ============================================================
// ATTENDANCE
// ============================================================
if ($action === 'get_attendance') {
    requireAuth();
    $stmt = $conn->query("SELECT * FROM attendance ORDER BY created_at DESC");
    send(['success' => true, 'attendance' => $stmt->fetchAll()]);
}

if ($action === 'add_attendance') {
    requireAuth();
    $entry = $input['entry'] ?? [];
    if (empty($entry)) send(['success' => false, 'message' => 'No data.']);
    $stmt = $conn->prepare("INSERT INTO attendance (id, reporter, role, date, time, lat, lon, accuracy, location, timestamp_iso) VALUES (:id, :reporter, :role, :date, :time, :lat, :lon, :accuracy, :location, :timestamp_iso)");
    $stmt->execute([
        ':id' => $entry['id'],
        ':reporter' => $entry['reporter'],
        ':role' => $entry['role'],
        ':date' => $entry['date'],
        ':time' => $entry['time'],
        ':lat' => $entry['lat'],
        ':lon' => $entry['lon'],
        ':accuracy' => $entry['accuracy'],
        ':location' => $entry['location'],
        ':timestamp_iso' => $entry['timestamp']
    ]);
    send(['success' => true]);
}

if ($action === 'clear_attendance') {
    requireAdmin();
    $conn->query("DELETE FROM attendance");
    send(['success' => true, 'message' => 'Attendance log cleared.']);
}

// ============================================================
// SOURCE VAULT
// ============================================================
if ($action === 'get_sources') {
    requireAuth();
    $stmt = $conn->query("SELECT * FROM sources ORDER BY created_at DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) $r['id'] = (int)$r['id'];
    send(['success' => true, 'sources' => $rows]);
}

if ($action === 'add_source') {
    requireAuth();
    $name = trim($input['name'] ?? '');
    $beat = trim($input['beat'] ?? '');
    $contact = trim($input['contact'] ?? '');
    $reliability = in_array($input['reliability'] ?? '', ['HIGH','MEDIUM','LOW']) ? $input['reliability'] : 'MEDIUM';
    $notes = trim($input['notes'] ?? '');
    if (!$name) send(['success' => false, 'message' => 'Source name required.']);
    $stmt = $conn->prepare("INSERT INTO sources (name, beat, contact, reliability, notes, created_by) VALUES (:name, :beat, :contact, :reliability, :notes, :by)");
    $stmt->execute([':name'=>$name, ':beat'=>$beat, ':contact'=>$contact, ':reliability'=>$reliability, ':notes'=>$notes, ':by'=>$_SESSION['user']['name']]);
    send(['success' => true, 'id' => $conn->lastInsertId()]);
}

if ($action === 'delete_source') {
    requireAuth();
    $id = intval($input['id'] ?? 0);
    $conn->prepare("DELETE FROM sources WHERE id = :id")->execute([':id'=>$id]);
    send(['success' => true]);
}

// ============================================================
// DASHBOARD STATS
// ============================================================
if ($action === 'get_stats') {
    requireAuth();
    $stats = [];
    $stats['total_projects'] = $conn->query("SELECT COUNT(*) FROM projects WHERE archived = 0")->fetchColumn();
    $stats['active_projects'] = $conn->query("SELECT COUNT(*) FROM projects WHERE archived = 0 AND status = 'ACTIVE'")->fetchColumn();
    $stats['overdue'] = $conn->query("SELECT COUNT(*) FROM projects WHERE archived = 0 AND deadline < CURDATE() AND status != 'FILED'")->fetchColumn();
    $stats['due_soon'] = $conn->query("SELECT COUNT(*) FROM projects WHERE archived = 0 AND deadline BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY) AND status != 'FILED'")->fetchColumn();
    $stats['today_checkins'] = $conn->query("SELECT COUNT(*) FROM attendance WHERE date = CURDATE()")->fetchColumn();
    $stats['staff_count'] = $conn->query("SELECT COUNT(*) FROM users WHERE role = 'STAFF'")->fetchColumn();
    send(['success' => true, 'stats' => $stats]);
}

// Unknown action
send(['success' => false, 'message' => 'Unknown action: ' . $action]);
?>