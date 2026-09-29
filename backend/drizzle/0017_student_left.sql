-- CRMAPP: when and why a student left (for churn reports)
-- Migration: 0017_student_left.sql (idempotent)
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "left_at" timestamp;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "left_reason" text;
--> statement-breakpoint
-- Students who had already left: the last update is the best known date.
UPDATE "students" SET "left_at" = "updated_at" WHERE "status" IN ('LEFT', 'GRADUATED') AND "left_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_left_at_idx" ON "students" USING btree ("tenant_id","left_at");
