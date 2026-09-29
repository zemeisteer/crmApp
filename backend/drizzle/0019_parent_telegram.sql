-- CRMAPP: parents in the Telegram bot (their own link, several children)
-- Migration: 0019_parent_telegram.sql (idempotent)
ALTER TABLE "telegram_link_tokens" ADD COLUMN IF NOT EXISTS "purpose" text DEFAULT 'STUDENT' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_parent_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"student_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telegram_parent_chats" ADD CONSTRAINT "telegram_parent_chats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telegram_parent_chats" ADD CONSTRAINT "telegram_parent_chats_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_parent_chats_student_chat_idx" ON "telegram_parent_chats" USING btree ("student_id","chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_parent_chats_chat_idx" ON "telegram_parent_chats" USING btree ("chat_id");
