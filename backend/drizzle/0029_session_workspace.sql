-- CRMAPP: a session remembers the workspace it works in
-- Migration: 0029_session_workspace.sql (idempotent)
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "tenant_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Sessions opened before this column: the user's default center is the
-- best known workspace (refresh re-checks the membership either way).
UPDATE "sessions" s SET "tenant_id" = u."tenant_id" FROM "users" u WHERE u."id" = s."user_id" AND s."tenant_id" IS NULL AND u."tenant_id" IS NOT NULL;
