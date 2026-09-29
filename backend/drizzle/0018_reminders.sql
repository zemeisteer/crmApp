-- CRMAPP: automatic reminders (payment day, lesson reminders)
-- Migration: 0018_reminders.sql (idempotent)
ALTER TYPE "notification_event" ADD VALUE IF NOT EXISTS 'LESSON_REMINDER';
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "remind_payment_day" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "remind_lessons" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_log_once_idx" ON "reminder_log" USING btree ("kind","target_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_log_tenant_idx" ON "reminder_log" USING btree ("tenant_id","created_at");
