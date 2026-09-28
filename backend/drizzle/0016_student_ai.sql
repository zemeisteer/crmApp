-- CRMAPP: students ask an AI tutor in the Telegram bot
-- Migration: 0016_student_ai.sql (idempotent)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "student_ai_daily_limit" integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "student_ai_messages" ADD CONSTRAINT "student_ai_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "student_ai_messages" ADD CONSTRAINT "student_ai_messages_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_ai_messages_student_idx" ON "student_ai_messages" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_ai_messages_tenant_idx" ON "student_ai_messages" USING btree ("tenant_id");
