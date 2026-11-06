-- The part of a payment's discount each invoice was let off, so a void puts it
-- back. Additive only: older allocations keep 0 (not recorded then).
ALTER TABLE "payment_allocations" ADD COLUMN IF NOT EXISTS "waived" integer DEFAULT 0 NOT NULL;
