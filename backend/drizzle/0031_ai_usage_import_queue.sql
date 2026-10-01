-- CRMAPP: AI usage counters (atomic daily limits) and a durable import queue
-- Migration: 0031_ai_usage_import_queue.sql (idempotent)
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"kind" text NOT NULL,
	"day" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_student_id_kind_day_pk" PRIMARY KEY("student_id","kind","day")
);
--> statement-breakpoint
ALTER TABLE "mock_imports" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
ALTER TABLE "mock_imports" ADD COLUMN IF NOT EXISTS "queue" text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mock_imports" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "mock_imports" ADD COLUMN IF NOT EXISTS "locked_by" text;
--> statement-breakpoint
ALTER TABLE "mock_imports" ADD COLUMN IF NOT EXISTS "locked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "mock_imports" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp;
--> statement-breakpoint
ALTER TABLE "mock_imports" ADD COLUMN IF NOT EXISTS "plan" text;
--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "import_index" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_tenant_idx" ON "ai_usage" USING btree ("tenant_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mock_imports" ADD CONSTRAINT "mock_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_imports_queue_idx" ON "mock_imports" USING btree ("queue","status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_tests_import_uniq" ON "mock_tests" USING btree ("import_id","import_index");
--> statement-breakpoint
-- Imports left unfinished by the old in-memory runner cannot be resumed
-- safely (their tests carry no import_index, so a re-run could repeat
-- them): closed once here, exactly as the old runner did at every start.
UPDATE "mock_imports" SET "status" = 'FAILED', "error" = 'Server yangilandi — importni qaytadan boshlang', "updated_at" = now()
WHERE "status" IN ('QUEUED', 'RUNNING') AND "attempts" = 0 AND "locked_by" IS NULL;
