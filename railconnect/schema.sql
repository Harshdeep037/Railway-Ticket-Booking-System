-- RailConnect schema (MySQL 8+). `npm run setup` creates the database and runs this file.

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  phone VARCHAR(15),
  password_hash VARCHAR(200) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stations (
  code VARCHAR(8) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  city VARCHAR(60) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trains (
  id INT AUTO_INCREMENT PRIMARY KEY,
  train_number VARCHAR(8) NOT NULL UNIQUE,
  train_name VARCHAR(80) NOT NULL,
  train_type VARCHAR(30) NOT NULL,
  run_days CHAR(7) NOT NULL DEFAULT '1111111'   -- Mon..Sun, 1 = runs
) ENGINE=InnoDB;

-- One row per stop. day_offset = days after the origin departure (0, 1, 2 ...).
CREATE TABLE IF NOT EXISTS train_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  train_id INT NOT NULL,
  seq INT NOT NULL,
  station_code VARCHAR(8) NOT NULL,
  arrival_time TIME NULL,
  departure_time TIME NULL,
  day_offset TINYINT NOT NULL DEFAULT 0,
  distance_km INT NOT NULL,
  UNIQUE KEY uq_train_seq (train_id, seq),
  KEY ix_stop_station (station_code, train_id),
  FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE,
  FOREIGN KEY (station_code) REFERENCES stations(code)
) ENGINE=InnoDB;

-- Seats are counted per train/class; availability per date is calculated from bookings.
CREATE TABLE IF NOT EXISTS train_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  train_id INT NOT NULL,
  class_type VARCHAR(3) NOT NULL,
  total_seats INT NOT NULL,
  base_fare DECIMAL(8,2) NOT NULL,
  rate_per_km DECIMAL(6,3) NOT NULL,
  UNIQUE KEY uq_train_class (train_id, class_type),
  FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pnr CHAR(10) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  train_id INT NOT NULL,
  class_type VARCHAR(3) NOT NULL,
  from_code VARCHAR(8) NOT NULL,
  to_code VARCHAR(8) NOT NULL,
  journey_date DATE NOT NULL,            -- date the passenger boards
  run_date DATE NOT NULL,                -- date the train left its origin
  dep_time TIME NOT NULL,
  arr_time TIME NOT NULL,
  arr_day_diff TINYINT NOT NULL DEFAULT 0,
  duration_min INT NOT NULL,
  distance_km INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('Confirmed','Cancelled') NOT NULL DEFAULT 'Confirmed',
  refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  cancelled_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY ix_user (user_id, journey_date),
  KEY ix_avail (train_id, class_type, run_date, status),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (train_id) REFERENCES trains(id),
  FOREIGN KEY (from_code) REFERENCES stations(code),
  FOREIGN KEY (to_code) REFERENCES stations(code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS passengers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  age TINYINT UNSIGNED NOT NULL,
  gender ENUM('Male','Female','Other') NOT NULL,
  seat_no INT NOT NULL,
  seat_label VARCHAR(12) NOT NULL,
  berth VARCHAR(20) NOT NULL,
  fare DECIMAL(8,2) NOT NULL,
  status ENUM('Confirmed','Cancelled') NOT NULL DEFAULT 'Confirmed',
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  txn_id VARCHAR(24) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;
