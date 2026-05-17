<?php
// get_projects.php — place at root alongside index.html
include_once 'db.php';

try {
    $query = "SELECT id, title, category, deadline, status FROM projects ORDER BY deadline ASC";
    $stmt  = $conn->prepare($query);
    $stmt->execute();

    $projects = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode($projects);
} catch (PDOException $e) {
    echo json_encode(["error" => $e->getMessage()]);
}
?>
