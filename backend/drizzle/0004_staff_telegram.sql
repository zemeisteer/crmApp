-- CRMAPP: staff Telegram notifications
-- Migration: 0004_staff_telegram.sql (idempotent)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_telegram_chat_idx" ON "users" USING btree ("telegram_chat_id");--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
