import { db } from './connection.js';
import { sql } from 'drizzle-orm';

async function fix() {
  console.log('Adding missing columns...');
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{"route_completed":true,"stop_failed":true,"stop_assigned":true}'`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES routes(id) ON DELETE SET NULL`);
  await db.execute(sql`ALTER TABLE recurring_deliveries ADD COLUMN IF NOT EXISTS end_date timestamp`);
  await db.execute(sql`ALTER TABLE recurring_deliveries ADD COLUMN IF NOT EXISTS requires_signature boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE recurring_deliveries ADD COLUMN IF NOT EXISTS requires_refrigeration boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE recurring_deliveries ADD COLUMN IF NOT EXISTS window_start_time text`);
  await db.execute(sql`ALTER TABLE recurring_deliveries ADD COLUMN IF NOT EXISTS window_end_time text`);
  await db.execute(sql`ALTER TABLE recurring_deliveries ADD COLUMN IF NOT EXISTS custom_interval_days integer`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS returned_at timestamp`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS redelivery_scheduled_at timestamp`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id text`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id text`);
  await db.execute(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_status text`);
  await db.execute(sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS approach_notified_at timestamp`);
  console.log('✅ All missing columns added');
  process.exit(0);
}

fix().catch(e => { console.error('Error:', e.message); process.exit(1); });
