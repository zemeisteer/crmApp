-- CRMAPP: per-student read state of announcements in the portal
-- Migration: 0021_announcement_reads.sql (idempotent)
CREATE TABLE IF NOT EXISTS "announcement_reads" (
  "announcement_id" text NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_reads_ann_student_idx" ON "announcement_reads" ("announcement_id", "student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_reads_student_idx" ON "announcement_reads" ("student_id");
