CREATE TABLE IF NOT EXISTS "compliance_score_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "score" integer NOT NULL,
  "violation_count" integer NOT NULL DEFAULT 0,
  "p0_count" integer NOT NULL DEFAULT 0,
  "p1_count" integer NOT NULL DEFAULT 0,
  "scanned_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "score_history_org_time_idx" ON "compliance_score_history" ("org_id", "scanned_at" DESC);
