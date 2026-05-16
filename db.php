<?php
// db.php — place at root alongside index.html
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");

$host     = "localhost";
$db_name  = "jcompass_db";
$username = "root";
$password = ""; // WAMP default is blank; change if you set a password

try {
    $conn = new PDO(
        "mysql:host=" . $host . ";dbname=" . $db_name . ";charset=utf8",
        $username,
        $password
    );
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $exception) {
    echo json_encode(["error" => "Connection failure: " . $exception->getMessage()]);
    exit();
}
?>
