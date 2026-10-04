-- Payroll payouts become installments: one salary_payments row per payout,
-- each linked to the expense written with it in the same transaction, with
-- retry protection (Idempotency-Key) like payments, students and teachers.
-- Existing rows are left exactly as they are (expense_id stays NULL); the
-- read-only reconciliation report (GET /salary-payments/reconciliation)
-- lists them next to the salary expenses they may duplicate.
DROP INDEX IF EXISTS "salary_payments_teacher_month_idx";--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "expense_id" text;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "payment_method" "payment_method";--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "recorded_by_id" text;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "request_hash" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salary_payments_expense_uniq" ON "salary_payments" USING btree ("expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salary_payments_tenant_idem_uniq" ON "salary_payments" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_payments_teacher_month_idx" ON "salary_payments" USING btree ("teacher_id","for_month");
