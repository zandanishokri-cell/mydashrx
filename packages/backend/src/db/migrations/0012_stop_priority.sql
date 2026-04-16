ALTER TABLE "stops" ADD COLUMN IF NOT EXISTS "priority" text NOT NULL DEFAULT 'normal';
