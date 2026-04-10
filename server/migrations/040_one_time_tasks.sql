-- Migration 040: One-time tasks tracking table
-- Tracks one-time startup tasks so they only run once across restarts.

CREATE TABLE IF NOT EXISTS one_time_tasks (
  task_name VARCHAR(100) PRIMARY KEY,
  completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  result JSONB
);
