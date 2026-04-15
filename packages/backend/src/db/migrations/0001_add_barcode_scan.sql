ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS barcodes_scanned  jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS package_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE proof_of_deliveries
  ADD COLUMN IF NOT EXISTS barcodes_scanned jsonb NOT NULL DEFAULT '[]';
