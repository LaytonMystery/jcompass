<?php
// add_project.php — place at root alongside index.html
include_once 'db.php';

$data = json_decode(file_get_contents("php://input"));

if (!empty($data->title) && !empty($data->category) && !empty($data->deadline)) {
    try {
        $query = "INSERT INTO projects (title, category, deadline, status) VALUES (:title, :category, :deadline, 'DRAFTING')";
        $stmt  = $conn->prepare($query);
        $stmt->bindParam(':title',    $data->title);
        $stmt->bindParam(':category', $data->category);
        $stmt->bindParam(':deadline', $data->deadline);

        if ($stmt->execute()) {
            echo json_encode(["success" => true, "message" => "Project added successfully."]);
        } else {
            echo json_encode(["success" => false, "message" => "Unable to write to database."]);
        }
    } catch (PDOException $e) {
        echo json_encode(["success" => false, "message" => $e->getMessage()]);
    }
} else {
    echo json_encode(["success" => false, "message" => "Incomplete parameters."]);
}
?>
