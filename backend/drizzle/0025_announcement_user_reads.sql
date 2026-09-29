-- CRMAPP: per-staff-user read state of announcements (dashboard banners)
-- Migration: 0025_announcement_user_reads.sql (idempotent)
CREATE TABLE IF NOT EXISTS "announcement_user_reads" (
  "announcement_id" text NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_user_reads_ann_user_idx" ON "announcement_user_reads" ("announcement_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_user_reads_user_idx" ON "announcement_user_reads" ("user_id");
