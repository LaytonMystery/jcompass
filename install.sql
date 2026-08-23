-- Journalist's Compass — Deployment Database Schema
-- Run this in phpMyAdmin or MySQL CLI before first use

CREATE DATABASE IF NOT EXISTS jcompass_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jcompass_db;

-- Users table (admin-only creation)
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    pass VARCHAR(255) NOT NULL,
    role ENUM('ADMIN','STAFF') DEFAULT 'STAFF',
    code VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(50),
    deadline DATE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    progress INT DEFAULT 0,
    reporter VARCHAR(100),
    notes TEXT,
    tags VARCHAR(255),
    archived TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Assignments table
CREATE TABLE assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title TEXT NOT NULL,
    assignee VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Beats table
CREATE TABLE beats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    reporter VARCHAR(100),
    priority VARCHAR(20),
    imgData LONGTEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Events / Checklist table
CREATE TABLE events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    date DATE,
    completed TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Announcements table
CREATE TABLE announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender VARCHAR(100),
    target VARCHAR(100),
    text TEXT,
    timestamp VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Archive requests table
CREATE TABLE archive_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT,
    project_title VARCHAR(255),
    requester VARCHAR(100),
    request_timestamp VARCHAR(50),
    status VARCHAR(20) DEFAULT 'PENDING'
);

-- Attendance / Geo-presence table
CREATE TABLE attendance (
    id BIGINT PRIMARY KEY,
    reporter VARCHAR(100),
    role VARCHAR(20),
    date VARCHAR(20),
    time VARCHAR(20),
    lat VARCHAR(20),
    lon VARCHAR(20),
    accuracy INT,
    location VARCHAR(255),
    timestamp_iso VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Source Vault (new journalist feature)
CREATE TABLE sources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    beat VARCHAR(100),
    contact VARCHAR(255),
    reliability ENUM('HIGH','MEDIUM','LOW') DEFAULT 'MEDIUM',
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default accounts
INSERT INTO users (name, pass, role, code) VALUES 
('Admin Account', 'admin123', 'ADMIN', 'AA'),
('Staff Reporter', 'staff123', 'STAFF', 'SR');

-- Insert sample projects
INSERT INTO projects (title, category, deadline, status, priority, progress, reporter, notes, tags, archived) VALUES
('Global Supply Route Friction Analytics', 'INVESTIGATIVE', '2026-08-12', 'ACTIVE', 'HIGH', 65, 'Staff Reporter', 'Key source: Trade Ministry official. Follow up on embargo docs.', 'exclusive,urgent', 0),
('Mayoral Campaign Expenditure Audits', 'BREAKING', '2026-08-20', 'IN REVIEW', 'HIGH', 80, 'Staff Reporter', 'FEC filings cross-referenced. Awaiting legal review.', 'follow-up', 0),
('Local Tech Ecosystem Multi-Tier Integration', 'FEATURES', '2026-08-28', 'FILED', 'MEDIUM', 100, '', '', '', 0);

-- Insert sample assignments
INSERT INTO assignments (title, assignee) VALUES
('Interview Chief of Police regarding recent data breach anomalies', 'Staff Reporter');

-- Insert sample beats
INSERT INTO beats (name, reporter, priority, imgData) VALUES
('City Hall Hallways Desk', 'Lead Editor', 'HIGH', '');

-- Insert sample events
INSERT INTO events (name, date, completed) VALUES
('Press Conference Security Briefing Room B', '2026-08-18', 0);

-- Insert sample announcements
INSERT INTO announcements (sender, target, text, timestamp) VALUES
('Admin Account', 'ALL', 'All field correspondents report telemetry logs before 1800 hours sync.', 'Aug 1, 2026');
