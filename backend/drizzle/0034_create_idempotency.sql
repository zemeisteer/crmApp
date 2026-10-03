ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "request_hash" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "students_tenant_idem_uniq" ON "students" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teachers_tenant_idem_uniq" ON "teachers" USING btree ("tenant_id","idempotency_key");