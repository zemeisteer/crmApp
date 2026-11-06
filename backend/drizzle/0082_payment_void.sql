-- A payment entered by mistake can be taken back (status VOIDED): the row
-- stays, with when, by whom and why. Additive only.
ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'VOIDED';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "voided_by_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
