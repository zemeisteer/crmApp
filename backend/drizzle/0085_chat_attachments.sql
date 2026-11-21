ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_path" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_name" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_mime" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_size" integer;