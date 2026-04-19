-- P-SES18: stable device label stored at RT creation for consistent session UI
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "device_name" text;
