-- The cabinet's card receipts remember the browser's key for one send and what
-- it carried, as platform receipts do (0077): a retry returns the same receipt.
-- Additive only: nothing existing changes or is deleted.
ALTER TABLE "payment_claims" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD COLUMN IF NOT EXISTS "request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_claims_idem_idx" ON "payment_claims" USING btree ("tenant_id","student_id","idempotency_key") WHERE idempotency_key IS NOT NULL;
