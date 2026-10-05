-- A payroll payout made by mistake is reversed: the row stays with who
-- reversed it, when and why; its expense is removed in the same
-- transaction; a reversed payout counts nowhere. Existing rows are not
-- touched (all NULL = not reversed).
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "reversed_by_id" text;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "reversal_reason" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_reversed_by_id_users_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
