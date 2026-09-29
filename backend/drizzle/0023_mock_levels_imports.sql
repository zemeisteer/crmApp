-- CRMAPP: mock test levels/module/source and material imports
-- Migration: 0023_mock_levels_imports.sql (idempotent)
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "level" text;
--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "module" text DEFAULT 'ACADEMIC' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "import_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mock_imports" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'QUEUED' NOT NULL,
  "files" text DEFAULT '[]' NOT NULL,
  "progress" text DEFAULT '{}' NOT NULL,
  "result" text DEFAULT '{}' NOT NULL,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_imports_tenant_idx" ON "mock_imports" ("tenant_id");
