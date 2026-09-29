-- CRMAPP: IELTS mock tests (Listening, Reading, Writing, Speaking) in the portal
-- Migration: 0022_mock_tests.sql (idempotent)
CREATE TABLE IF NOT EXISTS "mock_tests" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "kind" text DEFAULT 'IELTS' NOT NULL,
  "subject" text DEFAULT 'Ingliz tili' NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "content" text DEFAULT '{}' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_tests_tenant_idx" ON "mock_tests" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mock_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "test_id" text NOT NULL REFERENCES "mock_tests"("id") ON DELETE CASCADE,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'IN_PROGRESS' NOT NULL,
  "answers" text DEFAULT '{}' NOT NULL,
  "section_started" text DEFAULT '{}' NOT NULL,
  "section_done" text DEFAULT '{}' NOT NULL,
  "results" text DEFAULT '{}' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_attempts_tenant_idx" ON "mock_attempts" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_attempts_test_student_idx" ON "mock_attempts" ("test_id", "student_id");
