-- CRMAPP: portal login with Telegram one-time codes or a center-issued PIN
-- Migration: 0008_portal_login.sql (idempotent)
CREATE TABLE IF NOT EXISTS "portal_login_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_portal_pins" (
	"student_id" text PRIMARY KEY NOT NULL,
	"pin_hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "student_portal_pins" ADD CONSTRAINT "student_portal_pins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_login_codes_phone_idx" ON "portal_login_codes" USING btree ("phone");