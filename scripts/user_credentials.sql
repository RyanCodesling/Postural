-- Postural Mock Users Database Setup
-- Run this SQL file in phpmyadmin to set up the users table with mock credentials

-- Create database
CREATE DATABASE IF NOT EXISTS postural;
USE postural;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('patient', 'therapist', 'admin') NOT NULL,
  clinicId VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role (role)
);

-- Insert mock credentials
INSERT INTO users (id, email, password, name, role, clinicId) VALUES
('patient_001', 'patient@example.com', 'patient123', 'John Patient', 'patient', NULL),
('therapist_001', 'therapist@clinic.com', 'therapist123', 'Sarah Therapist', 'therapist', 'CLINIC_001'),
('admin_001', 'admin@postural.com', 'admin123', 'Admin User', 'admin', NULL);
