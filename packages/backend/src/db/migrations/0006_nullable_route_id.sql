-- Allow stops to be created without an assigned route (unassigned/standalone stops)
-- routeId was previously NOT NULL; nullable enables dispatcher "New Stop" workflow
ALTER TABLE stops ALTER COLUMN route_id DROP NOT NULL;
