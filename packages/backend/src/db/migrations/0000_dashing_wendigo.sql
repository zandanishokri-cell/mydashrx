DO $$ BEGIN
 CREATE TYPE "automation_trigger" AS ENUM('stop_status_changed', 'stop_failed', 'stop_completed', 'driver_started_route', 'route_completed', 'stop_approaching');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "baa_status" AS ENUM('signed', 'pending', 'not_required', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "billing_plan" AS ENUM('starter', 'growth', 'pro', 'enterprise');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "driver_status" AS ENUM('available', 'on_route', 'offline');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "lead_status" AS ENUM('new', 'contacted', 'interested', 'negotiating', 'closed', 'lost');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "notif_channel" AS ENUM('sms', 'email', 'push');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "plan_status" AS ENUM('draft', 'optimized', 'distributed', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "recurring_schedule" AS ENUM('weekly', 'biweekly', 'monthly', 'custom');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "role" AS ENUM('super_admin', 'pharmacy_admin', 'dispatcher', 'driver', 'pharmacist');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "route_status" AS ENUM('pending', 'active', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "stop_status" AS ENUM('pending', 'en_route', 'arrived', 'completed', 'failed', 'rescheduled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "vehicle_type" AS ENUM('car', 'van', 'bicycle');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"resource_id" text,
	"status" text DEFAULT 'success' NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" "automation_trigger" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb DEFAULT '{}' NOT NULL,
	"actions" jsonb DEFAULT '[]' NOT NULL,
	"sms_template" text,
	"email_subject" text,
	"email_template" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "baa_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"vendor_name" text NOT NULL,
	"service" text NOT NULL,
	"baa_status" "baa_status" DEFAULT 'pending' NOT NULL,
	"signed_at" timestamp,
	"expires_at" timestamp,
	"document_url" text,
	"notes" text,
	"touches_phi" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"category" text NOT NULL,
	"check_name" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"detail" text,
	"last_checked_at" timestamp DEFAULT now() NOT NULL,
	"next_check_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "depots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"phone" varchar(20),
	"operating_hours" jsonb,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_location_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"route_id" uuid,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" varchar(20) NOT NULL,
	"password_hash" text NOT NULL,
	"license_number" text,
	"drug_capable" boolean DEFAULT false NOT NULL,
	"vehicle_type" "vehicle_type" DEFAULT 'car' NOT NULL,
	"status" "driver_status" DEFAULT 'offline' NOT NULL,
	"current_lat" real,
	"current_lng" real,
	"last_ping_at" timestamp,
	"zone_ids" jsonb DEFAULT '[]' NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_outreach_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"body" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"sent_by" uuid,
	"resend_message_id" text,
	"status" text DEFAULT 'sent' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" varchar(2) DEFAULT 'MI' NOT NULL,
	"zip" varchar(10),
	"phone" varchar(20),
	"website" text,
	"email" text,
	"owner_name" text,
	"business_type" text,
	"google_place_id" text,
	"rating" real,
	"review_count" integer,
	"score" integer DEFAULT 0 NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"notes" text,
	"next_follow_up" timestamp,
	"last_contacted_at" timestamp,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"source_data" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "lead_prospects_google_place_id_unique" UNIQUE("google_place_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mi_compliance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"category" text NOT NULL,
	"item_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"due_date" timestamp,
	"completed_at" timestamp,
	"legal_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid NOT NULL,
	"event" text NOT NULL,
	"channel" "notif_channel" NOT NULL,
	"recipient" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"external_id" text,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"hipaa_baa_status" text DEFAULT 'pending' NOT NULL,
	"billing_plan" "billing_plan" DEFAULT 'starter' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"date" text NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proof_of_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"package_count" integer NOT NULL,
	"signature" jsonb,
	"photos" jsonb DEFAULT '[]' NOT NULL,
	"age_verification" jsonb,
	"cod_collected" jsonb,
	"driver_note" text,
	"customer_note" text,
	"signature_data" text,
	"id_photo_url" text,
	"id_verified" boolean DEFAULT false NOT NULL,
	"recipient_name" text,
	"delivery_notes" text,
	"is_controlled_substance" boolean DEFAULT false NOT NULL,
	"id_dob_confirmed" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proof_of_deliveries_stop_id_unique" UNIQUE("stop_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"address" text NOT NULL,
	"lat" real,
	"lng" real,
	"recipient_phone" varchar(20),
	"recipient_email" text,
	"notes" text,
	"schedule" "recurring_schedule" DEFAULT 'weekly' NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"next_delivery_date" timestamp,
	"last_delivery_date" timestamp,
	"rx_number" text,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"depot_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulatory_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"source" text NOT NULL,
	"impact_level" text DEFAULT 'medium' NOT NULL,
	"effective_date" timestamp,
	"url" text,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"driver_id" uuid,
	"status" "route_status" DEFAULT 'pending' NOT NULL,
	"stop_order" jsonb DEFAULT '[]' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"estimated_duration" integer,
	"total_distance" real,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" varchar(20) NOT NULL,
	"address" text NOT NULL,
	"unit" text,
	"delivery_notes" text,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"rx_numbers" jsonb DEFAULT '[]' NOT NULL,
	"package_count" integer DEFAULT 1 NOT NULL,
	"requires_refrigeration" boolean DEFAULT false NOT NULL,
	"controlled_substance" boolean DEFAULT false NOT NULL,
	"cod_amount" integer,
	"requires_signature" boolean DEFAULT true NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_age_verification" boolean DEFAULT false NOT NULL,
	"window_start" timestamp,
	"window_end" timestamp,
	"status" "stop_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"failure_note" text,
	"arrived_at" timestamp,
	"completed_at" timestamp,
	"tracking_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sequence_number" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "stops_tracking_token_unique" UNIQUE("tracking_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"depot_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_org_idx" ON "audit_logs" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_created_idx" ON "audit_logs" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_log_org_idx" ON "automation_log" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_driver_idx" ON "driver_location_history" ("driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drivers_org_idx" ON "drivers" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_idx" ON "lead_prospects" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "lead_prospects" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mi_compliance_org_idx" ON "mi_compliance_items" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mi_compliance_category_idx" ON "mi_compliance_items" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_org_idx" ON "plans" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_date_idx" ON "plans" ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_org_idx" ON "recurring_deliveries" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regulatory_updates_org_idx" ON "regulatory_updates" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stops_org_idx" ON "stops" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stops_route_idx" ON "stops" ("route_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stops_token_idx" ON "stops" ("tracking_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_org_idx" ON "users" ("org_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_log" ADD CONSTRAINT "automation_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_log" ADD CONSTRAINT "automation_log_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "baa_registry" ADD CONSTRAINT "baa_registry_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "depots" ADD CONSTRAINT "depots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_location_history" ADD CONSTRAINT "driver_location_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "driver_location_history" ADD CONSTRAINT "driver_location_history_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drivers" ADD CONSTRAINT "drivers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_outreach_log" ADD CONSTRAINT "lead_outreach_log_lead_id_lead_prospects_id_fk" FOREIGN KEY ("lead_id") REFERENCES "lead_prospects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_outreach_log" ADD CONSTRAINT "lead_outreach_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_outreach_log" ADD CONSTRAINT "lead_outreach_log_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_prospects" ADD CONSTRAINT "lead_prospects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_prospects" ADD CONSTRAINT "lead_prospects_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mi_compliance_items" ADD CONSTRAINT "mi_compliance_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "stops"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plans" ADD CONSTRAINT "plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plans" ADD CONSTRAINT "plans_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "depots"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proof_of_deliveries" ADD CONSTRAINT "proof_of_deliveries_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "stops"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proof_of_deliveries" ADD CONSTRAINT "proof_of_deliveries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_deliveries" ADD CONSTRAINT "recurring_deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_deliveries" ADD CONSTRAINT "recurring_deliveries_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "depots"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "regulatory_updates" ADD CONSTRAINT "regulatory_updates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "routes" ADD CONSTRAINT "routes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "routes" ADD CONSTRAINT "routes_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stops" ADD CONSTRAINT "stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stops" ADD CONSTRAINT "stops_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
