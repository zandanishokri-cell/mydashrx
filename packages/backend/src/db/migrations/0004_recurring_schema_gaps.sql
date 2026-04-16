-- Migration 0004: Recurring deliveries schema gaps (deferred from SWARM-C48)
-- Adds: end_date, requires_signature, requires_refrigeration, window times, custom interval

ALTER TABLE recurring_deliveries
  ADD COLUMN IF NOT EXISTS end_date timestamp,
  ADD COLUMN IF NOT EXISTS requires_signature boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_refrigeration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS window_start_time time,
  ADD COLUMN IF NOT EXISTS window_end_time time,
  ADD COLUMN IF NOT EXISTS custom_interval_days integer;
