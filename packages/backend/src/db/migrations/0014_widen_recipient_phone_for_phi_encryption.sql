-- Widen recipient_phone from varchar(20) to text on stops and recurring_deliveries.
-- P-SEC40 AES-256-GCM encryption inflates a 10-digit phone to ~60 chars including
-- the "enc:v1:" prefix + base64(IV + ciphertext + tag), which overflowed varchar(20)
-- and produced 500s on every stop insert after encryption rolled out.

ALTER TABLE "stops" ALTER COLUMN "recipient_phone" TYPE text;
ALTER TABLE "recurring_deliveries" ALTER COLUMN "recipient_phone" TYPE text;
