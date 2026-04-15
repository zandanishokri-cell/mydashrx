ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{"route_completed":true,"stop_failed":true,"stop_assigned":true}';
