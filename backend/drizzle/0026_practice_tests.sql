-- CRMAPP: practice tests for every direction; a test made by the AI for one
-- student belongs to that student only.
-- Migration: 0026_practice_tests.sql (idempotent)
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "owner_student_id" text REFERENCES "students"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_tests_owner_student_idx" ON "mock_tests" ("owner_student_id");
