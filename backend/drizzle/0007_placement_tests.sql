-- CRMAPP: placement tests shared by link
-- Migration: 0007_placement_tests.sql (idempotent)
CREATE TABLE IF NOT EXISTS "placement_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"test_id" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"answers" text NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"suggested_level" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "placement_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_by_user_id" text,
	"title" text NOT NULL,
	"subject" text NOT NULL,
	"language" text DEFAULT 'UZ' NOT NULL,
	"questions" text NOT NULL,
	"token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_attempts" ADD CONSTRAINT "placement_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_attempts" ADD CONSTRAINT "placement_attempts_test_id_placement_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."placement_tests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_tests" ADD CONSTRAINT "placement_tests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_tests" ADD CONSTRAINT "placement_tests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placement_attempts_test_idx" ON "placement_attempts" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placement_attempts_tenant_idx" ON "placement_attempts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "placement_tests_token_idx" ON "placement_tests" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placement_tests_tenant_idx" ON "placement_tests" USING btree ("tenant_id");