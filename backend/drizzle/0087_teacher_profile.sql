ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "score" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "experience_years" integer;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "photo_path" text;