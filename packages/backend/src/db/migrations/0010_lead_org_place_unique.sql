-- Drop the global unique constraint on googlePlaceId (prevents two orgs importing same pharmacy)
-- Replace with a per-org composite unique index
ALTER TABLE "lead_prospects" DROP CONSTRAINT IF EXISTS "lead_prospects_google_place_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "leads_org_place_idx" ON "lead_prospects" ("org_id", "google_place_id") WHERE "google_place_id" IS NOT NULL;
